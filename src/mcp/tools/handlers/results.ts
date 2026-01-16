/**
 * Results Tool Handlers
 * get_task_result, get_all_results
 */

import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { CONFIG } from '../../config';
import { successResponse, jsonResponse, notFoundResponse } from '../../utils/response';
import {
  GetTaskResultSchema,
  GetAllResultsSchema,
  type GetTaskResultInput,
  type GetAllResultsInput,
} from '../../utils/validation';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Tool Definitions ============

export const resultsTools: ToolDefinition[] = [
  {
    name: "get_task_result",
    description: "Get the result of a completed task",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task ID to get results for",
        },
        agent_id: {
          type: "number",
          description: "The agent ID that processed the task",
        },
      },
      required: ["task_id", "agent_id"],
    },
  },
  {
    name: "get_all_results",
    description: "Get all completed task results from a specific agent",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "number",
          description: "The agent ID",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 20)",
        },
      },
      required: ["agent_id"],
    },
  },
];

// ============ Tool Handlers ============

async function getTaskResult(args: unknown) {
  const input = GetTaskResultSchema.parse(args) as GetTaskResultInput;
  const { task_id, agent_id } = input;

  const resultFile = `${CONFIG.OUTBOX_BASE}/${agent_id}/result_${task_id}.json`;

  if (!existsSync(resultFile)) {
    return successResponse(
      `No result yet for task ${task_id} from Agent ${agent_id}. The agent may still be processing.`
    );
  }

  const result = JSON.parse(await readFile(resultFile, "utf-8"));
  return jsonResponse(result);
}

async function getAllResults(args: unknown) {
  const input = GetAllResultsSchema.parse(args) as GetAllResultsInput;
  const { agent_id, limit = CONFIG.DEFAULT_LIMIT } = input;

  const outboxDir = `${CONFIG.OUTBOX_BASE}/${agent_id}`;

  if (!existsSync(outboxDir)) {
    return notFoundResponse("Agent outbox", agent_id);
  }

  const files = await readdir(outboxDir);
  const resultFiles = files.filter(
    (f) => f.startsWith("result_") && f.endsWith(".json")
  );

  if (resultFiles.length === 0) {
    return successResponse(`No completed results from Agent ${agent_id}`);
  }

  // Sort by filename (which contains timestamp) and take the latest
  const sortedFiles = resultFiles.sort().slice(-limit);

  const results = [];
  for (const file of sortedFiles) {
    const content = JSON.parse(
      await readFile(`${outboxDir}/${file}`, "utf-8")
    );
    results.push(content);
  }

  return jsonResponse(results);
}

// ============ Export Handlers Map ============

export const resultsHandlers: Record<string, ToolHandler> = {
  get_task_result: getTaskResult,
  get_all_results: getAllResults,
};
