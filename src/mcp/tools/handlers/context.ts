/**
 * Context Tool Handlers
 * update_shared_context, get_shared_context, get_inbox
 *
 * Phase 3: get_inbox now shows hub connection status for real-time notifications
 */

import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { CONFIG } from '../../config';
import { successResponse, jsonResponse } from '../../utils/response';
import {
  UpdateSharedContextSchema,
  type UpdateSharedContextInput,
} from '../../utils/validation';
import type { ToolDefinition, ToolHandler } from '../../types';
import { embedContext, isInitialized } from '../../../vector-db';
import { db } from '../../../db';
import { isConnected as isHubConnected, getStatus as getHubStatus } from '../../../matrix-client';

// ============ Tool Definitions ============

export const contextTools: ToolDefinition[] = [
  {
    name: "update_shared_context",
    description: "Update context",
    inputSchema: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    },
  },
  {
    name: "get_shared_context",
    description: "Get context",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_inbox",
    description: "Check inbox for cross-matrix messages",
    inputSchema: {
      type: "object",
      properties: {
        since_hours: { type: "number", description: "Hours to look back (default: 24)" },
      },
    },
  },
  {
    name: "matrix_send",
    description: "Send a message to other matrices via the matrix communication system",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Message content to send" },
        to: { type: "string", description: "Target matrix path for direct message (omit for broadcast)" },
      },
      required: ["content"],
    },
  },
];

// ============ Tool Handlers ============

async function updateSharedContext(args: unknown) {
  const input = UpdateSharedContextSchema.parse(args) as UpdateSharedContextInput;
  const { content } = input;

  await mkdir(CONFIG.SHARED_DIR, { recursive: true });
  await writeFile(`${CONFIG.SHARED_DIR}/context.md`, content);

  // Auto-embed context for semantic search (non-blocking)
  if (isInitialized()) {
    const versionId = `ctx_${Date.now()}`;
    embedContext(versionId, content, {
      updated_by: 'orchestrator',
      created_at: new Date().toISOString(),
    }).catch(() => {}); // Silently ignore embedding errors
  }

  return successResponse(
    `Shared context updated (${content.length} chars). All agents will have access to this context.`
  );
}

async function getSharedContext() {
  const contextPath = `${CONFIG.SHARED_DIR}/context.md`;

  if (!existsSync(contextPath)) {
    return successResponse("No shared context set");
  }

  const content = await readFile(contextPath, "utf-8");
  return successResponse(content);
}

interface InboxMessage {
  id: number;
  title: string;
  lesson: string | null;
  created_at: string;
}

async function getInbox(args: unknown) {
  const input = args as { since_hours?: number };
  const sinceHours = input.since_hours || 24;
  const thisMatrix = process.cwd();

  // Get broadcasts and direct messages to this matrix
  const messages = db.query(`
    SELECT id, title, lesson, created_at
    FROM learnings
    WHERE category = 'insight'
      AND (
        title LIKE '[msg:broadcast]%'
        OR title LIKE '%[to:${thisMatrix}]%'
      )
      AND created_at > datetime('now', '-${sinceHours} hours')
    ORDER BY created_at DESC
    LIMIT 50
  `).all() as InboxMessage[];

  // Parse messages for cleaner output
  const parsed = messages.map(msg => {
    const broadcastMatch = msg.title.match(/^\[msg:broadcast\] \[from:([^\]]+)\] (.+)$/);
    const directMatch = msg.title.match(/^\[msg:direct\] \[from:([^\]]+)\] \[to:([^\]]+)\] (.+)$/);

    if (broadcastMatch) {
      return {
        id: msg.id,
        type: 'broadcast',
        from: broadcastMatch[1],
        content: broadcastMatch[2],
        created_at: msg.created_at,
      };
    }
    if (directMatch) {
      return {
        id: msg.id,
        type: 'direct',
        from: directMatch[1],
        to: directMatch[2],
        content: directMatch[3],
        created_at: msg.created_at,
      };
    }
    return null;
  }).filter(Boolean);

  // Check hub connection status
  const hubConnected = isHubConnected();
  const hubStatus = getHubStatus();

  return jsonResponse({
    this_matrix: thisMatrix,
    since_hours: sinceHours,
    message_count: parsed.length,
    messages: parsed,
    hub_status: {
      connected: hubConnected,
      url: hubStatus.hubUrl,
      pending_messages: hubStatus.pendingMessages,
      note: hubConnected
        ? "Real-time notifications active - new messages appear instantly"
        : "Hub offline - polling SQLite for messages",
    },
    hint: parsed.length > 0 ? "Use 'bun memory message --inbox' for full details" : "No messages",
  });
}

// ============ Matrix Send Handler ============

async function matrixSend(args: unknown) {
  const input = args as { content: string; to?: string };
  const { content, to } = input;
  const DAEMON_PORT = process.env.MATRIX_DAEMON_PORT || '37888';

  try {
    // Check if daemon is running
    const statusRes = await fetch(`http://localhost:${DAEMON_PORT}/status`);
    if (!statusRes.ok) {
      return jsonResponse({
        success: false,
        error: "Matrix daemon not running. Start with: bun run src/matrix-daemon.ts start",
      });
    }

    // Send message via daemon API
    const endpoint = to ? '/send' : '/broadcast';
    const body = to ? { content, to } : { content };

    const res = await fetch(`http://localhost:${DAEMON_PORT}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await res.json() as { sent?: boolean; queued?: boolean };

    return jsonResponse({
      success: true,
      type: to ? 'direct' : 'broadcast',
      to: to || 'all matrices',
      content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
      delivered: result.sent || false,
      queued: result.queued || false,
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: `Failed to send: ${error instanceof Error ? error.message : 'Unknown error'}`,
      hint: "Ensure daemon is running: bun memory init",
    });
  }
}

// ============ Export Handlers Map ============

export const contextHandlers: Record<string, ToolHandler> = {
  update_shared_context: updateSharedContext,
  get_shared_context: getSharedContext,
  get_inbox: getInbox,
  matrix_send: matrixSend,
};
