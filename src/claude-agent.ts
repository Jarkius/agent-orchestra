#!/usr/bin/env bun
/**
 * Claude Agent - Wrapper for running Claude CLI with tasks
 * Runs claude in non-interactive mode and captures output
 */

import { $ } from "bun";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { getAgent, getAgentTasks } from "./db";

const SHARED_DIR = "/tmp/agent_shared";

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

  // Add agent identity with self-awareness (Phase 3)
  let agentContext = `You are Agent ${agentId}, a sub-agent working on a task assigned by the orchestrator.`;

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
  fullPrompt = `${agentContext}\n\n${fullPrompt}`;

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

  const agentId = parseInt(args[0]);
  const prompt = args.slice(1).join(" ");
  const taskId = `cli_${Date.now()}`;

  console.log(`Agent ${agentId} running task: ${prompt}`);

  const result = await runClaudeTask(agentId, taskId, prompt);

  console.log("\n--- Result ---");
  console.log(JSON.stringify(result, null, 2));
}
