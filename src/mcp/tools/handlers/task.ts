/**
 * Task Tool Handlers
 * assign_task, broadcast_task
 *
 * Delivery priority:
 * 1. WebSocket (if agent connected) - <100ms latency
 * 2. File inbox (fallback) - 1-4s latency due to polling
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
import {
  getAllAgents,
  sendMessage,
  linkTaskToSession,
  getRecentSessions,
  getHighConfidenceLearnings,
  type SessionRecord,
  type LearningRecord,
} from '../../../db';
import type { ToolDefinition, ToolHandler } from '../../types';
import {
  isServerRunning,
  isAgentConnected,
  sendTaskToAgent,
  broadcastTask as wsBroadcastTask,
} from '../../../ws-server';

// ============ Utility Functions ============

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Build a context bundle with recent sessions and high-confidence learnings
 */
function buildContextBundle(): string {
  const parts: string[] = [];

  // Get recent sessions (last 2)
  const recentSessions = getRecentSessions(2);
  if (recentSessions.length > 0) {
    parts.push('## Recent Session Context');
    for (const session of recentSessions) {
      parts.push(`\n### ${session.id}`);
      parts.push(`**Summary:** ${session.summary}`);
      if (session.next_steps?.length) {
        parts.push(`**Next Steps:** ${session.next_steps.join(', ')}`);
      }
      if (session.challenges?.length) {
        parts.push(`**Challenges:** ${session.challenges.join(', ')}`);
      }
    }
  }

  // Get high-confidence learnings
  const learnings = getHighConfidenceLearnings(5);
  if (learnings.length > 0) {
    parts.push('\n## Relevant Learnings');
    for (const learning of learnings) {
      const confidence = learning.confidence === 'proven' ? '✓' : '•';
      parts.push(`${confidence} **[${learning.category}]** ${learning.title}`);
      if (learning.description) {
        parts.push(`  ${learning.description}`);
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : '';
}

// ============ Tool Definitions ============

export const taskTools: ToolDefinition[] = [
  {
    name: "assign_task",
    description: "Assign task",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "number" },
        task: { type: "string" },
        context: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high"] },
        session_id: { type: "string" },
        include_context_bundle: { type: "boolean" },
        auto_save_session: { type: "boolean" },
      },
      required: ["agent_id", "task"],
    },
  },
  {
    name: "broadcast_task",
    description: "Broadcast task",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        context: { type: "string" },
      },
      required: ["task"],
    },
  },
];

// ============ Tool Handlers ============

async function assignTask(args: unknown) {
  const input = AssignTaskSchema.parse(args) as AssignTaskInput;
  const { agent_id, task, context, priority, session_id, include_context_bundle, auto_save_session } = input;

  const taskId = generateTaskId();

  // Build enhanced context if requested
  let enhancedContext = context || '';
  if (include_context_bundle) {
    const contextBundle = buildContextBundle();
    if (contextBundle) {
      enhancedContext = contextBundle + (enhancedContext ? '\n\n---\n\n' + enhancedContext : '');
    }
  }

  // Create task data
  const taskData = {
    id: taskId,
    prompt: task,
    context: enhancedContext || undefined,
    priority,
    session_id,
    auto_save_session: auto_save_session || priority === 'high',
    assigned_at: new Date().toISOString(),
  };

  // Try WebSocket delivery first (if server running and agent connected)
  let deliveryMethod = 'file';
  if (isServerRunning() && isAgentConnected(agent_id)) {
    const sent = sendTaskToAgent(agent_id, taskData);
    if (sent) {
      deliveryMethod = 'websocket';
    }
  }

  // Fall back to file-based delivery if WebSocket failed or unavailable
  if (deliveryMethod === 'file') {
    const inboxDir = `${CONFIG.INBOX_BASE}/${agent_id}`;
    const taskFile = `${inboxDir}/${taskId}.json`;
    await mkdir(inboxDir, { recursive: true });
    await writeFile(taskFile, JSON.stringify(taskData, null, 2));
  }

  sendMessage("orchestrator", String(agent_id), `Assigned task: ${taskId}`);

  // Link task to session if provided
  if (session_id) {
    linkTaskToSession(taskId, session_id);
  }

  const deliveryInfo = deliveryMethod === 'websocket' ? '\nDelivery: WebSocket (instant)' : '\nDelivery: File inbox (polling)';
  const contextInfo = include_context_bundle ? '\nContext bundle: included' : '';
  const sessionInfo = session_id ? `\nLinked to session: ${session_id}` : '';
  const autoSaveInfo = taskData.auto_save_session ? '\nAuto-save session: enabled' : '';

  return successResponse(
    `Task assigned to Agent ${agent_id}\nTask ID: ${taskId}\nPriority: ${priority}${deliveryInfo}${contextInfo}${sessionInfo}${autoSaveInfo}`
  );
}

async function broadcastTask(args: unknown) {
  const input = BroadcastTaskSchema.parse(args) as BroadcastTaskInput;
  const { task, context } = input;

  const agents = getAllAgents() as any[];

  if (agents.length === 0) {
    return errorResponse("No agents available for broadcast");
  }

  const results: string[] = [];
  let wsDelivered = 0;
  let fileDelivered = 0;

  for (const agent of agents) {
    const taskId = generateTaskId();

    const taskData = {
      id: taskId,
      prompt: task,
      context,
      priority: "normal" as const,
      assigned_at: new Date().toISOString(),
    };

    // Try WebSocket first
    let delivered = false;
    if (isServerRunning() && isAgentConnected(agent.id)) {
      delivered = sendTaskToAgent(agent.id, taskData);
      if (delivered) {
        wsDelivered++;
        results.push(`Agent ${agent.id}: ${taskId} (WS)`);
      }
    }

    // Fall back to file if needed
    if (!delivered) {
      const inboxDir = `${CONFIG.INBOX_BASE}/${agent.id}`;
      const taskFile = `${inboxDir}/${taskId}.json`;
      await mkdir(inboxDir, { recursive: true });
      await writeFile(taskFile, JSON.stringify(taskData, null, 2));
      fileDelivered++;
      results.push(`Agent ${agent.id}: ${taskId} (file)`);
    }

    sendMessage("orchestrator", String(agent.id), `Broadcast task: ${taskId}`);
  }

  const deliveryStats = wsDelivered > 0
    ? `\n\nDelivery: ${wsDelivered} via WebSocket, ${fileDelivered} via file`
    : '';

  return successResponse(
    `Task broadcast to ${agents.length} agents:\n${results.join("\n")}${deliveryStats}`
  );
}

// ============ Export Handlers Map ============

export const taskHandlers: Record<string, ToolHandler> = {
  assign_task: assignTask,
  broadcast_task: broadcastTask,
};
