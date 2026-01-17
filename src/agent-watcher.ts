#!/usr/bin/env bun
/**
 * Agent Watcher - Real Claude Sub-Agent
 * Watches inbox for tasks, runs Claude CLI, writes results to outbox
 */

import { mkdir, readFile, readdir, unlink, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { runClaudeTask, writeToScratchpad } from "./claude-agent";
import {
  registerAgent,
  updateAgentStatus,
  sendMessage,
  createSession,
  createSessionLink,
  linkTaskToSession,
  type SessionRecord,
  type Visibility,
} from "./db";
import {
  initVectorDB,
  embedTask,
  embedResult,
  isInitialized,
  saveSession as saveSessionToChroma,
  findSimilarSessions,
} from "./vector-db";

const AGENT_ID = parseInt(process.argv[2] || "1");
const INBOX = `/tmp/agent_inbox/${AGENT_ID}`;
const OUTBOX = `/tmp/agent_outbox/${AGENT_ID}`;
const POLL_INTERVAL = 1000; // ms

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const AGENT_COLORS = [COLORS.red, COLORS.green, COLORS.yellow, COLORS.blue, COLORS.magenta, COLORS.cyan];
const COLOR = AGENT_COLORS[(AGENT_ID - 1) % AGENT_COLORS.length];

interface Task {
  id: string;
  prompt: string;
  context?: string;
  priority?: "low" | "normal" | "high";
  working_dir?: string;
  session_id?: string;
  auto_save_session?: boolean;
}

function log(message: string) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`${COLOR}[${timestamp}] [Agent-${AGENT_ID}]${COLORS.reset} ${message}`);
}

function logThinking() {
  console.log(`${COLOR}${COLORS.bold}[Agent-${AGENT_ID}]${COLORS.reset} ${COLORS.dim}Thinking...${COLORS.reset}`);
}

function logError(message: string) {
  console.error(`${COLORS.red}[Agent-${AGENT_ID}] ERROR: ${message}${COLORS.reset}`);
}

/**
 * Auto-save a mini-session after task completion
 * Captures task context, result summary, and auto-links to similar sessions
 * Sessions are created with agent_id for per-agent memory isolation
 */
async function autoSaveTaskSession(
  task: Task,
  result: { status: string; output: string; duration_ms: number }
): Promise<string | null> {
  try {
    const sessionId = `session_agent${AGENT_ID}_${Date.now()}`;
    const now = new Date().toISOString();

    // Create summary from task and result
    const taskPreview = task.prompt.substring(0, 100);
    const resultPreview = result.output.substring(0, 200);
    const summary = `Agent ${AGENT_ID} task: ${taskPreview}${task.prompt.length > 100 ? '...' : ''}\n\nResult: ${resultPreview}${result.output.length > 200 ? '...' : ''}`;

    // Determine wins/issues based on status
    const wins = result.status === 'completed'
      ? [`Task completed successfully in ${result.duration_ms}ms`]
      : [];

    const issues = result.status === 'error'
      ? [`Task failed: ${result.output.substring(0, 100)}`]
      : [];

    // Agent sessions default to 'private' visibility - can be shared later
    const visibility: Visibility = 'private';

    // 1. Save to SQLite with agent_id for isolation
    const session: SessionRecord = {
      id: sessionId,
      summary,
      full_context: {
        wins,
        issues,
      },
      tags: [`agent-${AGENT_ID}`, 'auto-generated', task.priority || 'normal'],
      agent_id: AGENT_ID,
      visibility,
    };
    createSession(session);

    // 2. Link task to this session
    linkTaskToSession(task.id, sessionId);

    // 3. Save to ChromaDB for semantic search with agent_id
    if (isInitialized()) {
      const searchContent = `${summary} Agent task ${task.priority || 'normal'} priority`;
      await saveSessionToChroma(sessionId, searchContent, {
        tags: session.tags || [],
        created_at: now,
        agent_id: AGENT_ID,
        visibility,
      });

      // 4. Auto-link to similar sessions (within agent scope)
      const { autoLinked, suggested } = await findSimilarSessions(searchContent, {
        excludeId: sessionId,
        agentId: AGENT_ID,
        crossAgentLinking: false,
      });
      for (const link of autoLinked) {
        createSessionLink(sessionId, link.id, 'auto_strong', link.similarity);
      }

      if (autoLinked.length > 0) {
        log(`Auto-linked to ${autoLinked.length} similar sessions`);
      }
    }

    log(`Created mini-session: ${sessionId} (agent_id: ${AGENT_ID}, visibility: ${visibility})`);
    return sessionId;
  } catch (error) {
    logError(`Failed to auto-save session: ${error}`);
    return null;
  }
}

async function ensureDirectories() {
  await mkdir(INBOX, { recursive: true });
  await mkdir(OUTBOX, { recursive: true });
}

async function processTask(taskFile: string): Promise<void> {
  const filePath = `${INBOX}/${taskFile}`;

  try {
    const content = await readFile(filePath, "utf-8");
    const task: Task = JSON.parse(content);

    log(`Received task: ${task.id}`);
    console.log(`${COLOR}┌─ TASK ──────────────────────────────────────────────┐${COLORS.reset}`);
    console.log(`${COLORS.dim}${task.prompt.substring(0, 200)}${task.prompt.length > 200 ? "..." : ""}${COLORS.reset}`);
    console.log(`${COLOR}└──────────────────────────────────────────────────────┘${COLORS.reset}`);

    // Update status
    updateAgentStatus(AGENT_ID, "working", task.prompt.substring(0, 50));
    sendMessage(String(AGENT_ID), "orchestrator", `Started task: ${task.id}`);

    // Run REAL Claude CLI
    logThinking();
    const result = await runClaudeTask(
      AGENT_ID,
      task.id,
      task.prompt,
      task.context,
      task.working_dir
    );

    // Write result to outbox
    const resultFile = `${OUTBOX}/result_${task.id}.json`;
    await writeFile(resultFile, JSON.stringify(result, null, 2));

    // Auto-embed task and result for semantic search (non-blocking)
    if (isInitialized()) {
      embedTask(task.id, task.prompt, {
        agent_id: AGENT_ID,
        priority: task.priority,
        created_at: new Date().toISOString(),
      }).catch(err => logError(`Failed to embed task: ${err}`));

      if (result.status === 'completed') {
        embedResult(task.id, result.output, {
          agent_id: AGENT_ID,
          status: result.status,
          duration_ms: result.duration_ms,
          completed_at: result.completed_at,
        }).catch(err => logError(`Failed to embed result: ${err}`));
      }
    }

    // Display result
    console.log(`${COLOR}┌─ RESULT ─────────────────────────────────────────────┐${COLORS.reset}`);
    console.log(result.output.substring(0, 500));
    if (result.output.length > 500) {
      console.log(`${COLORS.dim}... (${result.output.length} chars total)${COLORS.reset}`);
    }
    console.log(`${COLOR}└──────────────────────────────────────────────────────┘${COLORS.reset}`);

    // Update status
    if (result.status === "completed") {
      log(`Task completed in ${result.duration_ms}ms`);
      updateAgentStatus(AGENT_ID, "idle", "Ready for tasks");
      sendMessage(String(AGENT_ID), "orchestrator", `Completed task: ${task.id}`);
    } else {
      logError(`Task failed: ${result.output}`);
      updateAgentStatus(AGENT_ID, "error", result.output.substring(0, 50));
      sendMessage(String(AGENT_ID), "orchestrator", `Failed task: ${task.id}`);
    }

    // Auto-save session if requested or high priority
    if (task.auto_save_session || task.priority === 'high') {
      await autoSaveTaskSession(task, result);
    }

    // Delete processed task file
    await unlink(filePath);
  } catch (err) {
    logError(`Failed to process ${taskFile}: ${err}`);
    // Move to error state but keep file for debugging
    updateAgentStatus(AGENT_ID, "error", `Failed: ${taskFile}`);
  }
}

async function checkInbox() {
  if (!existsSync(INBOX)) {
    return;
  }

  try {
    const files = await readdir(INBOX);
    const taskFiles = files.filter((f) => f.endsWith(".json")).sort();

    for (const taskFile of taskFiles) {
      await processTask(taskFile);
    }
  } catch (err) {
    // Inbox might not exist yet
  }
}

async function main() {
  console.clear();
  console.log();
  console.log(`${COLOR}${COLORS.bold}╔══════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLOR}${COLORS.bold}║      CLAUDE SUB-AGENT ${AGENT_ID}              ║${COLORS.reset}`);
  console.log(`${COLOR}${COLORS.bold}║         (Real Claude CLI)            ║${COLORS.reset}`);
  console.log(`${COLOR}${COLORS.bold}╚══════════════════════════════════════╝${COLORS.reset}`);
  console.log();

  // Ensure directories exist
  await ensureDirectories();

  // Initialize vector database for semantic search
  try {
    await initVectorDB();
    log("Vector database initialized");
  } catch (err) {
    logError(`Failed to initialize vector database: ${err}`);
    log("Continuing without vector search capabilities");
  }

  // Register with orchestrator
  registerAgent(AGENT_ID, `pane-${AGENT_ID}`, process.pid);
  sendMessage(String(AGENT_ID), "orchestrator", `Agent started (PID: ${process.pid})`);

  log(`Started - watching ${INBOX}`);
  log(`Results will be written to ${OUTBOX}`);
  log(`Ready to receive tasks from orchestrator`);
  console.log();

  updateAgentStatus(AGENT_ID, "idle", "Ready for tasks");

  // Main polling loop
  while (true) {
    await checkInbox();
    await Bun.sleep(POLL_INTERVAL);
  }
}

main().catch((err) => {
  logError(`Fatal error: ${err}`);
  process.exit(1);
});
