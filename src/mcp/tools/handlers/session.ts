/**
 * Session Persistence Tool Handlers
 * Enhanced session management with SQLite + ChromaDB sync and auto-linking
 */

import { jsonResponse, errorResponse } from '../../utils/response';
import {
  saveSession as saveSessionToChroma,
  searchSessions,
  findSimilarSessions,
  isInitialized,
  initVectorDB,
} from '../../../vector-db';
import {
  createSession,
  getSessionById,
  listSessionsFromDb,
  createSessionLink,
  getLinkedSessions,
  getLearningsBySession,
  type SessionRecord,
  type FullContext,
} from '../../../db';
import type { ToolDefinition, ToolHandler } from '../../types';
import { z } from 'zod';

// ============ Schemas ============

const SaveSessionSchema = z.object({
  summary: z.string().min(1),
  full_context: z.object({
    what_worked: z.array(z.string()).optional(),
    what_didnt_work: z.array(z.string()).optional(),
    learnings: z.array(z.string()).optional(),
    future_ideas: z.array(z.string()).optional(),
    key_decisions: z.array(z.string()).optional(),
    blockers_resolved: z.array(z.string()).optional(),
  }).optional(),
  duration_mins: z.number().optional(),
  commits_count: z.number().optional(),
  tags: z.array(z.string()).optional(),
  previous_session_id: z.string().optional(),
});

const RecallSessionSchema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(10).default(3),
});

const GetSessionSchema = z.object({
  session_id: z.string().min(1),
});

const ListSessionsSchema = z.object({
  tag: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().min(1).max(50).default(10),
});

const LinkSessionsSchema = z.object({
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  link_type: z.enum(['continues', 'related', 'supersedes']),
});

// ============ Ensure DBs ready ============

async function ensureVectorDB() {
  if (!isInitialized()) {
    await initVectorDB();
  }
}

// ============ Tool Definitions ============

export const sessionTools: ToolDefinition[] = [
  {
    name: "save_session",
    description: "Save a comprehensive session with context, learnings, and auto-linking to related sessions",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Session summary" },
        full_context: {
          type: "object",
          description: "Detailed context object",
          properties: {
            what_worked: { type: "array", items: { type: "string" } },
            what_didnt_work: { type: "array", items: { type: "string" } },
            learnings: { type: "array", items: { type: "string" } },
            future_ideas: { type: "array", items: { type: "string" } },
            key_decisions: { type: "array", items: { type: "string" } },
            blockers_resolved: { type: "array", items: { type: "string" } },
          },
        },
        duration_mins: { type: "number", description: "Session duration in minutes" },
        commits_count: { type: "number", description: "Number of commits" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
        previous_session_id: { type: "string", description: "ID of previous session (for continuation)" },
      },
      required: ["summary"],
    },
  },
  {
    name: "recall_session",
    description: "Quick semantic search - returns brief session summaries",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default: 3)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_session",
    description: "Deep dive - get full session details with linked sessions and learnings",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "list_sessions",
    description: "List sessions with optional filters",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag" },
        since: { type: "string", description: "Filter by date (ISO format)" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
    },
  },
  {
    name: "link_sessions",
    description: "Create a link between two sessions",
    inputSchema: {
      type: "object",
      properties: {
        from_id: { type: "string", description: "Source session ID" },
        to_id: { type: "string", description: "Target session ID" },
        link_type: { type: "string", enum: ["continues", "related", "supersedes"], description: "Type of relationship" },
      },
      required: ["from_id", "to_id", "link_type"],
    },
  },
];

// ============ Tool Handlers ============

async function handleSaveSession(args: unknown) {
  await ensureVectorDB();
  const input = SaveSessionSchema.parse(args);

  const sessionId = `session_${Date.now()}`;
  const now = new Date().toISOString();

  try {
    // 1. Save to SQLite (source of truth)
    const session: SessionRecord = {
      id: sessionId,
      previous_session_id: input.previous_session_id,
      summary: input.summary,
      full_context: input.full_context as FullContext,
      duration_mins: input.duration_mins,
      commits_count: input.commits_count,
      tags: input.tags,
    };
    createSession(session);

    // 2. Save to ChromaDB (search index)
    const searchContent = `${input.summary} ${input.tags?.join(' ') || ''}`;
    await saveSessionToChroma(sessionId, searchContent, {
      tags: input.tags || [],
      created_at: now,
    });

    // 3. Auto-link to similar sessions
    const { autoLinked, suggested } = await findSimilarSessions(searchContent, sessionId);

    // Create auto-links in SQLite
    for (const link of autoLinked) {
      createSessionLink(sessionId, link.id, 'auto_strong', link.similarity);
    }

    // 4. Link to previous session if specified
    if (input.previous_session_id) {
      createSessionLink(sessionId, input.previous_session_id, 'continues');
    }

    return jsonResponse({
      success: true,
      session_id: sessionId,
      created_at: now,
      summary_length: input.summary.length,
      tags: input.tags || [],
      auto_linked: autoLinked,
      suggested_links: suggested.map(s => ({
        id: s.id,
        similarity: Number(s.similarity.toFixed(3)),
        summary: s.summary,
      })),
    });
  } catch (error) {
    return errorResponse(`Failed to save session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleRecallSession(args: unknown) {
  await ensureVectorDB();
  const input = RecallSessionSchema.parse(args);

  try {
    const results = await searchSessions(input.query, input.limit);

    const sessions = results.ids[0]?.map((id, i) => {
      const meta = results.metadatas[0]?.[i] as any;
      return {
        session_id: id,
        summary: results.documents[0]?.[i]?.substring(0, 150) + '...',
        tags: meta?.tags ? String(meta.tags).split(',').filter(Boolean) : [],
        relevance: results.distances?.[0]?.[i] ? Number((1 - results.distances[0][i]).toFixed(3)) : null,
      };
    }) || [];

    return jsonResponse({
      query: input.query,
      count: sessions.length,
      sessions,
      hint: "Use get_session(session_id) for full details",
    });
  } catch (error) {
    return errorResponse(`Failed to recall sessions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleGetSession(args: unknown) {
  const input = GetSessionSchema.parse(args);

  try {
    const session = getSessionById(input.session_id);
    if (!session) {
      return errorResponse(`Session not found: ${input.session_id}`);
    }

    // Get linked sessions
    const linkedSessions = getLinkedSessions(input.session_id);

    // Get learnings from this session
    const learnings = getLearningsBySession(input.session_id);

    return jsonResponse({
      session: {
        id: session.id,
        summary: session.summary,
        full_context: session.full_context,
        duration_mins: session.duration_mins,
        commits_count: session.commits_count,
        tags: session.tags,
        previous_session_id: session.previous_session_id,
        created_at: session.created_at,
      },
      linked_sessions: linkedSessions.map(l => ({
        session_id: l.session.id,
        summary: l.session.summary?.substring(0, 100) + '...',
        link_type: l.link_type,
        similarity: l.similarity,
      })),
      learnings: learnings.map(l => ({
        id: l.id,
        title: l.title,
        category: l.category,
        confidence: l.confidence,
      })),
    });
  } catch (error) {
    return errorResponse(`Failed to get session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleListSessions(args: unknown) {
  const input = ListSessionsSchema.parse(args);

  try {
    const sessions = listSessionsFromDb({
      tag: input.tag,
      since: input.since,
      limit: input.limit,
    });

    return jsonResponse({
      count: sessions.length,
      filters: { tag: input.tag, since: input.since },
      sessions: sessions.map(s => ({
        session_id: s.id,
        summary: s.summary?.substring(0, 150) + (s.summary && s.summary.length > 150 ? '...' : ''),
        tags: s.tags,
        duration_mins: s.duration_mins,
        commits_count: s.commits_count,
        created_at: s.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(`Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleLinkSessions(args: unknown) {
  const input = LinkSessionsSchema.parse(args);

  try {
    // Verify both sessions exist
    const fromSession = getSessionById(input.from_id);
    const toSession = getSessionById(input.to_id);

    if (!fromSession) {
      return errorResponse(`Session not found: ${input.from_id}`);
    }
    if (!toSession) {
      return errorResponse(`Session not found: ${input.to_id}`);
    }

    const success = createSessionLink(input.from_id, input.to_id, input.link_type);

    return jsonResponse({
      success,
      from_id: input.from_id,
      to_id: input.to_id,
      link_type: input.link_type,
    });
  } catch (error) {
    return errorResponse(`Failed to link sessions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============ Export Handlers Map ============

export const sessionHandlers: Record<string, ToolHandler> = {
  save_session: handleSaveSession,
  recall_session: handleRecallSession,
  get_session: handleGetSession,
  list_sessions: handleListSessions,
  link_sessions: handleLinkSessions,
};
