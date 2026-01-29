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
  logSearch,
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
  getRetrievalStrategy,
  executeSmartRetrieval,
  type TaskType,
} from '../learning/context-router';
import type { LearningCategory } from '../interfaces/learning';
import { expandQuery, type ExpandedQuery } from './query-expansion';

// ============ Query Cache ============

interface CachedResult {
  results: Array<{ id: number; score: number; vectorScore: number; keywordScore: number }>;
  timestamp: number;
}

const queryCache = new Map<string, CachedResult>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Max entries before LRU eviction

/**
 * Get cached results for a query if still valid
 */
function getCachedResults(cacheKey: string): CachedResult['results'] | null {
  const cached = queryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.results;
  }
  // Remove stale entry
  if (cached) {
    queryCache.delete(cacheKey);
  }
  return null;
}

/**
 * Store results in cache with LRU eviction
 */
function setCachedResults(cacheKey: string, results: CachedResult['results']): void {
  // LRU eviction: remove oldest entries if at capacity
  if (queryCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = queryCache.keys().next().value;
    if (oldestKey) queryCache.delete(oldestKey);
  }
  queryCache.set(cacheKey, { results, timestamp: Date.now() });
}

/**
 * Clear query cache (call when new learnings are added)
 */
export function clearQueryCache(): void {
  queryCache.clear();
}

// ============ MMR Reranking ============

interface ScoredResult {
  id: number;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

/**
 * Maximal Marginal Relevance (MMR) reranking for result diversity
 *
 * MMR iteratively selects results that are both relevant and diverse.
 * Since we don't have raw embeddings, we use a score-based heuristic:
 * - Results with similar scores (vector & keyword) are considered similar
 * - We penalize selecting results too close to already-selected ones
 *
 * @param results - Sorted results from hybrid search
 * @param lambda - Balance: 1.0 = pure relevance, 0.0 = pure diversity (default: 0.7)
 * @param limit - Max results to return
 * @returns Reranked results with diversity
 */
export function mmrRerank(
  results: ScoredResult[],
  lambda: number = 0.7,
  limit: number = 10
): ScoredResult[] {
  if (results.length <= limit) {
    return results;
  }

  const selected: ScoredResult[] = [];
  const remaining = [...results];

  // Always select the top result first
  if (remaining.length > 0) {
    selected.push(remaining.shift()!);
  }

  while (selected.length < limit && remaining.length > 0) {
    let bestScore = -Infinity;
    let bestIdx = 0;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const relevance = candidate.score;

      // Calculate max similarity to already selected results
      // Using score profile similarity as a proxy for content similarity
      const maxSimilarity = Math.max(
        ...selected.map(s => scoreSimilarity(candidate, s))
      );

      // MMR formula: λ * relevance - (1-λ) * max_similarity
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]!);
  }

  return selected;
}

/**
 * Calculate similarity between two results based on their score profiles
 * Results with similar vector/keyword score ratios are likely similar content
 */
function scoreSimilarity(a: ScoredResult, b: ScoredResult): number {
  // Normalize scores to 0-1 range
  const aVec = a.vectorScore;
  const aKey = a.keywordScore;
  const bVec = b.vectorScore;
  const bKey = b.keywordScore;

  // Euclidean distance in score space, converted to similarity
  const distance = Math.sqrt(
    Math.pow(aVec - bVec, 2) + Math.pow(aKey - bKey, 2)
  );

  // Max possible distance is sqrt(2) ≈ 1.41
  // Convert to similarity: 1 - normalized_distance
  return 1 - (distance / 1.41);
}

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
  expand?: boolean;  // Enable query expansion for better recall
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

// Configurable hybrid search weights via environment variables
// Previous tuning found 0.36/0.64 (vector/keyword) worked well
const DEFAULT_VECTOR_WEIGHT = parseFloat(process.env.VECTOR_WEIGHT || '0.36');
const DEFAULT_KEYWORD_WEIGHT = parseFloat(process.env.KEYWORD_WEIGHT || '0.64');

/**
 * Hybrid search combining vector similarity + keyword matching
 * Returns deduplicated learning IDs with combined scores
 *
 * @param useMMR - Enable MMR reranking for diverse results (default: true)
 * @param mmrLambda - MMR balance: 1.0 = relevance only, 0.0 = diversity only (default: 0.7)
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
    skipCache?: boolean;
    useMMR?: boolean;
    mmrLambda?: number;
  } = {}
): Promise<Array<{ id: number; score: number; vectorScore: number; keywordScore: number }>> {
  const startTime = Date.now();
  const {
    limit = 10,
    vectorWeight = DEFAULT_VECTOR_WEIGHT,
    keywordWeight = DEFAULT_KEYWORD_WEIGHT,
    agentId,
    includeShared = true,
    projectPath,
    skipCache = false,
    useMMR = true,
    mmrLambda = 0.7,
  } = options;

  // Generate cache key from query parameters
  const cacheKey = JSON.stringify({ query, limit, agentId, includeShared, projectPath });

  // Check cache first (unless explicitly skipped)
  if (!skipCache) {
    const cached = getCachedResults(cacheKey);
    if (cached) {
      return cached;
    }
  }

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
  let results = [...scoreMap.entries()]
    .map(([id, scores]) => ({
      id,
      score: scores.vector * vectorWeight + scores.keyword * keywordWeight,
      vectorScore: scores.vector,
      keywordScore: scores.keyword,
    }))
    .sort((a, b) => b.score - a.score);

  // Apply MMR reranking for diversity if enabled
  // Fetch more than needed, then rerank and slice
  if (useMMR && results.length > limit) {
    results = mmrRerank(results, mmrLambda, limit);
  } else {
    results = results.slice(0, limit);
  }

  // Cache results for future queries
  setCachedResults(cacheKey, results);

  // Log the search for analytics
  logSearch({
    query,
    query_type: 'hybrid',
    result_count: results.length,
    latency_ms: Date.now() - startTime,
    source: 'recall-service',
    agent_id: agentId,
  });

  return results;
}

// ============ Main Recall Function ============

/**
 * Smart recall - detects query type and handles appropriately
 */
export async function recall(query: string | undefined, options: RecallOptions = {}): Promise<RecallResult> {
  const { limit = 5, includeLinks = true, includeTasks = true, agentId, includeShared = true, useSmartRetrieval = true, projectPath, expand = false } = options;
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
      if (expand) {
        return recallWithExpansion(normalizedQuery, limit, includeLinks, includeTasks, agentId, includeShared, projectPath);
      }
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

  // Detect task type for context-aware retrieval with category boosting
  const taskContext = detectTaskType(query);
  const retrievalStrategy = getRetrievalStrategy(taskContext.type);
  console.log(`[Recall] Detected task type: ${taskContext.type} (confidence: ${(taskContext.confidence * 100).toFixed(0)}%)`);
  console.log(`[Recall] Category boosts: ${Object.entries(retrievalStrategy.categoryBoost).filter(([_, v]) => v > 1).map(([k, v]) => `${k}:${v}x`).join(', ') || 'none'}`);

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

  // Process learning results with category boosting
  // Hybrid search already returns parent IDs; we apply task-aware boosts to rerank
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
        // Apply category boost based on task type (1.0 default, 1.5 preferred, 2.0 highly preferred)
        const categoryBoost = retrievalStrategy.categoryBoost[learning.category as LearningCategory] || 1.0;
        const baseSimilarity = 1 - distance;
        const boostedSimilarity = baseSimilarity * categoryBoost;

        learningsWithContext.push({
          learning,
          linkedLearnings: includeLinks && learning.id ? getLinkedLearnings(learning.id) : [],
          similarity: boostedSimilarity,  // Boosted score for ranking
        });
      }
    }

    // Re-sort by boosted similarity score to surface task-relevant learnings
    learningsWithContext.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

    // Log category boost effect if any learnings were boosted
    const boostedCount = learningsWithContext.filter(l => {
      const cat = l.learning.category as LearningCategory;
      return (retrievalStrategy.categoryBoost[cat] || 1) > 1;
    }).length;
    if (boostedCount > 0) {
      console.log(`[Recall] Category boosting: ${boostedCount}/${learningsWithContext.length} learnings boosted for ${taskContext.type} task`);
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

/**
 * Recall with query expansion - searches with multiple query variants
 * for better recall on ambiguous or abbreviated queries
 */
async function recallWithExpansion(
  query: string,
  limit: number,
  includeLinks: boolean,
  includeTasks: boolean,
  agentId?: number | null,
  includeShared: boolean = true,
  projectPath?: string
): Promise<RecallResult> {
  // Expand the query into variants
  const expanded = expandQuery(query);
  console.log(`[Recall] Query expansion: ${expanded.variants.length} variants from "${query}"`);
  if (expanded.variants.length > 1) {
    console.log(`[Recall] Variants: ${expanded.variants.slice(1).join(', ')}`);
  }

  // Collect all results from all variants
  const allLearnings = new Map<number, LearningWithContext>();
  const allSessions = new Map<string, SessionWithContext>();

  // Search with each variant (in parallel for speed)
  const searchPromises = expanded.variants.slice(0, 3).map(async (variant, idx) => {
    const weight = idx === 0 ? 1.0 : 0.8; // Original query gets full weight
    const result = await recallBySearch(
      variant,
      Math.ceil(limit * 1.5), // Get extra results per variant
      includeLinks,
      includeTasks,
      agentId,
      includeShared,
      true, // useSmartRetrieval
      projectPath
    );

    // Collect learnings with weighted scores
    for (const l of result.learnings || []) {
      if (l.learning.id) {
        const existing = allLearnings.get(l.learning.id);
        if (existing) {
          // Boost score if found by multiple variants
          existing.similarity = Math.max(existing.similarity || 0, (l.similarity || 0) * weight) * 1.1;
        } else {
          allLearnings.set(l.learning.id, {
            ...l,
            similarity: (l.similarity || 0) * weight,
          });
        }
      }
    }

    // Collect sessions with weighted scores
    for (const s of result.sessions || []) {
      const existing = allSessions.get(s.session.id);
      if (existing) {
        existing.similarity = Math.max(existing.similarity || 0, (s.similarity || 0) * weight) * 1.1;
      } else {
        allSessions.set(s.session.id, {
          ...s,
          similarity: (s.similarity || 0) * weight,
        });
      }
    }
  });

  await Promise.all(searchPromises);

  // Sort and limit results
  const learnings = Array.from(allLearnings.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, limit);

  const sessions = Array.from(allSessions.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, limit);

  console.log(`[Recall] Expansion found: ${learnings.length} learnings, ${sessions.length} sessions (deduplicated)`);

  return {
    type: 'semantic_search',
    query,
    sessions,
    learnings,
    tasks: [], // Tasks not deduplicated in expansion mode
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
