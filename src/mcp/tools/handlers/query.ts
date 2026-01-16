/**
 * Query Tool Handlers (Phase 1)
 * query_task_history, get_task_details, get_agent_metrics,
 * get_system_dashboard, get_message_history, cancel_task
 */

import { unlink } from "fs/promises";
import { existsSync } from "fs";
import { CONFIG } from '../../config';
import { successResponse, jsonResponse, notFoundResponse, errorResponse } from '../../utils/response';
import {
  QueryTaskHistorySchema,
  GetTaskDetailsSchema,
  GetAgentMetricsSchema,
  GetMessageHistorySchema,
  CancelTaskSchema,
  type QueryTaskHistoryInput,
  type GetTaskDetailsInput,
  type GetAgentMetricsInput,
  type GetMessageHistoryInput,
  type CancelTaskInput,
} from '../../utils/validation';
import {
  getTask,
  getAgentTasks,
  getFullAgentReport,
  getDashboardData,
  getAgentMessages,
  getRecentMessages,
  cancelTask as dbCancelTask,
} from '../../../db';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Tool Definitions ============

export const queryTools: ToolDefinition[] = [
  {
    name: "query_task_history",
    description: "Query task history with filtering by agent, status, and pagination",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "number",
          description: "Filter by agent ID",
        },
        status: {
          type: "string",
          enum: ["pending", "queued", "processing", "completed", "failed", "cancelled"],
          description: "Filter by task status",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default: 20)",
        },
        offset: {
          type: "number",
          description: "Number of results to skip (for pagination)",
        },
        since: {
          type: "string",
          description: "ISO date string - only return tasks after this time",
        },
      },
    },
  },
  {
    name: "get_task_details",
    description: "Get detailed metrics for a specific task including tokens, duration, and result",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task ID to get details for",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_agent_metrics",
    description: "Get comprehensive performance metrics for an agent",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "number",
          description: "The agent ID",
        },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "get_system_dashboard",
    description: "Get system-wide metrics: all agents, task stats, recent events",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_message_history",
    description: "Get communication history between agents and orchestrator",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "number",
          description: "Filter by agent ID",
        },
        direction: {
          type: "string",
          enum: ["inbound", "outbound"],
          description: "Filter by message direction",
        },
        limit: {
          type: "number",
          description: "Maximum messages to return (default: 20)",
        },
      },
    },
  },
  {
    name: "cancel_task",
    description: "Cancel a pending or queued task",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task ID to cancel",
        },
        agent_id: {
          type: "number",
          description: "The agent ID (optional - will search all agents if not provided)",
        },
      },
      required: ["task_id"],
    },
  },
];

// ============ Tool Handlers ============

async function queryTaskHistory(args: unknown) {
  const input = QueryTaskHistorySchema.parse(args) as QueryTaskHistoryInput;
  const { agent_id, status, limit = CONFIG.DEFAULT_LIMIT, offset = 0, since } = input;

  // Use the DB function with optional filters
  let tasks: any[];

  if (agent_id) {
    tasks = getAgentTasks(agent_id, status, limit + offset) as any[];
  } else {
    // Get all tasks from dashboard data and filter
    const dashboard = getDashboardData() as any;
    tasks = [];
    for (const agent of dashboard.agents) {
      const agentTasks = getAgentTasks(agent.id, status, limit + offset) as any[];
      tasks.push(...agentTasks);
    }
  }

  // Apply since filter if provided
  if (since) {
    const sinceDate = new Date(since);
    tasks = tasks.filter((t: any) => new Date(t.created_at) >= sinceDate);
  }

  // Apply pagination
  tasks = tasks.slice(offset, offset + limit);

  return jsonResponse({
    count: tasks.length,
    offset,
    limit,
    tasks,
  });
}

async function getTaskDetails(args: unknown) {
  const input = GetTaskDetailsSchema.parse(args) as GetTaskDetailsInput;
  const { task_id } = input;

  const task = getTask(task_id);

  if (!task) {
    return notFoundResponse("Task", task_id);
  }

  return jsonResponse(task);
}

async function getAgentMetrics(args: unknown) {
  const input = GetAgentMetricsSchema.parse(args) as GetAgentMetricsInput;
  const { agent_id } = input;

  const report = getFullAgentReport(agent_id);

  if (!report || !report.agent) {
    return notFoundResponse("Agent", agent_id);
  }

  // Calculate additional metrics
  const agent = report.agent as any;
  const avgDuration = agent.tasks_completed > 0
    ? Math.round(agent.total_duration_ms / agent.tasks_completed)
    : 0;
  const successRate = (agent.tasks_completed + agent.tasks_failed) > 0
    ? Math.round((agent.tasks_completed / (agent.tasks_completed + agent.tasks_failed)) * 100)
    : 0;

  return jsonResponse({
    agent: report.agent,
    metrics: {
      avg_duration_ms: avgDuration,
      success_rate: `${successRate}%`,
      total_tasks: agent.tasks_completed + agent.tasks_failed,
    },
    recent_tasks: report.tasks,
    message_stats: report.messageStats,
  });
}

async function getSystemDashboard() {
  const dashboard = getDashboardData();
  return jsonResponse(dashboard);
}

async function getMessageHistory(args: unknown) {
  const input = GetMessageHistorySchema.parse(args) as GetMessageHistoryInput;
  const { agent_id, direction, limit = CONFIG.DEFAULT_LIMIT } = input;

  let messages: any[];

  if (agent_id) {
    messages = getAgentMessages(agent_id, limit) as any[];
  } else {
    messages = getRecentMessages(limit) as any[];
  }

  // Filter by direction if specified
  if (direction) {
    messages = messages.filter((m: any) => m.direction === direction);
  }

  return jsonResponse({
    count: messages.length,
    messages,
  });
}

async function cancelTask(args: unknown) {
  const input = CancelTaskSchema.parse(args) as CancelTaskInput;
  const { task_id, agent_id } = input;

  // Try to find and delete the task file from inbox
  let found = false;
  let targetAgentId = agent_id;

  if (agent_id) {
    // Check specific agent's inbox
    const taskFile = `${CONFIG.INBOX_BASE}/${agent_id}/${task_id}.json`;
    if (existsSync(taskFile)) {
      await unlink(taskFile);
      found = true;
    }
  } else {
    // Search all agent inboxes
    const { readdirSync } = await import("fs");
    if (existsSync(CONFIG.INBOX_BASE)) {
      const agents = readdirSync(CONFIG.INBOX_BASE);
      for (const agentDir of agents) {
        const taskFile = `${CONFIG.INBOX_BASE}/${agentDir}/${task_id}.json`;
        if (existsSync(taskFile)) {
          await unlink(taskFile);
          targetAgentId = parseInt(agentDir);
          found = true;
          break;
        }
      }
    }
  }

  if (!found) {
    // Task not in inbox - might already be processing or completed
    const task = getTask(task_id);
    if (task) {
      if (task.status === 'completed' || task.status === 'failed') {
        return errorResponse(`Task ${task_id} has already ${task.status}`);
      }
      if (task.status === 'processing') {
        return errorResponse(`Task ${task_id} is currently processing and cannot be cancelled`);
      }
    }
    return notFoundResponse("Task in inbox", task_id);
  }

  // Update DB status to cancelled
  if (targetAgentId) {
    dbCancelTask(task_id);
  }

  return successResponse(`Task ${task_id} cancelled successfully`);
}

// ============ Export Handlers Map ============

export const queryHandlers: Record<string, ToolHandler> = {
  query_task_history: queryTaskHistory,
  get_task_details: getTaskDetails,
  get_agent_metrics: getAgentMetrics,
  get_system_dashboard: getSystemDashboard,
  get_message_history: getMessageHistory,
  cancel_task: cancelTask,
};
