#!/usr/bin/env bun
/**
 * MCP Server Entry Point
 * Modular Claude Agent Orchestrator v3.0
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { CONFIG } from './config';
import { allTools, allHandlers } from './tools';
import { errorResponse } from './utils/response';

// Create MCP server
const server = new Server(
  {
    name: CONFIG.SERVER_NAME,
    version: CONFIG.SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: allTools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = allHandlers[name];

  if (!handler) {
    return errorResponse(`Unknown tool: ${name}`);
  }

  try {
    return await handler(args);
  } catch (error) {
    // Handle Zod validation errors nicely
    if (error && typeof error === 'object' && 'issues' in error) {
      const issues = (error as any).issues;
      const messages = issues.map((i: any) => `${i.path.join('.')}: ${i.message}`);
      return errorResponse(`Validation error:\n${messages.join('\n')}`);
    }
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${CONFIG.SERVER_NAME} v${CONFIG.SERVER_VERSION} running on stdio`);
}

main().catch(console.error);
