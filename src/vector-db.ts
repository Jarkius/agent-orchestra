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
    };
    initialized = true;
    console.error("[VectorDB] Initialized with 8 collections");
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

  const [tasks, results, messagesIn, messagesOut, context, sessions, learnings, sessionTasks] = await Promise.all([
    cols.tasks.count(),
    cols.results.count(),
    cols.messagesIn.count(),
    cols.messagesOut.count(),
    cols.context.count(),
    cols.sessions.count(),
    cols.learnings.count(),
    cols.sessionTasks.count(),
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
  try {
    // ChromaDB only supports primitive metadata values - convert arrays to CSV
    const chromaMetadata: Record<string, string | number | boolean> = {
      created_at: metadata.created_at,
      tags: metadata.tags?.join(',') || '',
      agent_id: metadata.agent_id ?? -1, // ChromaDB doesn't support null, use -1 for orchestrator
      visibility: metadata.visibility || 'public',
    };

    await cols.sessions.add({
      ids: [sessionId],
      documents: [summary],
      metadatas: [chromaMetadata],
    });
  } catch (error) {
    console.error(`[VectorDB] Failed to save session ${sessionId}:`, error);
    throw error;
  }
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
    if (includeShared) {
      // ChromaDB doesn't have OR conditions, so we use $or operator
      where = {
        $or: [
          { agent_id: agentId },
          { agent_id: -1 }, // orchestrator
          { visibility: 'shared' },
          { visibility: 'public' },
        ],
      };
    } else {
      where = { agent_id: agentId };
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
  try {
    const content = `${title}. ${description}`;
    const chromaMetadata: Record<string, string | number | boolean> = {
      category: metadata.category,
      confidence: metadata.confidence,
      source_session_id: metadata.source_session_id || '',
      created_at: metadata.created_at,
      agent_id: metadata.agent_id ?? -1, // ChromaDB doesn't support null, use -1 for orchestrator
      visibility: metadata.visibility || 'public',
    };

    await cols.learnings.add({
      ids: [String(learningId)],
      documents: [content],
      metadatas: [chromaMetadata],
    });
  } catch (error) {
    console.error(`[VectorDB] Failed to save learning ${learningId}:`, error);
    throw error;
  }
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
  const conditions: Record<string, unknown>[] = [];

  if (cat) {
    conditions.push({ category: cat });
  }

  if (agentId !== undefined) {
    if (includeShared) {
      conditions.push({
        $or: [
          { agent_id: agentId },
          { agent_id: -1 }, // orchestrator
          { visibility: 'shared' },
          { visibility: 'public' },
        ],
      });
    } else {
      conditions.push({ agent_id: agentId });
    }
  }

  if (conditions.length === 1) {
    where = conditions[0];
  } else if (conditions.length > 1) {
    where = { $and: conditions };
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
    // Only search within same agent's sessions (or orchestrator + public/shared)
    where = {
      $or: [
        { agent_id: agentId },
        { agent_id: -1 }, // orchestrator
        { visibility: 'shared' },
        { visibility: 'public' },
      ],
    };
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
    const id = ids[i];
    if (id === excludeId) continue;

    const distance = distances[i];
    const similarity = 1 - distance; // ChromaDB returns distance, not similarity

    if (similarity > 0.85) {
      autoLinked.push({ id, similarity });
    } else if (similarity > 0.70) {
      suggested.push({ id, similarity, summary: documents[i]?.substring(0, 100) });
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
    // Only search within same agent's learnings (or orchestrator + public/shared)
    where = {
      $or: [
        { agent_id: agentId },
        { agent_id: -1 }, // orchestrator
        { visibility: 'shared' },
        { visibility: 'public' },
      ],
    };
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
    const id = ids[i];
    if (excludeId && id === String(excludeId)) continue;

    const distance = distances[i];
    const similarity = 1 - distance;

    if (similarity > 0.85) {
      autoLinked.push({ id, similarity });
    } else if (similarity > 0.70) {
      suggested.push({ id, similarity, summary: documents[i]?.substring(0, 100) });
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
    provider: config.provider,
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
    provider: embeddingConfig.provider,
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
