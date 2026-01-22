#!/usr/bin/env bun
/**
 * Claude Agent - Wrapper for running Claude CLI with tasks
 * Runs claude in non-interactive mode and captures output
 */

import { $ } from "bun";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { getAgent, getAgentTasks } from "./db";
import { searchLearnings, isInitialized as isVectorDBInitialized } from "./vector-db";

// Cache for CLAUDE.md content
let claudeMdCache: string | null = null;

/**
 * Load CLAUDE.md from project root for agent context
 */
async function loadClaudeMd(): Promise<string> {
  if (claudeMdCache !== null) {
    return claudeMdCache;
  }

  // Try to find CLAUDE.md relative to this file's location
  const possiblePaths = [
    join(process.cwd(), "CLAUDE.md"),
    join(dirname(import.meta.path), "..", "CLAUDE.md"),
    join(dirname(import.meta.path), "..", "..", "CLAUDE.md"),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      claudeMdCache = await readFile(path, "utf-8");
      return claudeMdCache;
    }
  }

  claudeMdCache = "";
  return claudeMdCache;
}

/**
 * Get sub-agent specific instructions - agents are mirrors of the orchestrator
 */
function getSubAgentInstructions(agentId: number): string {
  return `
## You Are Agent ${agentId} - A Full Claude Instance

You are a **full Claude instance** running as Agent ${agentId} in a multi-agent orchestration system. You have the same capabilities as the main orchestrator Claude - you are a mirror, not a reduced helper.

### Multi-Agent Architecture
- **Orchestrator**: The main Claude session that coordinates work
- **You (Agent ${agentId})**: A parallel Claude instance that can work autonomously
- **Other Agents**: Sibling Claude instances working on other tasks
- **Shared Memory**: SQLite + ChromaDB for persistent knowledge

### Memory Commands You Can Use
You have access to the same memory system as the orchestrator:

\`\`\`bash
# Save your session/learnings
bun memory save ["summary"]

# Search past sessions
bun memory recall ["query"]

# Capture a specific learning
bun memory learn <category> "title" [--lesson "..." --prevention "..."]

# Get context for your task
bun memory context ["query"]

# View statistics
bun memory stats
\`\`\`

**Categories**: performance, architecture, tooling, process, debugging, security, testing, philosophy, principle, insight, pattern, retrospective

**Confidence levels**: low → medium → high → proven

### How You Work
1. You receive tasks via your inbox (./data/agent_inbox/${agentId}/)
2. You execute them autonomously with full Claude capabilities
3. Your results go to your outbox (./data/agent_outbox/${agentId}/)
4. You can read/write files, run commands, and access the codebase
5. You share memory with the orchestrator and other agents

### When to Save Learnings
If you discover something valuable during your task:
- A pattern that could help future tasks
- A bug fix approach worth remembering
- An architectural insight
- A debugging technique

Flag it clearly: **"LEARNING: [category] title - description"**

### Communication with Orchestrator
Your output is returned to the orchestrator. Be:
- **Clear**: State results directly
- **Actionable**: Provide code/commands that work
- **Insightful**: Share observations that could help
`;
}

// Use environment variable or default to ./data/ for persistence
const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();
const SHARED_DIR = process.env.AGENT_SHARED_DIR || join(PROJECT_ROOT, 'data', 'agent_shared');

/**
 * Query ChromaDB for learnings relevant to the task prompt
 * Uses agent-scoped filtering to prioritize agent's own learnings
 * while also including shared/public learnings from other agents
 */
async function getRelevantLearnings(taskPrompt: string, agentId: number, limit = 5): Promise<string> {
  if (!isVectorDBInitialized()) {
    return '';
  }

  try {
    // Search with agent scoping - agent's own learnings + shared/public from others
    const results = await searchLearnings(taskPrompt, {
      limit,
      agentId,
      includeShared: true,
    });

    if (!results.ids[0]?.length) {
      return '';
    }

    const parts: string[] = ['## Relevant Learnings from Past Sessions'];

    for (let i = 0; i < results.ids[0].length; i++) {
      const distance = results.distances?.[0]?.[i] ?? 1;
      const similarity = 1 - distance;

      // Only include if relevance is above threshold (distance < 0.5 means similarity > 0.5)
      if (similarity < 0.5) continue;

      const content = results.documents[0]?.[i];
      const metadata = results.metadatas[0]?.[i] as any;

      if (content) {
        const confidence = metadata?.confidence || 'medium';
        const category = metadata?.category || 'general';
        const learningAgentId = metadata?.agent_id === -1 ? null : metadata?.agent_id;

        // Marker based on confidence
        const marker = confidence === 'proven' ? '✓' : confidence === 'high' ? '•' : '○';

        // Indicate source: own learnings vs shared
        const sourceIndicator = learningAgentId === agentId
          ? '(yours)'
          : learningAgentId === null
            ? '(orchestrator)'
            : '(shared)';

        parts.push(`${marker} [${category}] ${content} ${sourceIndicator}`);
      }
    }

    // Only return if we found relevant learnings
    if (parts.length > 1) {
      return parts.join('\n') + '\n';
    }
  } catch (error) {
    // Silently fail - learnings are optional enhancement
  }

  return '';
}

interface TaskResult {
  task_id: string;
  agent_id: number;
  status: "completed" | "error";
  output: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

/**
 * Run a task using Claude CLI
 */
export async function runClaudeTask(
  agentId: number,
  taskId: string,
  prompt: string,
  context?: string,
  workingDir?: string
): Promise<TaskResult> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  // Build the full prompt with context
  let fullPrompt = prompt;
  if (context) {
    fullPrompt = `## Context\n${context}\n\n## Task\n${prompt}`;
  }

  // Add shared context if available
  const sharedContextPath = `${SHARED_DIR}/context.md`;
  if (existsSync(sharedContextPath)) {
    const sharedContext = await readFile(sharedContextPath, "utf-8");
    fullPrompt = `## Shared Project Context\n${sharedContext}\n\n${fullPrompt}`;
  }

  // Load CLAUDE.md for project context
  const claudeMd = await loadClaudeMd();

  // Get sub-agent instructions (mirrors orchestrator capabilities)
  const subAgentInstructions = getSubAgentInstructions(agentId);

  // Add agent identity with self-awareness (Phase 3)
  let agentContext = subAgentInstructions;

  // Inject agent self-status
  try {
    const agentRecord = getAgent(agentId) as any;
    const recentTasks = getAgentTasks(agentId, undefined, 5) as any[];

    if (agentRecord) {
      agentContext += `\n\n## Your Agent Status
- Agent ID: ${agentId}
- Name: ${agentRecord.name || `Agent-${agentId}`}
- Tasks completed: ${agentRecord.tasks_completed || 0}
- Tasks failed: ${agentRecord.tasks_failed || 0}
- Total runtime: ${agentRecord.total_duration_ms || 0}ms`;

      if (recentTasks && recentTasks.length > 0) {
        agentContext += `\n\n## Your Recent Tasks (last ${recentTasks.length})`;
        for (const task of recentTasks.slice(0, 3)) {
          const promptPreview = task.prompt?.substring(0, 80) || 'N/A';
          agentContext += `\n- [${task.status}] ${promptPreview}${task.prompt?.length > 80 ? '...' : ''}`;
        }
      }
    }
  } catch {
    // Silently ignore if DB access fails
  }

  agentContext += `\n\nComplete the task and provide a clear response.`;

  // Inject relevant learnings from ChromaDB (agent-scoped)
  const relevantLearnings = await getRelevantLearnings(prompt, agentId);

  // Build full prompt: CLAUDE.md → Agent Instructions → Agent Status → Relevant Learnings → Shared Context → Task
  const claudeMdSection = claudeMd ? `## Project Instructions (CLAUDE.md)\n${claudeMd}\n\n` : '';
  fullPrompt = `${claudeMdSection}${agentContext}\n\n${relevantLearnings}${fullPrompt}`;

  try {
    // Run claude CLI with --print flag for non-interactive output
    // Use -p for prompt input
    const cwd = workingDir || process.cwd();

    const result = await $`claude -p ${fullPrompt} --output-format text`
      .cwd(cwd)
      .text();

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    return {
      task_id: taskId,
      agent_id: agentId,
      status: "completed",
      output: result.trim(),
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    return {
      task_id: taskId,
      agent_id: agentId,
      status: "error",
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs,
    };
  }
}

/**
 * Write to shared scratchpad (for agent-to-agent communication)
 */
export async function writeToScratchpad(agentId: number, message: string) {
  await mkdir(SHARED_DIR, { recursive: true });
  const scratchpadPath = `${SHARED_DIR}/scratchpad.md`;

  const timestamp = new Date().toISOString();
  const entry = `\n## Agent ${agentId} - ${timestamp}\n${message}\n`;

  let existing = "";
  if (existsSync(scratchpadPath)) {
    existing = await readFile(scratchpadPath, "utf-8");
  }

  await writeFile(scratchpadPath, existing + entry);
}

/**
 * Read shared context
 */
export async function getSharedContext(): Promise<string | null> {
  const contextPath = `${SHARED_DIR}/context.md`;
  if (existsSync(contextPath)) {
    return await readFile(contextPath, "utf-8");
  }
  return null;
}

/**
 * Read scratchpad
 */
export async function getScratchpad(): Promise<string | null> {
  const scratchpadPath = `${SHARED_DIR}/scratchpad.md`;
  if (existsSync(scratchpadPath)) {
    return await readFile(scratchpadPath, "utf-8");
  }
  return null;
}

// CLI interface for testing
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: bun run src/claude-agent.ts <agent_id> <prompt>");
    console.log("Example: bun run src/claude-agent.ts 1 'What is 2+2?'");
    process.exit(1);
  }

  const agentId = parseInt(args[0] ?? '0');
  const prompt = args.slice(1).join(" ");
  const taskId = `cli_${Date.now()}`;

  console.log(`Agent ${agentId} running task: ${prompt}`);

  const result = await runClaudeTask(agentId, taskId, prompt);

  console.log("\n--- Result ---");
  console.log(JSON.stringify(result, null, 2));
}
