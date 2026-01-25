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
import { startServer as startWsServer, isServerRunning, getConnectionStats } from '../ws-server';
import { connectToHub, onMessage, isConnected as isHubConnected, getStatus as getHubStatus } from '../matrix-client';
import { checkStartupHealth, formatStartupWarning } from './startup-health';

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
  // Fresh clone detection (non-blocking)
  try {
    const startupHealth = await checkStartupHealth();
    const warning = formatStartupWarning(startupHealth);
    if (warning) {
      console.error(warning);
    }
  } catch {
    // Don't block startup if health check fails
  }

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

  // Start WebSocket server for real-time agent communication
  if (process.env.SKIP_WEBSOCKET !== "true") {
    try {
      const wsPort = parseInt(process.env.WS_PORT || '8080');
      console.error(`[MCP] Starting WebSocket server on port ${wsPort}...`);
      startWsServer(wsPort);
      console.error(`[MCP] WebSocket: listening on ws://localhost:${wsPort}`);
    } catch (error) {
      console.error(`[MCP] Warning: WebSocket server failed: ${error}`);
      console.error("[MCP] Continuing without real-time delivery...");
    }
  }

  // Connect to matrix hub for cross-matrix messaging (Phase 3)
  if (process.env.SKIP_MATRIX_HUB !== "true") {
    try {
      const hubUrl = process.env.MATRIX_HUB_URL || 'ws://localhost:8081';
      console.error(`[MCP] Connecting to matrix hub at ${hubUrl}...`);
      const connected = await connectToHub(hubUrl);
      if (connected) {
        console.error(`[MCP] Matrix hub: connected`);
        // Register message handler for real-time notifications
        onMessage((msg) => {
          console.error(`[MCP] 📬 Message from ${msg.from}: ${msg.content.substring(0, 100)}`);
        });
      } else {
        console.error(`[MCP] Matrix hub: not available, using SQLite fallback`);
      }
    } catch (error) {
      console.error(`[MCP] Warning: Matrix hub connection failed: ${error}`);
      console.error("[MCP] Cross-matrix messaging will use SQLite fallback...");
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${CONFIG.SERVER_NAME} v${CONFIG.SERVER_VERSION} running on stdio`);
}

main().catch(console.error);
