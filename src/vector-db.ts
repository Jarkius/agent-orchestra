/**
 * Vector Database Module
 * ChromaDB integration for semantic search and agent memory
 *
 * Collections:
 * - task_prompts: What agents were asked to do
 * - task_results: What agents produced
 * - messages_inbound: Orchestrator → Agent communication
 * - messages_outbound: Agent → Orchestrator communication
 * - shared_context: Version history of shared context
 *
 * Embedding: Transformers.js (bge-small-en-v1.5, nomic, minilm)
 * Configure model via EMBEDDING_MODEL env var
 */

import { ChromaClient, type Collection, type EmbeddingFunction, type Where } from 'chromadb';
import { createEmbeddingFunction, getEmbeddingConfig } from './embeddings';

// ChromaDB client - connects to server at localhost:8100
// Start server with: chroma run --path ./chroma_data --port 8100
let client: ChromaClient | null = null;
let embeddingFunction: EmbeddingFunction | null = null;

// Staleness tracking - when writes fail, index becomes stale
let indexStale = false;
let lastSuccessfulWrite = Date.now();
let consecutiveFailures = 0;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;

/**
 * Get staleness status - useful for deciding when to reindex
 */
export function getIndexStatus(): { stale: boolean; consecutiveFailures: number; lastSuccessfulWrite: Date } {
  return {
    stale: indexStale,
    consecutiveFailures,
    lastSuccessfulWrite: new Date(lastSuccessfulWrite),
  };
}

/**
 * Mark index as fresh (call after successful reindex)
 */
export function markIndexFresh(): void {
  indexStale = false;
  consecutiveFailures = 0;
  lastSuccessfulWrite = Date.now();
}

/**
 * Retry wrapper with exponential backoff
 * Returns result on success, null on failure (best-effort)
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  throwOnFailure = false
): Promise<T | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await operation();
      // Success - reset failure tracking
      consecutiveFailures = 0;
      lastSuccessfulWrite = Date.now();
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if it's a retryable error
      const errorMsg = lastError.message.toLowerCase();
      const isRetryable = errorMsg.includes('compaction') ||
                          errorMsg.includes('timeout') ||
                          errorMsg.includes('connection') ||
                          errorMsg.includes('econnrefused');

      if (!isRetryable || attempt === MAX_RETRIES - 1) {
        break;
      }

      // Exponential backoff
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.error(`[VectorDB] ${operationName} failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries failed
  consecutiveFailures++;
  if (consecutiveFailures >= 3) {
    indexStale = true;
  }

  console.error(`[VectorDB] ${operationName} failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);

  if (throwOnFailure) {
    throw lastError;
  }
  return null;
}

function getClient(): ChromaClient {
  if (!client) {
    const url = process.env.CHROMA_URL || "http://localhost:8100";
    const parsed = new URL(url);
    client = new ChromaClient({
      host: parsed.hostname,
      port: parseInt(parsed.port) || 8100,
      ssl: parsed.protocol === 'https:'
    });
  }
  return client;
}

async function getEmbeddingFunction(): Promise<EmbeddingFunction> {
  if (!embeddingFunction) {
    const config = getEmbeddingConfig();
    console.error(`[VectorDB] Using Transformers.js with model: ${config.model}`);
    embeddingFunction = await createEmbeddingFunction(config);
  }
  return embeddingFunction;
}

interface VectorCollections {
  tasks: Collection;
  results: Collection;
  messagesIn: Collection;
  messagesOut: Collection;
  context: Collection;
  sessions: Collection;
  learnings: Collection;
  sessionTasks: Collection;
  knowledge: Collection;  // Dual-collection: raw facts/observations
  lessons: Collection;    // Dual-collection: problem→solution→outcome
}

let collections: VectorCollections | null = null;
let initialized = false;

// ============ Initialization ============

export async function initVectorDB(): Promise<void> {
  if (initialized) return;

  // Suppress noisy ChromaDB collection deserialization warnings
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = String(args[0] || '');
    if (!msg.includes('embedding function configuration')) {
      originalWarn.apply(console, args);
    }
  };

  try {
    const chromaClient = getClient();
    const embedFn = await getEmbeddingFunction();
    collections = {
      tasks: await chromaClient.getOrCreateCollection({
        name: "task_prompts",
        metadata: { "hnsw:space": "cosine" },
        embeddingFunction: embedFn,
      }),
      results: await chromaClient.getOrCreateCollection({
        name: "task_results",
        metadata: { "hnsw:space": "cosine" },
        embeddingFunction: embedFn,
      }),
      messagesIn: await chromaClient.getOrCreateCollection({
        name: "messages_inbound",
        metadata: { "hnsw:space": "cosine" },
        embeddingFunction: embedFn,
      }),
      messagesOut: await chromaClient.getOrCreateCollection({
        name: "messages_outbound",
        metadata: { "hnsw:space": "cosine" },
        embeddingFunction: embedFn,
      }),
      context: await chromaClient.getOrCreateCollection({
        name: "shared_context",
        metadata: { "hnsw:space": "cosine" },
        embeddingFunction: embedFn,
      }),
      sessions: await chromaClient.getOrCreateCollection({
        name: "orchestrator_sessions",
        metadata: { "hnsw:space": "cosine" },
        embeddingFunction: embedFn,
      }),
      learnings: await chromaClient.getOrCreateCollection({
        name: "orchestrator_learnings",
        metadata: { "hnsw:space": "cosine" },
        embeddingFunction: embedFn,
      }),
      sessionTasks: await chromaClient.getOrCreateCollection({
        name: "session_tasks",
        metadata: { "hnsw:space": "cosine" },
        embeddingFunction: embedFn,
      }),
      knowledge: await chromaClient.getOrCreateCollection({
        name: "knowledge_entries",
        metadata: { "hnsw:space": "cosine" },
        embeddingFunction: embedFn,
      }),
      lessons: await chromaClient.getOrCreateCollection({
        name: "lesson_entries",
        metadata: { "hnsw:space": "cosine" },
        embeddingFunction: embedFn,
      }),
    };
    initialized = true;
    console.error("[VectorDB] Initialized with 10 collections");
  } catch (error) {
    console.error("[VectorDB] Failed to initialize:", error);
    throw error;
  } finally {
    console.warn = originalWarn;
  }
}

function ensureInitialized(): VectorCollections {
  if (!collections) {
    throw new Error("VectorDB not initialized. Call initVectorDB() first.");
  }
  return collections;
}

/**
 * Reconnect to ChromaDB and refresh all collection references.
 * Use after reindex or reset to ensure fresh connections.
 */
export async function reconnectVectorDB(): Promise<void> {
  console.error("[VectorDB] Reconnecting...");

  // Reset state
  initialized = false;
  collections = null;
  client = null;
  // Keep embeddingFunction - model doesn't need reload

  // Reinitialize
  await initVectorDB();
  console.error("[VectorDB] Reconnected successfully");
}

// ============ TASK EMBEDDINGS ============

export async function embedTask(
  taskId: string,
  prompt: string,
  metadata: {
    agent_id: number;
    priority?: string;
    created_at: string;
  }
): Promise<void> {
  const cols = ensureInitialized();
  try {
    await cols.tasks.add({
      ids: [taskId],
      documents: [prompt],
      metadatas: [{ ...metadata, type: 'task_prompt' }]
    });
  } catch (error) {
    console.error(`[VectorDB] Failed to embed task ${taskId}:`, error);
  }
}

export async function embedResult(
  taskId: string,
  result: string,
  metadata: {
    agent_id: number;
    status: string;
    duration_ms: number;
    completed_at: string;
  }
): Promise<void> {
  const cols = ensureInitialized();
  try {
    await cols.results.add({
      ids: [taskId],
      documents: [result],
      metadatas: [{ ...metadata, type: 'task_result' }]
    });
  } catch (error) {
    console.error(`[VectorDB] Failed to embed result ${taskId}:`, error);
  }
}

// ============ MESSAGE EMBEDDINGS ============

export async function embedMessage(
  messageId: string,
  content: string,
  direction: 'inbound' | 'outbound',
  metadata: {
    agent_id: number;
    message_type: string;
    source?: string;
    created_at: string;
  }
): Promise<void> {
  const cols = ensureInitialized();
  const collection = direction === 'inbound' ? cols.messagesIn : cols.messagesOut;

  try {
    await collection.add({
      ids: [messageId],
      documents: [content],
      metadatas: [{ ...metadata, direction }]
    });
  } catch (error) {
    console.error(`[VectorDB] Failed to embed message ${messageId}:`, error);
  }
}

// ============ CONTEXT EMBEDDINGS ============

export async function embedContext(
  versionId: string,
  content: string,
  metadata: {
    updated_by: string;
    created_at: string;
  }
): Promise<void> {
  const cols = ensureInitialized();
  try {
    await cols.context.add({
      ids: [versionId],
      documents: [content],
      metadatas: [{ ...metadata, type: 'shared_context' }]
    });
  } catch (error) {
    console.error(`[VectorDB] Failed to embed context ${versionId}:`, error);
  }
}

// ============ SEARCH FUNCTIONS ============

export interface SearchResult {
  ids: string[][];
  documents: (string | null)[][];
  metadatas: (Record<string, unknown> | null)[][];
  distances?: number[][];
}

export async function searchSimilarTasks(
  query: string,
  limit = 5,
  agentId?: number
): Promise<SearchResult> {
  const cols = ensureInitialized();
  const where = agentId ? { agent_id: agentId } : undefined;

  return await cols.tasks.query({
    queryTexts: [query],
    nResults: limit,
    where,
  }) as SearchResult;
}

export async function searchSimilarResults(
  query: string,
  limit = 5
): Promise<SearchResult> {
  const cols = ensureInitialized();

  return await cols.results.query({
    queryTexts: [query],
    nResults: limit,
  }) as SearchResult;
}

export async function searchMessageHistory(
  query: string,
  direction?: 'inbound' | 'outbound',
  limit = 10,
  agentId?: number
): Promise<{ inbound?: SearchResult; outbound?: SearchResult } | SearchResult> {
  const cols = ensureInitialized();
  const where = agentId ? { agent_id: agentId } : undefined;

  // Search specific direction
  if (direction === 'inbound') {
    return await cols.messagesIn.query({
      queryTexts: [query],
      nResults: limit,
      where,
    }) as SearchResult;
  }

  if (direction === 'outbound') {
    return await cols.messagesOut.query({
      queryTexts: [query],
      nResults: limit,
      where,
    }) as SearchResult;
  }

  // Search both directions
  const [inResults, outResults] = await Promise.all([
    cols.messagesIn.query({ queryTexts: [query], nResults: limit, where }),
    cols.messagesOut.query({ queryTexts: [query], nResults: limit, where }),
  ]);

  return {
    inbound: inResults as SearchResult,
    outbound: outResults as SearchResult,
  };
}

export async function searchContext(
  query: string,
  limit = 3
): Promise<SearchResult> {
  const cols = ensureInitialized();

  return await cols.context.query({
    queryTexts: [query],
    nResults: limit,
  }) as SearchResult;
}

// ============ COMBINED MEMORY SEARCH ============

export interface RelatedMemory {
  tasks: SearchResult | null;
  results: SearchResult | null;
  messages: { inbound?: SearchResult; outbound?: SearchResult } | null;
  context: SearchResult | null;
}

export async function getRelatedMemory(
  query: string,
  options?: {
    includeTasks?: boolean;
    includeResults?: boolean;
    includeMessages?: boolean;
    includeContext?: boolean;
    limit?: number;
  }
): Promise<RelatedMemory> {
  const {
    includeTasks = true,
    includeResults = true,
    includeMessages = true,
    includeContext = false,
    limit = 5
  } = options || {};

  const searches: Promise<any>[] = [];
  const keys: (keyof RelatedMemory)[] = [];

  if (includeTasks) {
    searches.push(searchSimilarTasks(query, limit));
    keys.push('tasks');
  }
  if (includeResults) {
    searches.push(searchSimilarResults(query, limit));
    keys.push('results');
  }
  if (includeMessages) {
    searches.push(searchMessageHistory(query, undefined, limit));
    keys.push('messages');
  }
  if (includeContext) {
    searches.push(searchContext(query, limit));
    keys.push('context');
  }

  const results = await Promise.all(searches);

  const memory: RelatedMemory = {
    tasks: null,
    results: null,
    messages: null,
    context: null,
  };

  keys.forEach((key, i) => {
    (memory as any)[key] = results[i];
  });

  return memory;
}

// ============ UTILITY FUNCTIONS ============

export async function getCollectionStats(): Promise<Record<string, number>> {
  const cols = ensureInitialized();

  const [tasks, results, messagesIn, messagesOut, context, sessions, learnings, sessionTasks, knowledge, lessons] = await Promise.all([
    cols.tasks.count(),
    cols.results.count(),
    cols.messagesIn.count(),
    cols.messagesOut.count(),
    cols.context.count(),
    cols.sessions.count(),
    cols.learnings.count(),
    cols.sessionTasks.count(),
    cols.knowledge.count(),
    cols.lessons.count(),
  ]);

  return {
    task_prompts: tasks,
    task_results: results,
    messages_inbound: messagesIn,
    messages_outbound: messagesOut,
    shared_context: context,
    orchestrator_sessions: sessions,
    orchestrator_learnings: learnings,
    session_tasks: sessionTasks,
    knowledge_entries: knowledge,
    lesson_entries: lessons,
  };
}

// ============ SESSION PERSISTENCE ============

export interface SessionMetadata {
  tags?: string[];
  created_at: string;
  agent_id?: number | null;
  visibility?: string;
  [key: string]: unknown;
}

export async function saveSession(
  sessionId: string,
  summary: string,
  metadata: SessionMetadata
): Promise<void> {
  const cols = ensureInitialized();
  // ChromaDB only supports primitive metadata values - convert arrays to CSV
  const chromaMetadata: Record<string, string | number | boolean> = {
    created_at: metadata.created_at,
    tags: metadata.tags?.join(',') || '',
    agent_id: metadata.agent_id ?? -1, // ChromaDB doesn't support null, use -1 for orchestrator
    visibility: metadata.visibility || 'public',
  };

  // Best-effort write with retry
  await withRetry(
    () => cols.sessions.add({
      ids: [sessionId],
      documents: [summary],
      metadatas: [chromaMetadata],
    }),
    `save session ${sessionId}`
  );
}

export interface SessionSearchOptions {
  limit?: number;
  agentId?: number | null;
  includeShared?: boolean;
}

export async function searchSessions(
  query: string,
  limitOrOptions: number | SessionSearchOptions = 3
): Promise<SearchResult> {
  const cols = ensureInitialized();

  // Support both old (limit number) and new (options object) signatures
  const options = typeof limitOrOptions === 'number'
    ? { limit: limitOrOptions }
    : limitOrOptions;
  const { limit = 3, agentId, includeShared = true } = options;

  // Build where clause for agent filtering
  let where: Where | undefined;
  if (agentId !== undefined) {
    const agentIdValue = agentId ?? -1;
    if (includeShared) {
      // ChromaDB doesn't have OR conditions, so we use $or operator
      where = {
        $or: [
          { agent_id: agentIdValue },
          { agent_id: -1 }, // orchestrator
          { visibility: 'shared' },
          { visibility: 'public' },
        ],
      } as Where;
    } else {
      where = { agent_id: agentIdValue } as Where;
    }
  }

  return await cols.sessions.query({
    queryTexts: [query],
    nResults: limit,
    where,
  }) as SearchResult;
}

export async function listSessions(limit = 10): Promise<{
  ids: string[];
  summaries: (string | null)[];
  metadatas: (Record<string, unknown> | null)[];
}> {
  const cols = ensureInitialized();
  const result = await cols.sessions.get({
    limit,
  });
  return {
    ids: result.ids,
    summaries: result.documents,
    metadatas: result.metadatas,
  };
}

// ============ LEARNING PERSISTENCE ============

export interface LearningMetadata {
  category: string;
  confidence: string;
  source_session_id?: string;
  created_at: string;
  agent_id?: number | null;
  visibility?: string;
}

export async function saveLearning(
  learningId: number,
  title: string,
  description: string,
  metadata: LearningMetadata
): Promise<void> {
  const cols = ensureInitialized();
  const content = `${title}. ${description}`;
  const chromaMetadata: Record<string, string | number | boolean> = {
    category: metadata.category,
    confidence: metadata.confidence,
    source_session_id: metadata.source_session_id || '',
    created_at: metadata.created_at,
    agent_id: metadata.agent_id ?? -1, // ChromaDB doesn't support null, use -1 for orchestrator
    visibility: metadata.visibility || 'public',
  };

  // Best-effort write with retry - failures don't crash, just mark index stale
  await withRetry(
    () => cols.learnings.add({
      ids: [String(learningId)],
      documents: [content],
      metadatas: [chromaMetadata],
    }),
    `save learning ${learningId}`
  );
}

export interface LearningSearchOptions {
  limit?: number;
  category?: string;
  agentId?: number | null;
  includeShared?: boolean;
}

export async function searchLearnings(
  query: string,
  limitOrOptions: number | LearningSearchOptions = 5,
  category?: string
): Promise<SearchResult> {
  const cols = ensureInitialized();

  // Support both old (limit, category) and new (options object) signatures
  const options = typeof limitOrOptions === 'number'
    ? { limit: limitOrOptions, category }
    : limitOrOptions;
  const { limit = 5, agentId, includeShared = true, category: cat } = options;

  // Build where clause
  let where: Where | undefined;
  const conditions: Where[] = [];

  if (cat) {
    conditions.push({ category: cat } as Where);
  }

  if (agentId !== undefined) {
    const agentIdValue = agentId ?? -1;
    if (includeShared) {
      conditions.push({
        $or: [
          { agent_id: agentIdValue },
          { agent_id: -1 }, // orchestrator
          { visibility: 'shared' },
          { visibility: 'public' },
        ],
      } as Where);
    } else {
      conditions.push({ agent_id: agentIdValue } as Where);
    }
  }

  if (conditions.length === 1) {
    where = conditions[0];
  } else if (conditions.length > 1) {
    where = { $and: conditions } as Where;
  }

  return await cols.learnings.query({
    queryTexts: [query],
    nResults: limit,
    where,
  }) as SearchResult;
}

export async function listLearningsFromVector(limit = 20): Promise<{
  ids: string[];
  contents: (string | null)[];
  metadatas: (Record<string, unknown> | null)[];
}> {
  const cols = ensureInitialized();
  const result = await cols.learnings.get({ limit });
  return {
    ids: result.ids,
    contents: result.documents,
    metadatas: result.metadatas,
  };
}

// ============ SESSION TASK EMBEDDINGS ============

export interface SessionTaskSearchResult {
  id: number;
  description: string;
  session_id: string;
  status: string;
  similarity: number;
  notes?: string;
}

/**
 * Embed a session task for semantic search
 */
export async function embedSessionTask(
  taskId: number,
  description: string,
  metadata: {
    session_id: string;
    status: string;
    priority?: string;
    notes?: string;
    created_at: string;
  }
): Promise<void> {
  const cols = ensureInitialized();
  try {
    const chromaMetadata: Record<string, string | number | boolean> = {
      session_id: metadata.session_id,
      status: metadata.status,
      priority: metadata.priority || 'normal',
      notes: metadata.notes || '',
      created_at: metadata.created_at,
    };

    await cols.sessionTasks.add({
      ids: [String(taskId)],
      documents: [description],
      metadatas: [chromaMetadata],
    });
  } catch (error) {
    console.error(`[VectorDB] Failed to embed session task ${taskId}:`, error);
    throw error;
  }
}

/**
 * Search session tasks by semantic similarity
 */
export async function searchSessionTasks(
  query: string,
  limit = 10,
  sessionId?: string
): Promise<SessionTaskSearchResult[]> {
  const cols = ensureInitialized();
  const where = sessionId ? { session_id: sessionId } : undefined;

  const results = await cols.sessionTasks.query({
    queryTexts: [query],
    nResults: limit,
    where,
  });

  const ids = results.ids[0] || [];
  const documents = results.documents[0] || [];
  const metadatas = results.metadatas?.[0] || [];
  const distances = results.distances?.[0] || [];

  return ids.map((id, i) => ({
    id: parseInt(id),
    description: documents[i] || '',
    session_id: String(metadatas[i]?.session_id || ''),
    status: String(metadatas[i]?.status || 'pending'),
    similarity: 1 - (distances[i] || 0),
    notes: metadatas[i]?.notes ? String(metadatas[i]?.notes) : undefined,
  }));
}

/**
 * Get all session tasks from vector DB (for listing)
 */
export async function listSessionTasksFromVector(limit = 50, sessionId?: string): Promise<{
  ids: string[];
  descriptions: (string | null)[];
  metadatas: (Record<string, unknown> | null)[];
}> {
  const cols = ensureInitialized();
  const where = sessionId ? { session_id: sessionId } : undefined;
  const result = await cols.sessionTasks.get({ limit, where });
  return {
    ids: result.ids,
    descriptions: result.documents,
    metadatas: result.metadatas,
  };
}

// ============ AUTO-LINKING ============

export interface AutoLinkResult {
  autoLinked: Array<{ id: string; similarity: number }>;
  suggested: Array<{ id: string; similarity: number; summary?: string }>;
}

export interface AutoLinkOptions {
  excludeId?: string;
  limit?: number;
  agentId?: number | null;
  crossAgentLinking?: boolean;
}

export async function findSimilarSessions(
  content: string,
  excludeIdOrOptions?: string | AutoLinkOptions,
  limit = 5
): Promise<AutoLinkResult> {
  const cols = ensureInitialized();

  // Support both old (excludeId, limit) and new (options object) signatures
  const options: AutoLinkOptions = typeof excludeIdOrOptions === 'string'
    ? { excludeId: excludeIdOrOptions, limit }
    : excludeIdOrOptions || {};
  const {
    excludeId,
    limit: resultLimit = 5,
    agentId,
    crossAgentLinking = false,
  } = options;

  // Build where clause for agent filtering
  let where: Where | undefined;
  if (agentId !== undefined && !crossAgentLinking) {
    const agentIdValue = agentId ?? -1;
    // Only search within same agent's sessions (or orchestrator + public/shared)
    where = {
      $or: [
        { agent_id: agentIdValue },
        { agent_id: -1 }, // orchestrator
        { visibility: 'shared' },
        { visibility: 'public' },
      ],
    } as Where;
  }

  const results = await cols.sessions.query({
    queryTexts: [content],
    nResults: resultLimit + 1, // +1 to account for self if present
    where,
  });

  const autoLinked: AutoLinkResult['autoLinked'] = [];
  const suggested: AutoLinkResult['suggested'] = [];

  const ids = results.ids[0] || [];
  const distances = results.distances?.[0] || [];
  const documents = results.documents[0] || [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    if (id === excludeId) continue;

    const distance = distances[i] ?? 1;
    const similarity = 1 - distance; // ChromaDB returns distance, not similarity

    if (similarity > 0.85) {
      autoLinked.push({ id, similarity });
    } else if (similarity > 0.70) {
      suggested.push({ id, similarity, summary: (documents[i] ?? '').substring(0, 100) });
    }
  }

  return { autoLinked, suggested };
}

export interface LearningAutoLinkOptions {
  excludeId?: number;
  limit?: number;
  agentId?: number | null;
  crossAgentLinking?: boolean;
}

export async function findSimilarLearnings(
  content: string,
  excludeIdOrOptions?: number | LearningAutoLinkOptions,
  limit = 5
): Promise<AutoLinkResult> {
  const cols = ensureInitialized();

  // Support both old (excludeId, limit) and new (options object) signatures
  const options: LearningAutoLinkOptions = typeof excludeIdOrOptions === 'number'
    ? { excludeId: excludeIdOrOptions, limit }
    : excludeIdOrOptions || {};
  const {
    excludeId,
    limit: resultLimit = 5,
    agentId,
    crossAgentLinking = false,
  } = options;

  // Build where clause for agent filtering
  let where: Where | undefined;
  if (agentId !== undefined && !crossAgentLinking) {
    const agentIdValue = agentId ?? -1;
    // Only search within same agent's learnings (or orchestrator + public/shared)
    where = {
      $or: [
        { agent_id: agentIdValue },
        { agent_id: -1 }, // orchestrator
        { visibility: 'shared' },
        { visibility: 'public' },
      ],
    } as Where;
  }

  const results = await cols.learnings.query({
    queryTexts: [content],
    nResults: resultLimit + 1,
    where,
  });

  const autoLinked: AutoLinkResult['autoLinked'] = [];
  const suggested: AutoLinkResult['suggested'] = [];

  const ids = results.ids[0] || [];
  const distances = results.distances?.[0] || [];
  const documents = results.documents[0] || [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    if (excludeId && id === String(excludeId)) continue;

    const distance = distances[i] ?? 1;
    const similarity = 1 - distance;

    if (similarity > 0.85) {
      autoLinked.push({ id, similarity });
    } else if (similarity > 0.70) {
      suggested.push({ id, similarity, summary: (documents[i] ?? '').substring(0, 100) });
    }
  }

  return { autoLinked, suggested };
}

export function isInitialized(): boolean {
  return initialized;
}

// ============ MIGRATION ============

/**
 * Reset all vector collections and re-initialize with new embedding function.
 * Use this when changing embedding models (old vectors are incompatible).
 */
export async function resetVectorCollections(): Promise<void> {
  const chromaClient = getClient();
  const collectionNames = [
    'task_prompts',
    'task_results',
    'messages_inbound',
    'messages_outbound',
    'shared_context',
    'orchestrator_sessions',
    'orchestrator_learnings',
    'session_tasks',
  ];

  for (const name of collectionNames) {
    try {
      await chromaClient.deleteCollection({ name });
      console.error(`[VectorDB] Deleted collection: ${name}`);
    } catch {
      // Collection may not exist, ignore
    }
  }

  // Reset state and re-initialize
  initialized = false;
  collections = null;
  await initVectorDB();
  console.error("[VectorDB] Collections reset with new embeddings");
}

/**
 * Pre-load the embedding model (optional).
 * Call at startup to avoid initialization delay on first embedding.
 */
export async function preloadEmbeddingModel(): Promise<void> {
  const embedFn = await getEmbeddingFunction();
  await embedFn.generate(["warmup"]); // Trigger initialization
  console.error("[VectorDB] Embedding model pre-loaded");
}

/**
 * Get current embedding provider info
 */
export function getEmbeddingProviderInfo(): { provider: string; model?: string } {
  const config = getEmbeddingConfig();
  return {
    provider: config.provider || 'transformers',
    model: config.model,
  };
}

// ============ HEALTH CHECK & AUTO-START ============

export interface HealthStatus {
  chromadb: {
    status: "healthy" | "unhealthy" | "starting";
    url: string;
    message?: string;
  };
  embedding: {
    status: "ready" | "not_initialized" | "error";
    provider: string;
    model?: string;
  };
  collections: {
    initialized: boolean;
    stats?: Record<string, number>;
  };
}

/**
 * Check if ChromaDB server is reachable
 */
export async function checkChromaHealth(timeoutMs = 5000): Promise<boolean> {
  const url = process.env.CHROMA_URL || "http://localhost:8100";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${url}/api/v2/heartbeat`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start ChromaDB via Docker if not running
 * Uses container name 'chromadb' - will start existing or create new
 */
export async function ensureChromaRunning(): Promise<{ started: boolean; containerId?: string }> {
  const isHealthy = await checkChromaHealth(2000);

  if (isHealthy) {
    console.error("[VectorDB] ChromaDB already running");
    return { started: false };
  }

  console.error("[VectorDB] Starting ChromaDB via Docker...");

  const chromaPort = process.env.CHROMA_PORT || "8100";
  const containerName = process.env.CHROMA_CONTAINER || "chromadb";

  try {
    // Try to start existing container first
    const startResult = Bun.spawnSync(["docker", "start", containerName], {
      stdout: "pipe",
      stderr: "pipe",
    });

    if (startResult.exitCode === 0) {
      // Container existed and started
      await waitForChromaHealth();
      console.error(`[VectorDB] ChromaDB container '${containerName}' started`);
      return { started: true, containerId: containerName };
    }

    // Container doesn't exist - create new one with auto-restart
    console.error("[VectorDB] Creating new ChromaDB container...");
    const runResult = Bun.spawnSync([
      "docker", "run", "-d",
      "--name", containerName,
      "--restart", "unless-stopped",
      "-p", `${chromaPort}:8000`,
      "-v", `${process.cwd()}/chroma_data:/data`,
      "chromadb/chroma"
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });

    if (runResult.exitCode !== 0) {
      const stderr = runResult.stderr.toString();
      throw new Error(`Docker run failed: ${stderr}`);
    }

    await waitForChromaHealth();
    const containerId = runResult.stdout.toString().trim().slice(0, 12);
    console.error(`[VectorDB] ChromaDB container created (${containerId})`);
    return { started: true, containerId };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[VectorDB] Failed to start ChromaDB: ${message}`);
    throw error;
  }
}

async function waitForChromaHealth(maxWaitMs = 30000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (await checkChromaHealth(1000)) {
      return;
    }
  }
  throw new Error("ChromaDB failed to become healthy within timeout");
}

/**
 * Get comprehensive health status
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  const chromaUrl = process.env.CHROMA_URL || "http://localhost:8100";
  const embeddingConfig = getEmbeddingConfig();

  // Check ChromaDB
  const chromaHealthy = await checkChromaHealth();

  // Check embedding
  let embeddingStatus: HealthStatus["embedding"] = {
    status: "not_initialized",
    provider: embeddingConfig.provider || 'transformers',
    model: embeddingConfig.model,
  };

  if (embeddingFunction) {
    embeddingStatus.status = "ready";
  }

  // Check collections
  let collectionStatus: HealthStatus["collections"] = {
    initialized: initialized,
  };

  if (initialized && chromaHealthy) {
    try {
      collectionStatus.stats = await getCollectionStats();
    } catch {
      // Ignore stats errors
    }
  }

  return {
    chromadb: {
      status: chromaHealthy ? "healthy" : "unhealthy",
      url: chromaUrl,
      message: chromaHealthy ? undefined : "ChromaDB server not reachable",
    },
    embedding: embeddingStatus,
    collections: collectionStatus,
  };
}

/**
 * Initialize VectorDB with auto-start of ChromaDB
 * Use this for MCP server startup
 */
export async function initVectorDBWithAutoStart(): Promise<HealthStatus> {
  // Ensure ChromaDB is running
  await ensureChromaRunning();

  // Initialize vector DB
  await initVectorDB();

  // Pre-load embedding model
  await preloadEmbeddingModel();

  // Return health status
  return getHealthStatus();
}

// ============ KNOWLEDGE EMBEDDINGS (Dual-Collection Pattern) ============

export async function embedKnowledge(
  knowledgeId: string,
  content: string,
  metadata: {
    category?: string;
    mission_id?: string;
    agent_id?: number;
    created_at?: string;
  }
): Promise<void> {
  const cols = ensureInitialized();
  await cols.knowledge.add({
    ids: [knowledgeId],
    documents: [content],
    metadatas: [{
      category: metadata.category || "",
      mission_id: metadata.mission_id || "",
      agent_id: metadata.agent_id ?? -1,
      created_at: metadata.created_at || new Date().toISOString(),
    }],
  });
}

export async function searchKnowledgeVector(
  query: string,
  options?: {
    limit?: number;
    category?: string;
    agentId?: number;
  }
): Promise<{
  ids: string[][];
  documents: (string | null)[][];
  distances: (number | null)[][] | null;
  metadatas: (Record<string, any> | null)[][] | null;
}> {
  const cols = ensureInitialized();
  const { limit = 10, category, agentId } = options || {};

  const where: Where = {};
  if (category) where.category = category;
  if (agentId !== undefined) where.agent_id = agentId;

  const results = await cols.knowledge.query({
    queryTexts: [query],
    nResults: limit,
    where: Object.keys(where).length > 0 ? where : undefined,
  });

  return {
    ids: results.ids,
    documents: results.documents || [[]],
    distances: results.distances,
    metadatas: results.metadatas,
  };
}

// ============ LESSON EMBEDDINGS (Dual-Collection Pattern) ============

export async function embedLesson(
  lessonId: string,
  content: string,  // problem + solution + outcome concatenated
  metadata: {
    problem: string;
    solution: string;
    outcome: string;
    category?: string;
    confidence?: number;
    frequency?: number;
    agent_id?: number;
    created_at?: string;
  }
): Promise<void> {
  const cols = ensureInitialized();
  await cols.lessons.add({
    ids: [lessonId],
    documents: [content],
    metadatas: [{
      problem: metadata.problem,
      solution: metadata.solution,
      outcome: metadata.outcome,
      category: metadata.category || "",
      confidence: metadata.confidence ?? 0.5,
      frequency: metadata.frequency ?? 1,
      agent_id: metadata.agent_id ?? -1,
      created_at: metadata.created_at || new Date().toISOString(),
    }],
  });
}

export async function searchLessonsVector(
  query: string,
  options?: {
    limit?: number;
    category?: string;
    minConfidence?: number;
    agentId?: number;
  }
): Promise<{
  ids: string[][];
  documents: (string | null)[][];
  distances: (number | null)[][] | null;
  metadatas: (Record<string, any> | null)[][] | null;
}> {
  const cols = ensureInitialized();
  const { limit = 10, category, minConfidence, agentId } = options || {};

  // Build where clause
  const where: Where = {};
  if (category) where.category = category;
  if (agentId !== undefined) where.agent_id = agentId;

  const results = await cols.lessons.query({
    queryTexts: [query],
    nResults: limit * 2, // Fetch extra for post-filtering
    where: Object.keys(where).length > 0 ? where : undefined,
  });

  // Post-filter by minConfidence if specified
  if (minConfidence !== undefined && results.metadatas?.[0]) {
    const filteredIds: string[] = [];
    const filteredDocs: (string | null)[] = [];
    const filteredMetas: (Record<string, any> | null)[] = [];
    const filteredDists: (number | null)[] = [];

    for (let i = 0; i < results.ids[0]!.length; i++) {
      const meta = results.metadatas[0]![i];
      if (meta) {
        const conf = typeof meta.confidence === 'number' ? meta.confidence : 0;
        if (conf >= minConfidence) {
          filteredIds.push(results.ids[0]![i]!);
          filteredDocs.push(results.documents?.[0]?.[i] ?? null);
          filteredMetas.push(meta);
          if (results.distances?.[0]) {
            filteredDists.push(results.distances[0][i] ?? null);
          }
        }
      }
    }

    return {
      ids: [filteredIds.slice(0, limit)],
      documents: [filteredDocs.slice(0, limit)],
      distances: filteredDists.length > 0 ? [filteredDists.slice(0, limit)] : null,
      metadatas: [filteredMetas.slice(0, limit)],
    };
  }

  // Trim to limit
  return {
    ids: [results.ids[0]?.slice(0, limit) || []],
    documents: [results.documents?.[0]?.slice(0, limit) || []],
    distances: results.distances ? [results.distances[0]?.slice(0, limit) || []] : null,
    metadatas: results.metadatas ? [results.metadatas[0]?.slice(0, limit) || []] : null,
  };
}

export async function updateLessonEmbedding(
  lessonId: string,
  metadata: {
    confidence?: number;
    frequency?: number;
  }
): Promise<void> {
  const cols = ensureInitialized();

  // Get existing
  const existing = await cols.lessons.get({ ids: [lessonId] });
  if (!existing.metadatas?.[0]) return;

  const currentMeta = existing.metadatas[0];
  if (!currentMeta) return;

  await cols.lessons.update({
    ids: [lessonId],
    metadatas: [{
      ...currentMeta,
      confidence: metadata.confidence !== undefined ? metadata.confidence : (currentMeta.confidence ?? 0.5),
      frequency: metadata.frequency !== undefined ? metadata.frequency : (currentMeta.frequency ?? 1),
    }],
  });
}

// ============ REBUILD FROM SQLITE ============

export interface RebuildProgress {
  sessions: { total: number; indexed: number; errors: number };
  learnings: { total: number; indexed: number; errors: number };
  knowledge: { total: number; indexed: number; errors: number };
  lessons: { total: number; indexed: number; errors: number };
}

/**
 * Rebuild ChromaDB index from SQLite (source of truth)
 * Use after corruption, restart, or when index becomes stale
 */
export async function rebuildFromSqlite(options?: {
  collections?: ('sessions' | 'learnings' | 'knowledge' | 'lessons')[];
  batchSize?: number;
  onProgress?: (progress: RebuildProgress) => void;
}): Promise<RebuildProgress> {
  const { collections = ['sessions', 'learnings', 'knowledge', 'lessons'], batchSize = 50, onProgress } = options || {};

  // Import db functions dynamically to avoid circular dependency
  const { listSessionsFromDb, listLearningsFromDb, listKnowledge, listLessons } = await import('./db');

  const progress: RebuildProgress = {
    sessions: { total: 0, indexed: 0, errors: 0 },
    learnings: { total: 0, indexed: 0, errors: 0 },
    knowledge: { total: 0, indexed: 0, errors: 0 },
    lessons: { total: 0, indexed: 0, errors: 0 },
  };

  // Ensure initialized
  if (!initialized) {
    await initVectorDB();
  }
  const cols = ensureInitialized();

  console.error('[VectorDB] Starting rebuild from SQLite...');

  // Rebuild sessions
  if (collections.includes('sessions')) {
    const sessions = listSessionsFromDb({ limit: 10000 });
    progress.sessions.total = sessions.length;
    console.error(`[VectorDB] Indexing ${sessions.length} sessions...`);

    for (let i = 0; i < sessions.length; i += batchSize) {
      const batch = sessions.slice(i, i + batchSize);
      const ids: string[] = [];
      const documents: string[] = [];
      const metadatas: Record<string, string | number | boolean>[] = [];

      for (const session of batch) {
        ids.push(session.id);
        documents.push(session.summary);
        metadatas.push({
          created_at: session.created_at,
          tags: session.tags?.join(',') || '',
          agent_id: session.agent_id ?? -1,
          visibility: session.visibility || 'public',
        });
      }

      try {
        // Delete existing then add (upsert pattern)
        await cols.sessions.delete({ ids });
        await cols.sessions.add({ ids, documents, metadatas });
        progress.sessions.indexed += batch.length;
      } catch (error) {
        console.error(`[VectorDB] Session batch error:`, error);
        progress.sessions.errors += batch.length;
      }

      onProgress?.(progress);
    }
  }

  // Rebuild learnings
  if (collections.includes('learnings')) {
    const learnings = listLearningsFromDb({ limit: 10000 });
    progress.learnings.total = learnings.length;
    console.error(`[VectorDB] Indexing ${learnings.length} learnings...`);

    for (let i = 0; i < learnings.length; i += batchSize) {
      const batch = learnings.slice(i, i + batchSize);
      const ids: string[] = [];
      const documents: string[] = [];
      const metadatas: Record<string, string | number | boolean>[] = [];

      for (const learning of batch) {
        if (!learning.id) continue;
        ids.push(String(learning.id));
        documents.push(`${learning.title}. ${learning.description || learning.lesson || ''}`);
        metadatas.push({
          category: learning.category || '',
          confidence: learning.confidence || 'low',
          source_session_id: learning.source_session_id || '',
          created_at: learning.created_at || '',
          agent_id: learning.agent_id ?? -1,
          visibility: learning.visibility || 'public',
        });
      }

      if (ids.length === 0) continue;

      try {
        await cols.learnings.delete({ ids });
        await cols.learnings.add({ ids, documents, metadatas });
        progress.learnings.indexed += batch.length;
      } catch (error) {
        console.error(`[VectorDB] Learning batch error:`, error);
        progress.learnings.errors += batch.length;
      }

      onProgress?.(progress);
    }
  }

  // Rebuild knowledge
  if (collections.includes('knowledge')) {
    const knowledge = listKnowledge({ limit: 10000 });
    progress.knowledge.total = knowledge.length;
    console.error(`[VectorDB] Indexing ${knowledge.length} knowledge entries...`);

    for (let i = 0; i < knowledge.length; i += batchSize) {
      const batch = knowledge.slice(i, i + batchSize);
      const ids: string[] = [];
      const documents: string[] = [];
      const metadatas: Record<string, string | number | boolean>[] = [];

      for (const k of batch) {
        if (!k.id) continue;
        ids.push(`knowledge_${k.id}`);
        documents.push(k.content);
        metadatas.push({
          category: k.category || '',
          agent_id: k.agent_id ?? -1,
          created_at: k.created_at || '',
        });
      }

      if (ids.length === 0) continue;

      try {
        await cols.knowledge.delete({ ids });
        await cols.knowledge.add({ ids, documents, metadatas });
        progress.knowledge.indexed += batch.length;
      } catch (error) {
        console.error(`[VectorDB] Knowledge batch error:`, error);
        progress.knowledge.errors += batch.length;
      }

      onProgress?.(progress);
    }
  }

  // Rebuild lessons
  if (collections.includes('lessons')) {
    const lessons = listLessons({ limit: 10000 });
    progress.lessons.total = lessons.length;
    console.error(`[VectorDB] Indexing ${lessons.length} lessons...`);

    for (let i = 0; i < lessons.length; i += batchSize) {
      const batch = lessons.slice(i, i + batchSize);
      const ids: string[] = [];
      const documents: string[] = [];
      const metadatas: Record<string, string | number | boolean>[] = [];

      for (const lesson of batch) {
        if (!lesson.id) continue;
        ids.push(`lesson_${lesson.id}`);
        documents.push(`Problem: ${lesson.problem}\nSolution: ${lesson.solution}\nOutcome: ${lesson.outcome}`);
        metadatas.push({
          problem: lesson.problem,
          solution: lesson.solution,
          outcome: lesson.outcome,
          category: lesson.category || '',
          confidence: lesson.confidence ?? 0.5,
          agent_id: lesson.agent_id ?? -1,
          created_at: lesson.created_at || '',
        });
      }

      if (ids.length === 0) continue;

      try {
        await cols.lessons.delete({ ids });
        await cols.lessons.add({ ids, documents, metadatas });
        progress.lessons.indexed += batch.length;
      } catch (error) {
        console.error(`[VectorDB] Lesson batch error:`, error);
        progress.lessons.errors += batch.length;
      }

      onProgress?.(progress);
    }
  }

  // Mark index as fresh
  markIndexFresh();

  console.error('[VectorDB] Rebuild complete:', progress);
  return progress;
}
