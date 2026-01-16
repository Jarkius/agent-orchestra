/**
 * Session Persistence Tool Handlers
 * save_session, recall_session, list_sessions
 *
 * Allows the orchestrator to persist and recall session context
 * for continuity across /clear operations
 */

import { jsonResponse, successResponse, errorResponse } from '../../utils/response';
import {
  SaveSessionSchema,
  RecallSessionSchema,
  ListSessionsSchema,
  type SaveSessionInput,
  type RecallSessionInput,
  type ListSessionsInput,
} from '../../utils/validation';
import {
  saveSession,
  searchSessions,
  listSessions,
  isInitialized,
  initVectorDB,
} from '../../../vector-db';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Ensure VectorDB is ready ============

async function ensureVectorDB() {
  if (!isInitialized()) {
    await initVectorDB();
  }
}

// ============ Tool Definitions ============

export const sessionTools: ToolDefinition[] = [
  {
    name: "save_session",
    description: "Save a session summary for later recall. Use before /clear to persist important context.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Summary of the session - key decisions, changes made, current state",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for categorization (e.g., 'embeddings', 'refactor', 'bugfix')",
        },
        metadata: {
          type: "object",
          description: "Optional additional metadata to store with the session",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "recall_session",
    description: "Search for past sessions by semantic similarity. Use to find relevant prior work.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query to find relevant sessions (e.g., 'embedding provider changes')",
        },
        limit: {
          type: "number",
          description: "Maximum sessions to return (default: 3, max: 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_sessions",
    description: "List recent saved sessions",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum sessions to return (default: 10, max: 50)",
        },
      },
    },
  },
];

// ============ Tool Handlers ============

async function handleSaveSession(args: unknown) {
  await ensureVectorDB();
  const input = SaveSessionSchema.parse(args) as SaveSessionInput;
  const { summary, tags, metadata } = input;

  const sessionId = `session_${Date.now()}`;
  const now = new Date().toISOString();

  try {
    await saveSession(sessionId, summary, {
      tags: tags || [],
      created_at: now,
      ...metadata,
    });

    return jsonResponse({
      success: true,
      session_id: sessionId,
      summary_length: summary.length,
      tags: tags || [],
      created_at: now,
      message: "Session saved. Use recall_session to find it later.",
    });
  } catch (error) {
    return errorResponse(`Failed to save session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleRecallSession(args: unknown) {
  await ensureVectorDB();
  const input = RecallSessionSchema.parse(args) as RecallSessionInput;
  const { query, limit } = input;

  try {
    const results = await searchSessions(query, limit);

    const sessions = results.ids[0]?.map((id, i) => ({
      session_id: id,
      summary: results.documents[0]?.[i] || null,
      metadata: results.metadatas[0]?.[i] || null,
      relevance: results.distances?.[0]?.[i] ? (1 - results.distances[0][i]).toFixed(3) : null,
    })) || [];

    return jsonResponse({
      query,
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    return errorResponse(`Failed to recall sessions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleListSessions(args: unknown) {
  await ensureVectorDB();
  const input = ListSessionsSchema.parse(args) as ListSessionsInput;
  const { limit } = input;

  try {
    const result = await listSessions(limit);

    const sessions = result.ids.map((id, i) => {
      const meta = result.metadatas[i] as any;
      const tagsStr = meta?.tags || '';
      return {
        session_id: id,
        summary: result.summaries[i]?.substring(0, 200) + (result.summaries[i] && result.summaries[i]!.length > 200 ? "..." : ""),
        tags: tagsStr ? tagsStr.split(',') : [],
        created_at: meta?.created_at || null,
      };
    });

    return jsonResponse({
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    return errorResponse(`Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============ Export Handlers Map ============

export const sessionHandlers: Record<string, ToolHandler> = {
  save_session: handleSaveSession,
  recall_session: handleRecallSession,
  list_sessions: handleListSessions,
};
