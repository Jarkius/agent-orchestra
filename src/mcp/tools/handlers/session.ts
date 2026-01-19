/**
 * Session Persistence Tool Handlers
 * Session management with SQLite + ChromaDB sync
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
  type Visibility,
} from '../../../db';
import type { ToolDefinition, ToolHandler } from '../../types';
import { z } from 'zod';

// ============ Schemas ============

const SaveSessionSchema = z.object({
  summary: z.string().min(1),
  full_context: z.record(z.string(), z.any()).optional(),  // Simplified: accept any object
  duration_mins: z.number().optional(),
  commits_count: z.number().optional(),
  tags: z.array(z.string()).optional(),
  previous_session_id: z.string().optional(),
  agent_id: z.number().int().nullable().optional(),
  visibility: z.enum(['private', 'shared', 'public']).optional(),
});

const RecallSessionSchema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(10).default(3),
  agent_id: z.number().int().nullable().optional(),
  include_shared: z.boolean().default(true),
});

const GetSessionSchema = z.object({
  session_id: z.string().min(1),
  agent_id: z.number().int().nullable().optional(),
});

const ListSessionsSchema = z.object({
  tag: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().min(1).max(50).default(10),
  agent_id: z.number().int().nullable().optional(),
  include_shared: z.boolean().default(true),
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
    description: "Save session",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        full_context: { type: "object" },  // Simplified: no nested properties
        duration_mins: { type: "number" },
        commits_count: { type: "number" },
        tags: { type: "array", items: { type: "string" } },
        previous_session_id: { type: "string" },
        agent_id: { type: "number" },
        visibility: { type: "string", enum: ["private", "shared", "public"] },
      },
      required: ["summary"],
    },
  },
  {
    name: "recall_session",
    description: "Search sessions",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        agent_id: { type: "number" },
        include_shared: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_session",
    description: "Session details",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        agent_id: { type: "number" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "list_sessions",
    description: "List sessions",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        since: { type: "string" },
        limit: { type: "number" },
        agent_id: { type: "number" },
        include_shared: { type: "boolean" },
      },
    },
  },
];

// ============ Tool Handlers ============

async function handleSaveSession(args: unknown) {
  await ensureVectorDB();
  const input = SaveSessionSchema.parse(args);

  const sessionId = `session_${Date.now()}`;
  const now = new Date().toISOString();
  const agentId = input.agent_id ?? null;
  const visibility = input.visibility || (agentId === null ? 'public' : 'private') as Visibility;

  try {
    const fullContext = input.full_context as FullContext | undefined;

    // 1. Save to SQLite (source of truth)
    const session: SessionRecord = {
      id: sessionId,
      previous_session_id: input.previous_session_id,
      summary: input.summary,
      full_context: fullContext,
      duration_mins: input.duration_mins,
      commits_count: input.commits_count,
      tags: input.tags,
      agent_id: agentId,
      visibility,
    };
    createSession(session);

    // 2. Save to ChromaDB (search index) with rich content
    const searchParts = [input.summary];
    if (input.tags?.length) searchParts.push(input.tags.join(' '));
    if (fullContext?.key_decisions?.length) searchParts.push(`Decisions: ${fullContext.key_decisions.join('. ')}`);
    if (fullContext?.wins?.length) searchParts.push(`Wins: ${fullContext.wins.join('. ')}`);
    if (fullContext?.issues?.length) searchParts.push(`Issues: ${fullContext.issues.join('. ')}`);
    if (fullContext?.challenges?.length) searchParts.push(`Challenges: ${fullContext.challenges.join('. ')}`);
    if (fullContext?.next_steps?.length) searchParts.push(`Next: ${fullContext.next_steps.join('. ')}`);
    if (fullContext?.files_changed?.length) searchParts.push(`Files: ${fullContext.files_changed.slice(0, 10).join(' ')}`);
    if (fullContext?.git_commits?.length) searchParts.push(`Commits: ${fullContext.git_commits.slice(0, 5).join(' ')}`);

    const searchContent = searchParts.join(' ');
    await saveSessionToChroma(sessionId, searchContent, {
      tags: input.tags || [],
      created_at: now,
      agent_id: agentId,
      visibility,
    });

    // 3. Auto-link to similar sessions
    const { autoLinked, suggested } = await findSimilarSessions(searchContent, {
      excludeId: sessionId,
      agentId,
      crossAgentLinking: false,
    });

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
      agent_id: agentId,
      visibility,
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
    const results = await searchSessions(input.query, {
      limit: input.limit,
      agentId: input.agent_id ?? undefined,
      includeShared: input.include_shared,
    });

    const sessions = results.ids[0]?.map((id, i) => {
      const meta = results.metadatas[0]?.[i] as any;
      return {
        session_id: id,
        summary: results.documents[0]?.[i]?.substring(0, 150) + '...',
        tags: meta?.tags ? String(meta.tags).split(',').filter(Boolean) : [],
        agent_id: meta?.agent_id === -1 ? null : meta?.agent_id,
        visibility: meta?.visibility || 'public',
        relevance: results.distances?.[0]?.[i] ? Number((1 - results.distances[0][i]).toFixed(3)) : null,
      };
    }) || [];

    return jsonResponse({
      query: input.query,
      agent_filter: input.agent_id ?? null,
      include_shared: input.include_shared,
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

    const requestingAgentId = input.agent_id ?? null;
    if (!canAccessSession(requestingAgentId, session)) {
      return errorResponse(`Access denied: Session ${input.session_id} is not accessible to agent ${requestingAgentId}`);
    }

    const linkedSessions = getLinkedSessions(input.session_id);
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
        next_steps: session.next_steps,
        challenges: session.challenges,
        agent_id: session.agent_id,
        visibility: session.visibility,
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

function canAccessSession(agentId: number | null, session: SessionRecord): boolean {
  if (agentId === null) return true;
  if (session.agent_id === agentId) return true;
  if (session.agent_id === null) return true;
  return session.visibility === 'shared' || session.visibility === 'public';
}

async function handleListSessions(args: unknown) {
  const input = ListSessionsSchema.parse(args);

  try {
    const sessions = listSessionsFromDb({
      tag: input.tag,
      since: input.since,
      limit: input.limit,
      agentId: input.agent_id ?? undefined,
      includeShared: input.include_shared,
    });

    return jsonResponse({
      count: sessions.length,
      filters: { tag: input.tag, since: input.since, agent_id: input.agent_id ?? null },
      include_shared: input.include_shared,
      sessions: sessions.map(s => ({
        session_id: s.id,
        summary: s.summary?.substring(0, 150) + (s.summary && s.summary.length > 150 ? '...' : ''),
        tags: s.tags,
        duration_mins: s.duration_mins,
        commits_count: s.commits_count,
        agent_id: s.agent_id,
        visibility: s.visibility,
        created_at: s.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(`Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============ Export Handlers Map ============

export const sessionHandlers: Record<string, ToolHandler> = {
  save_session: handleSaveSession,
  recall_session: handleRecallSession,
  get_session: handleGetSession,
  list_sessions: handleListSessions,
};
