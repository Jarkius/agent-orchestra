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
  searchLearningsFTS,
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

import {
  detectTaskType,
  executeSmartRetrieval,
  type TaskType,
} from '../learning/context-router';

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
  return parseInt(match[1] ?? match[2] ?? '0');
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
  useSmartRetrieval?: boolean;  // Use context-aware retrieval with category boosting
  projectPath?: string;  // Filter by project/git root path for matrix scoping
}

// ============ Hybrid Search ============

/**
 * Extract parent learning ID from a potentially chunked ID
 * e.g., "1551_chunk_0" -> 1551, "1551" -> 1551
 */
function extractParentLearningId(id: string): number {
  // Remove "learning_" prefix if present
  const idStr = id.replace('learning_', '');
  // Extract parent ID (before "_chunk_" suffix)
  const parentId = idStr.split('_chunk_')[0];
  return parseInt(parentId || '0');
}

/**
 * Hybrid search combining vector similarity + keyword matching
 * Returns deduplicated learning IDs with combined scores
 */
export async function hybridSearchLearnings(
  query: string,
  options: {
    limit?: number;
    vectorWeight?: number;
    keywordWeight?: number;
    agentId?: number | null;
    includeShared?: boolean;
    projectPath?: string;
  } = {}
): Promise<Array<{ id: number; score: number; vectorScore: number; keywordScore: number }>> {
  const {
    limit = 10,
    vectorWeight = 0.6,
    keywordWeight = 0.4,
    agentId,
    includeShared = true,
    projectPath,
  } = options;

  // Run vector and keyword searches in parallel
  const [vectorResults, ftsResults] = await Promise.all([
    searchLearnings(query, { limit: limit * 2, agentId, includeShared, projectPath }),
    Promise.resolve(searchLearningsFTS(query, limit * 2)),
  ]);

  // Score map: learningId -> { vector: score, keyword: score }
  const scoreMap = new Map<number, { vector: number; keyword: number }>();

  // Process vector results (deduplicate chunks to parent IDs)
  if (vectorResults.ids[0]?.length) {
    for (let i = 0; i < vectorResults.ids[0].length; i++) {
      const id = vectorResults.ids[0][i]!;
      const parentId = extractParentLearningId(id);
      const distance = vectorResults.distances?.[0]?.[i] ?? 1;
      const similarity = 1 - distance;

      const existing = scoreMap.get(parentId);
      if (existing) {
        // Take the best score for this parent (in case multiple chunks match)
        existing.vector = Math.max(existing.vector, similarity);
      } else {
        scoreMap.set(parentId, { vector: similarity, keyword: 0 });
      }
    }
  }

  // Process FTS results (rank-based scoring)
  if (ftsResults.length > 0) {
    for (let i = 0; i < ftsResults.length; i++) {
      const id = ftsResults[i]!.id!;
      // FTS rank is negative (more negative = better match), normalize to 0-1
      // Use position-based scoring: first result gets 1.0, gradually decreasing
      const score = 1 - (i / Math.max(ftsResults.length, 1));

      const existing = scoreMap.get(id);
      if (existing) {
        existing.keyword = Math.max(existing.keyword, score);
      } else {
        scoreMap.set(id, { vector: 0, keyword: score });
      }
    }
  }

  // Calculate hybrid scores and sort
  const results = [...scoreMap.entries()]
    .map(([id, scores]) => ({
      id,
      score: scores.vector * vectorWeight + scores.keyword * keywordWeight,
      vectorScore: scores.vector,
      keywordScore: scores.keyword,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

// ============ Main Recall Function ============

/**
 * Smart recall - detects query type and handles appropriately
 */
export async function recall(query: string | undefined, options: RecallOptions = {}): Promise<RecallResult> {
  const { limit = 5, includeLinks = true, includeTasks = true, agentId, includeShared = true, useSmartRetrieval = true, projectPath } = options;
  const queryType = detectQueryType(query);
  const normalizedQuery = query?.trim() || '';

  switch (queryType) {
    case 'recent':
      return recallRecent(limit, includeLinks, includeTasks, agentId, includeShared, projectPath);

    case 'session_id':
      return recallSessionById(normalizedQuery, includeLinks, includeTasks, agentId, projectPath);

    case 'learning_id':
      return recallLearningById(normalizedQuery, includeLinks, agentId, projectPath);

    case 'search':
      return recallBySearch(normalizedQuery, limit, includeLinks, includeTasks, agentId, includeShared, useSmartRetrieval, projectPath);
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
  includeShared: boolean = true,
  projectPath?: string
): Promise<RecallResult> {
  // Get the most recent session for resuming (with agent and project scoping)
  const sessions = listSessionsFromDb({
    limit: 1,
    agentId,
    includeShared,
    projectPath,
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

  const latestSession = sessions[0]!;

  // Get full context for the latest session
  const sessionsWithContext: SessionWithContext[] = [{
    session: latestSession,
    tasks: includeTasks ? getSessionTasks(latestSession.id) : [],
    linkedSessions: includeLinks ? getLinkedSessions(latestSession.id) : [],
  }];

  // Also get high-confidence learnings that might be relevant (with agent and project scoping)
  const relevantLearnings = listLearningsFromDb({
    confidence: 'high',
    limit: 5,
    agentId,
    includeShared,
    projectPath,
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
 * Note: For exact ID lookup, we allow access regardless of project to enable cross-project session viewing
 */
async function recallSessionById(
  sessionId: string,
  includeLinks: boolean,
  includeTasks: boolean,
  agentId?: number | null,
  _projectPath?: string  // Not used for exact ID lookup - allows cross-project access
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
 * Note: For exact ID lookup, we allow access regardless of project to enable cross-project learning viewing
 */
async function recallLearningById(
  query: string,
  includeLinks: boolean,
  agentId?: number | null,
  _projectPath?: string  // Not used for exact ID lookup - allows cross-project access
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
 * Recall by semantic search - with optional context-aware retrieval
 */
async function recallBySearch(
  query: string,
  limit: number,
  includeLinks: boolean,
  includeTasks: boolean,
  agentId?: number | null,
  includeShared: boolean = true,
  useSmartRetrieval: boolean = true,
  projectPath?: string
): Promise<RecallResult> {
  // Initialize vector DB if needed
  if (!isInitialized()) {
    await initVectorDB();
  }

  // Detect task type for context-aware retrieval
  const taskContext = detectTaskType(query);
  console.log(`[Recall] Detected task type: ${taskContext.type} (confidence: ${(taskContext.confidence * 100).toFixed(0)}%)`);

  // Build search options with agent and project scoping
  const searchOptions = { limit, agentId, includeShared, projectPath };

  // Run parallel searches
  // Learnings handled separately for smart retrieval with category boosting
  const [sessionResults, taskResults] = await Promise.all([
    searchSessions(query, searchOptions),
    searchSessionTasks(query, limit),
  ]);

  // For learnings, use hybrid search (vector + keyword) for better recall
  // This combines semantic similarity with exact keyword matching
  // Weights tuned via validation feedback loop (see scripts/memory/validate-search.ts)
  const hybridResults = await hybridSearchLearnings(query, {
    limit: limit + 2,
    agentId,
    includeShared,
    projectPath,
    // Tuned weights: FTS outperforms vector for keyword queries
    vectorWeight: 0.36,
    keywordWeight: 0.64,
  });

  // Convert hybrid results to expected format for processing below
  const learningResults = {
    ids: [hybridResults.map(r => String(r.id))],
    distances: [hybridResults.map(r => 1 - r.score)],
  };

  console.log(`[Recall] Hybrid search: ${hybridResults.length} results (query: "${query}")`);
  if (hybridResults.length > 0) {
    console.log(`[Recall] Top result: #${hybridResults[0]!.id} (score: ${hybridResults[0]!.score.toFixed(3)}, vector: ${hybridResults[0]!.vectorScore.toFixed(3)}, keyword: ${hybridResults[0]!.keywordScore.toFixed(3)})`);
  }

  // Process session results
  const sessionsWithContext: SessionWithContext[] = [];
  if (sessionResults.ids[0]?.length) {
    for (let i = 0; i < sessionResults.ids[0].length; i++) {
      const id = sessionResults.ids[0]![i]!;
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

  // Process learning results (hybrid search already returns parent IDs)
  const learningsWithContext: LearningWithContext[] = [];
  if (learningResults.ids[0]?.length) {
    for (let i = 0; i < learningResults.ids[0].length; i++) {
      const id = learningResults.ids[0]![i]!;
      // Hybrid search returns numeric IDs as strings (already deduplicated from chunks)
      const numId = parseInt(id);
      if (isNaN(numId)) continue;

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
