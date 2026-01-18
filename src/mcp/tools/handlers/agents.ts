/**
 * Agent Tool Handlers
 * get_agents, get_agent_workload
 */

import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { CONFIG } from '../../config';
import { successResponse, jsonResponse } from '../../utils/response';
import {
  GetAgentWorkloadSchema,
  type GetAgentWorkloadInput,
} from '../../utils/validation';
import { getAllAgents } from '../../../db';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Tool Definitions ============

export const agentTools: ToolDefinition[] = [
  {
    name: "get_agents",
    description: "Agent statuses",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_agent_workload",
    description: "Agent workload",
    inputSchema: {
      type: "object",
      properties: { agent_id: { type: "number" } },
      required: ["agent_id"],
    },
  },
];

// ============ Tool Handlers ============

async function getAgents() {
  const agents = getAllAgents();
  return jsonResponse(agents);
}

async function getAgentWorkload(args: unknown) {
  const input = GetAgentWorkloadSchema.parse(args) as GetAgentWorkloadInput;
  const { agent_id } = input;

  const inboxDir = `${CONFIG.INBOX_BASE}/${agent_id}`;

  if (!existsSync(inboxDir)) {
    return successResponse(`Agent ${agent_id} inbox is empty`);
  }

  const files = await readdir(inboxDir);
  const tasks = files.filter((f) => f.endsWith(".json"));

  if (tasks.length === 0) {
    return successResponse(`Agent ${agent_id} has no pending tasks`);
  }

  const taskList = [];
  for (const file of tasks) {
    const content = JSON.parse(await readFile(`${inboxDir}/${file}`, "utf-8"));
    taskList.push({
      id: content.id,
      prompt: content.prompt.substring(0, 100),
      priority: content.priority,
      assigned_at: content.assigned_at,
    });
  }

  return successResponse(
    `Agent ${agent_id} has ${tasks.length} pending tasks:\n${JSON.stringify(taskList, null, 2)}`
  );
}

// ============ Export Handlers Map ============

export const agentHandlers: Record<string, ToolHandler> = {
  get_agents: getAgents,
  get_agent_workload: getAgentWorkload,
};
