/**
 * Task Tool Handlers
 * assign_task, broadcast_task
 */

import { mkdir, writeFile } from "fs/promises";
import { CONFIG } from '../../config';
import { successResponse, errorResponse } from '../../utils/response';
import {
  AssignTaskSchema,
  BroadcastTaskSchema,
  type AssignTaskInput,
  type BroadcastTaskInput,
} from '../../utils/validation';
import { getAllAgents, sendMessage } from '../../../db';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Utility Functions ============

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

// ============ Tool Definitions ============

export const taskTools: ToolDefinition[] = [
  {
    name: "assign_task",
    description: "Assign a task to a specific Claude sub-agent. The agent will use real Claude CLI to process the task.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "number",
          description: "The agent ID (1, 2, 3, etc.)",
        },
        task: {
          type: "string",
          description: "The task prompt to send to the agent",
        },
        context: {
          type: "string",
          description: "Optional context to include with the task",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high"],
          description: "Task priority (default: normal)",
        },
      },
      required: ["agent_id", "task"],
    },
  },
  {
    name: "broadcast_task",
    description: "Send the same task to all available agents",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The task prompt to broadcast",
        },
        context: {
          type: "string",
          description: "Optional context to include",
        },
      },
      required: ["task"],
    },
  },
];

// ============ Tool Handlers ============

async function assignTask(args: unknown) {
  const input = AssignTaskSchema.parse(args) as AssignTaskInput;
  const { agent_id, task, context, priority } = input;

  const inboxDir = `${CONFIG.INBOX_BASE}/${agent_id}`;
  const taskId = generateTaskId();
  const taskFile = `${inboxDir}/${taskId}.json`;

  // Ensure inbox directory exists
  await mkdir(inboxDir, { recursive: true });

  // Create task JSON
  const taskData = {
    id: taskId,
    prompt: task,
    context,
    priority,
    assigned_at: new Date().toISOString(),
  };

  await writeFile(taskFile, JSON.stringify(taskData, null, 2));
  sendMessage("orchestrator", String(agent_id), `Assigned task: ${taskId}`);

  return successResponse(
    `Task assigned to Agent ${agent_id}\nTask ID: ${taskId}\nPriority: ${priority}\n\nThe agent will process this using Claude CLI and write results to outbox.`
  );
}

async function broadcastTask(args: unknown) {
  const input = BroadcastTaskSchema.parse(args) as BroadcastTaskInput;
  const { task, context } = input;

  const agents = getAllAgents() as any[];

  if (agents.length === 0) {
    return errorResponse("No agents available for broadcast");
  }

  const taskIds: string[] = [];

  for (const agent of agents) {
    const inboxDir = `${CONFIG.INBOX_BASE}/${agent.id}`;
    const taskId = generateTaskId();
    const taskFile = `${inboxDir}/${taskId}.json`;

    await mkdir(inboxDir, { recursive: true });

    const taskData = {
      id: taskId,
      prompt: task,
      context,
      priority: "normal",
      assigned_at: new Date().toISOString(),
    };

    await writeFile(taskFile, JSON.stringify(taskData, null, 2));
    sendMessage("orchestrator", String(agent.id), `Broadcast task: ${taskId}`);
    taskIds.push(`Agent ${agent.id}: ${taskId}`);
  }

  return successResponse(
    `Task broadcast to ${agents.length} agents:\n${taskIds.join("\n")}`
  );
}

// ============ Export Handlers Map ============

export const taskHandlers: Record<string, ToolHandler> = {
  assign_task: assignTask,
  broadcast_task: broadcastTask,
};
