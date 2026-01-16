#!/usr/bin/env bun
/**
 * MCP Server for Claude Agent Orchestration
 * Provides tools for assigning tasks, getting results, and managing agents
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, readFile, readdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { getAllAgents, getRecentMessages, sendMessage } from "./db";

const INBOX_BASE = "/tmp/agent_inbox";
const OUTBOX_BASE = "/tmp/agent_outbox";
const SHARED_DIR = "/tmp/agent_shared";

// Create MCP server
const server = new Server(
  {
    name: "claude-agent-orchestrator",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
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
        name: "get_agents",
        description: "Get the status of all running Claude sub-agents",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_agent_workload",
        description: "Get pending tasks in an agent's inbox",
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
        name: "update_shared_context",
        description: "Update the shared context that all agents can access",
        inputSchema: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The shared context content (markdown)",
            },
          },
          required: ["content"],
        },
      },
      {
        name: "get_shared_context",
        description: "Get the current shared context",
        inputSchema: {
          type: "object",
          properties: {},
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
          },
          required: ["agent_id"],
        },
      },
    ],
  };
});

// Generate unique task ID
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "assign_task": {
        const { agent_id, task, context, priority = "normal" } = args as {
          agent_id: number;
          task: string;
          context?: string;
          priority?: string;
        };

        const inboxDir = `${INBOX_BASE}/${agent_id}`;
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

        return {
          content: [
            {
              type: "text",
              text: `Task assigned to Agent ${agent_id}\nTask ID: ${taskId}\nPriority: ${priority}\n\nThe agent will process this using Claude CLI and write results to outbox.`,
            },
          ],
        };
      }

      case "broadcast_task": {
        const { task, context } = args as { task: string; context?: string };

        const agents = getAllAgents() as any[];
        const taskIds: string[] = [];

        for (const agent of agents) {
          const inboxDir = `${INBOX_BASE}/${agent.id}`;
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
          taskIds.push(`Agent ${agent.id}: ${taskId}`);
        }

        return {
          content: [
            {
              type: "text",
              text: `Task broadcast to ${agents.length} agents:\n${taskIds.join("\n")}`,
            },
          ],
        };
      }

      case "get_task_result": {
        const { task_id, agent_id } = args as { task_id: string; agent_id: number };
        const resultFile = `${OUTBOX_BASE}/${agent_id}/result_${task_id}.json`;

        if (!existsSync(resultFile)) {
          return {
            content: [
              {
                type: "text",
                text: `No result yet for task ${task_id} from Agent ${agent_id}. The agent may still be processing.`,
              },
            ],
          };
        }

        const result = JSON.parse(await readFile(resultFile, "utf-8"));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_agents": {
        const agents = getAllAgents();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(agents, null, 2),
            },
          ],
        };
      }

      case "get_agent_workload": {
        const { agent_id } = args as { agent_id: number };
        const inboxDir = `${INBOX_BASE}/${agent_id}`;

        if (!existsSync(inboxDir)) {
          return {
            content: [{ type: "text", text: `Agent ${agent_id} inbox is empty` }],
          };
        }

        const files = await readdir(inboxDir);
        const tasks = files.filter((f) => f.endsWith(".json"));

        if (tasks.length === 0) {
          return {
            content: [{ type: "text", text: `Agent ${agent_id} has no pending tasks` }],
          };
        }

        const taskList = [];
        for (const file of tasks) {
          const content = JSON.parse(await readFile(`${inboxDir}/${file}`, "utf-8"));
          taskList.push({
            id: content.id,
            prompt: content.prompt.substring(0, 100),
            priority: content.priority,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `Agent ${agent_id} has ${tasks.length} pending tasks:\n${JSON.stringify(taskList, null, 2)}`,
            },
          ],
        };
      }

      case "update_shared_context": {
        const { content } = args as { content: string };

        await mkdir(SHARED_DIR, { recursive: true });
        await writeFile(`${SHARED_DIR}/context.md`, content);

        return {
          content: [
            {
              type: "text",
              text: `Shared context updated (${content.length} chars). All agents will have access to this context.`,
            },
          ],
        };
      }

      case "get_shared_context": {
        const contextPath = `${SHARED_DIR}/context.md`;

        if (!existsSync(contextPath)) {
          return {
            content: [{ type: "text", text: "No shared context set" }],
          };
        }

        const content = await readFile(contextPath, "utf-8");
        return {
          content: [{ type: "text", text: content }],
        };
      }

      case "get_all_results": {
        const { agent_id } = args as { agent_id: number };
        const outboxDir = `${OUTBOX_BASE}/${agent_id}`;

        if (!existsSync(outboxDir)) {
          return {
            content: [{ type: "text", text: `No results from Agent ${agent_id}` }],
          };
        }

        const files = await readdir(outboxDir);
        const resultFiles = files.filter((f) => f.startsWith("result_") && f.endsWith(".json"));

        if (resultFiles.length === 0) {
          return {
            content: [{ type: "text", text: `No completed results from Agent ${agent_id}` }],
          };
        }

        const results = [];
        for (const file of resultFiles.slice(-5)) {
          // Last 5 results
          const content = JSON.parse(await readFile(`${outboxDir}/${file}`, "utf-8"));
          results.push(content);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Claude Agent Orchestrator MCP Server v2.0 running on stdio");
}

main().catch(console.error);
