#!/usr/bin/env bun
/**
 * MCP Server Entry Point
 * Modular Claude Agent Orchestrator v3.0
 *
 * Features:
 * - Auto-starts ChromaDB on initialization
 * - Pre-loads embedding model for fast queries
 * - Health check endpoint
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
import { initVectorDBWithAutoStart, getHealthStatus } from '../vector-db';

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
  // Auto-start ChromaDB and initialize vector DB
  if (process.env.SKIP_VECTORDB !== "true") {
    try {
      console.error("[MCP] Initializing vector database...");
      const health = await initVectorDBWithAutoStart();
      console.error(`[MCP] ChromaDB: ${health.chromadb.status}`);
      console.error(`[MCP] Embedding: ${health.embedding.provider}/${health.embedding.model}`);
      if (health.collections.stats) {
        const total = Object.values(health.collections.stats).reduce((a, b) => a + b, 0);
        console.error(`[MCP] Collections: ${total} total embeddings`);
      }
    } catch (error) {
      console.error(`[MCP] Warning: Vector DB init failed: ${error}`);
      console.error("[MCP] Continuing without semantic search...");
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${CONFIG.SERVER_NAME} v${CONFIG.SERVER_VERSION} running on stdio`);
}

main().catch(console.error);
