/**
 * Unified Recall Service
 *
 * Handles all recall/search operations with smart query detection:
 * - No query → list recent sessions
 * - Session ID pattern (session_*) → exact session lookup
 * - Learning ID pattern (#N or learning_N) → exact learning lookup
 * - Other query → semantic search
 */

import {
  getSessionById,
  getLearningById,
  getLinkedSessions,
  getLinkedLearnings,
  getSessionTasks,
  listSessionsFromDb,
  listLearningsFromDb,
  type SessionRecord,
  type LearningRecord,
  type SessionTask,
} from '../db';

import {
  searchSessions,
  searchLearnings,
  searchSessionTasks,
  initVectorDB,
  isInitialized,
} from '../vector-db';

// ============ Pattern Detection ============

const SESSION_ID_PATTERN = /^session_\d+$/;
const LEARNING_ID_PATTERN = /^#?(\d+)$|^learning_(\d+)$/;

export type QueryType = 'recent' | 'session_id' | 'learning_id' | 'search';

export function detectQueryType(query: string | undefined): QueryType {
  if (!query || query.trim() === '') {
    return 'recent';
  }

  const trimmed = query.trim();

  if (SESSION_ID_PATTERN.test(trimmed)) {
    return 'session_id';
  }

  if (LEARNING_ID_PATTERN.test(trimmed)) {
    return 'learning_id';
  }

  return 'search';
}

export function extractLearningId(query: string): number | null {
  const match = query.match(LEARNING_ID_PATTERN);
  if (!match) return null;
  return parseInt(match[1] || match[2]);
}

// ============ Result Types ============

export interface SessionWithContext {
  session: SessionRecord;
  tasks: SessionTask[];
  linkedSessions: Array<{ session: SessionRecord; link_type: string; similarity?: number }>;
  similarity?: number;
}

export interface LearningWithContext {
  learning: LearningRecord;
  linkedLearnings: Array<{ learning: LearningRecord; link_type: string; similarity?: number }>;
  similarity?: number;
}

export interface TaskSearchResult {
  id: number;
  session_id: string;
  description: string;
  status: string;
  notes?: string;
  similarity: number;
}

export interface RecallResult {
  type: 'recent' | 'exact_match' | 'semantic_search';
  query: string;
  sessions: SessionWithContext[];
  learnings: LearningWithContext[];
  tasks: TaskSearchResult[];
}

export interface RecallOptions {
  limit?: number;
  includeLinks?: boolean;
  includeTasks?: boolean;
  agentId?: number | null;
  includeShared?: boolean;
}

// ============ Main Recall Function ============

/**
 * Smart recall - detects query type and handles appropriately
 */
export async function recall(query: string | undefined, options: RecallOptions = {}): Promise<RecallResult> {
  const { limit = 5, includeLinks = true, includeTasks = true, agentId, includeShared = true } = options;
  const queryType = detectQueryType(query);
  const normalizedQuery = query?.trim() || '';

  switch (queryType) {
    case 'recent':
      return recallRecent(limit, includeLinks, includeTasks, agentId, includeShared);

    case 'session_id':
      return recallSessionById(normalizedQuery, includeLinks, includeTasks, agentId);

    case 'learning_id':
      return recallLearningById(normalizedQuery, includeLinks, agentId);

    case 'search':
      return recallBySearch(normalizedQuery, limit, includeLinks, includeTasks, agentId, includeShared);
  }
}

// ============ Recall Strategies ============

/**
 * Recall most recent session to resume work (no query provided)
 * Returns the last session with full context for continuation
 */
async function recallRecent(
  limit: number,
  includeLinks: boolean,
  includeTasks: boolean,
  agentId?: number | null,
  includeShared: boolean = true
): Promise<RecallResult> {
  // Get the most recent session for resuming (with agent scoping)
  const sessions = listSessionsFromDb({
    limit: 1,
    agentId,
    includeShared,
  });

  if (sessions.length === 0) {
    return {
      type: 'recent',
      query: '',
      sessions: [],
      learnings: [],
      tasks: [],
    };
  }

  const latestSession = sessions[0];

  // Get full context for the latest session
  const sessionsWithContext: SessionWithContext[] = [{
    session: latestSession,
    tasks: includeTasks ? getSessionTasks(latestSession.id) : [],
    linkedSessions: includeLinks ? getLinkedSessions(latestSession.id) : [],
  }];

  // Also get high-confidence learnings that might be relevant (with agent scoping)
  const relevantLearnings = listLearningsFromDb({
    confidence: 'high',
    limit: 5,
    agentId,
    includeShared,
  });
  const learningsWithContext: LearningWithContext[] = relevantLearnings.map(learning => ({
    learning,
    linkedLearnings: includeLinks && learning.id ? getLinkedLearnings(learning.id) : [],
  }));

  return {
    type: 'recent',
    query: '',
    sessions: sessionsWithContext,
    learnings: learningsWithContext,
    tasks: [],
  };
}

/**
 * Recall by exact session ID
 */
async function recallSessionById(
  sessionId: string,
  includeLinks: boolean,
  includeTasks: boolean,
  agentId?: number | null
): Promise<RecallResult> {
  const session = getSessionById(sessionId);

  if (!session) {
    return {
      type: 'exact_match',
      query: sessionId,
      sessions: [],
      learnings: [],
      tasks: [],
    };
  }

  // Check access if agentId is specified
  if (agentId !== undefined && !canAccessSession(agentId, session)) {
    return {
      type: 'exact_match',
      query: sessionId,
      sessions: [],
      learnings: [],
      tasks: [],
    };
  }

  return {
    type: 'exact_match',
    query: sessionId,
    sessions: [{
      session,
      tasks: includeTasks ? getSessionTasks(sessionId) : [],
      linkedSessions: includeLinks ? getLinkedSessions(sessionId) : [],
    }],
    learnings: [],
    tasks: [],
  };
}

/**
 * Check if agent can access a session
 */
function canAccessSession(agentId: number | null, session: SessionRecord): boolean {
  // Orchestrator (null) can access everything
  if (agentId === null) return true;
  // Owner can always access
  if (session.agent_id === agentId) return true;
  // Orchestrator sessions are public by default
  if (session.agent_id === null) return true;
  // Check visibility
  return session.visibility === 'shared' || session.visibility === 'public';
}

/**
 * Check if agent can access a learning
 */
function canAccessLearning(agentId: number | null, learning: LearningRecord): boolean {
  // Orchestrator (null) can access everything
  if (agentId === null) return true;
  // Owner can always access
  if (learning.agent_id === agentId) return true;
  // Orchestrator learnings are public by default
  if (learning.agent_id === null) return true;
  // Check visibility
  return learning.visibility === 'shared' || learning.visibility === 'public';
}

/**
 * Recall by exact learning ID
 */
async function recallLearningById(
  query: string,
  includeLinks: boolean,
  agentId?: number | null
): Promise<RecallResult> {
  const learningId = extractLearningId(query);

  if (!learningId) {
    return {
      type: 'exact_match',
      query,
      sessions: [],
      learnings: [],
      tasks: [],
    };
  }

  const learning = getLearningById(learningId);

  if (!learning) {
    return {
      type: 'exact_match',
      query,
      sessions: [],
      learnings: [],
      tasks: [],
    };
  }

  // Check access if agentId is specified
  if (agentId !== undefined && !canAccessLearning(agentId, learning)) {
    return {
      type: 'exact_match',
      query,
      sessions: [],
      learnings: [],
      tasks: [],
    };
  }

  return {
    type: 'exact_match',
    query,
    sessions: [],
    learnings: [{
      learning,
      linkedLearnings: includeLinks ? getLinkedLearnings(learningId) : [],
    }],
    tasks: [],
  };
}

/**
 * Recall by semantic search
 */
async function recallBySearch(
  query: string,
  limit: number,
  includeLinks: boolean,
  includeTasks: boolean,
  agentId?: number | null,
  includeShared: boolean = true
): Promise<RecallResult> {
  // Initialize vector DB if needed
  if (!isInitialized()) {
    await initVectorDB();
  }

  // Build search options with agent scoping
  const searchOptions = { limit, agentId, includeShared };

  // Run parallel searches
  const [sessionResults, learningResults, taskResults] = await Promise.all([
    searchSessions(query, searchOptions),
    searchLearnings(query, { ...searchOptions, limit: limit + 2 }),
    searchSessionTasks(query, limit),
  ]);

  // Process session results
  const sessionsWithContext: SessionWithContext[] = [];
  if (sessionResults.ids[0]?.length) {
    for (let i = 0; i < sessionResults.ids[0].length; i++) {
      const id = sessionResults.ids[0][i];
      const distance = sessionResults.distances?.[0]?.[i] || 0;
      const session = getSessionById(id);

      // Double-check access (belt and suspenders with ChromaDB filtering)
      if (session && (agentId === undefined || canAccessSession(agentId, session))) {
        sessionsWithContext.push({
          session,
          tasks: includeTasks ? getSessionTasks(id) : [],
          linkedSessions: includeLinks ? getLinkedSessions(id) : [],
          similarity: 1 - distance,
        });
      }
    }
  }

  // Process learning results
  const learningsWithContext: LearningWithContext[] = [];
  if (learningResults.ids[0]?.length) {
    for (let i = 0; i < learningResults.ids[0].length; i++) {
      const id = learningResults.ids[0][i];
      const numId = parseInt(id.replace('learning_', ''));
      const distance = learningResults.distances?.[0]?.[i] || 0;
      const learning = getLearningById(numId);

      // Double-check access
      if (learning && (agentId === undefined || canAccessLearning(agentId, learning))) {
        learningsWithContext.push({
          learning,
          linkedLearnings: includeLinks && learning.id ? getLinkedLearnings(learning.id) : [],
          similarity: 1 - distance,
        });
      }
    }
  }

  // Process task results (already in correct format from searchSessionTasks)
  const tasks: TaskSearchResult[] = taskResults.map(t => ({
    id: t.id,
    session_id: t.session_id,
    description: t.description,
    status: t.status,
    notes: t.notes,
    similarity: t.similarity,
  }));

  return {
    type: 'semantic_search',
    query,
    sessions: sessionsWithContext,
    learnings: learningsWithContext,
    tasks,
  };
}

// ============ Convenience Functions ============

/**
 * Get full session details with all context
 */
export function getSessionDetails(sessionId: string): SessionWithContext | null {
  const session = getSessionById(sessionId);
  if (!session) return null;

  return {
    session,
    tasks: getSessionTasks(sessionId),
    linkedSessions: getLinkedSessions(sessionId),
  };
}

/**
 * Get full learning details with all context
 */
export function getLearningDetails(learningId: number): LearningWithContext | null {
  const learning = getLearningById(learningId);
  if (!learning) return null;

  return {
    learning,
    linkedLearnings: getLinkedLearnings(learningId),
  };
}
