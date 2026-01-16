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
 */

import { ChromaClient, type Collection, type IEmbeddingFunction } from 'chromadb';
import { EmbeddingModel, FlagEmbedding } from "fastembed";

// FastEmbed configuration from environment
const FASTEMBED_CONFIG = {
  model: process.env.FASTEMBED_MODEL || "BGESmallENV15",
  cacheDir: process.env.FASTEMBED_CACHE_DIR,
  batchSize: parseInt(process.env.FASTEMBED_BATCH_SIZE || "32"),
};

// FastEmbed embedding function using local ONNX models
// Default model: bge-small-en-v1.5 (384 dims, ~33MB, 91.2 MTEB score)
class FastEmbedFunction implements IEmbeddingFunction {
  private model: FlagEmbedding | null = null;
  private initPromise: Promise<void> | null = null;
  private initError: Error | null = null;

  async generate(texts: string[]): Promise<number[][]> {
    await this.ensureInitialized();
    if (texts.length === 0) return [];

    try {
      const allEmbeddings: number[][] = [];
      for await (const batch of this.model!.embed(texts, FASTEMBED_CONFIG.batchSize)) {
        // Convert Float32Array to regular number[] for ChromaDB compatibility
        for (const embedding of batch) {
          allEmbeddings.push(Array.from(embedding));
        }
      }
      return allEmbeddings;
    } catch (error) {
      console.error("[FastEmbed] Embedding failed:", error);
      throw new Error(`Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initError) {
      throw this.initError;
    }
    if (this.model) return;
    if (!this.initPromise) {
      this.initPromise = this.initializeModel();
    }
    await this.initPromise;
  }

  private async initializeModel(): Promise<void> {
    try {
      console.error("[FastEmbed] Initializing model...");
      const startTime = Date.now();

      const modelMap: Record<string, EmbeddingModel> = {
        "BGESmallENV15": EmbeddingModel.BGESmallENV15,
        "BGESmallEN": EmbeddingModel.BGESmallEN,
        "BGEBaseEN": EmbeddingModel.BGEBaseEN,
        "BGEBaseENV15": EmbeddingModel.BGEBaseENV15,
        "AllMiniLML6V2": EmbeddingModel.AllMiniLML6V2,
      };

      const selectedModel = modelMap[FASTEMBED_CONFIG.model] || EmbeddingModel.BGESmallENV15;
      if (!modelMap[FASTEMBED_CONFIG.model]) {
        console.error(`[FastEmbed] Unknown model "${FASTEMBED_CONFIG.model}", using BGESmallENV15`);
      }

      this.model = await FlagEmbedding.init({
        model: selectedModel,
        cacheDir: FASTEMBED_CONFIG.cacheDir,
      });

      const duration = Date.now() - startTime;
      console.error(`[FastEmbed] Model initialized in ${duration}ms`);
    } catch (error) {
      this.initError = error instanceof Error ? error : new Error(String(error));
      console.error("[FastEmbed] Failed to initialize:", this.initError);
      throw this.initError;
    }
  }

  isReady(): boolean {
    return this.model !== null && this.initError === null;
  }
}

// ChromaDB client - connects to server at localhost:8000
// Start server with: chroma run --path ./chroma_data
let client: ChromaClient | null = null;
let embeddingFunction: FastEmbedFunction | null = null;

function getClient(): ChromaClient {
  if (!client) {
    client = new ChromaClient({
      path: process.env.CHROMA_URL || "http://localhost:8000"
    });
  }
  return client;
}

function getEmbeddingFunction(): FastEmbedFunction {
  if (!embeddingFunction) {
    embeddingFunction = new FastEmbedFunction();
  }
  return embeddingFunction;
}

interface VectorCollections {
  tasks: Collection;
  results: Collection;
  messagesIn: Collection;
  messagesOut: Collection;
  context: Collection;
}

let collections: VectorCollections | null = null;
let initialized = false;

// ============ Initialization ============

export async function initVectorDB(): Promise<void> {
  if (initialized) return;

  try {
    const chromaClient = getClient();
    const embedFn = getEmbeddingFunction();
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
    };
    initialized = true;
    console.error("[VectorDB] Initialized with 5 collections");
  } catch (error) {
    console.error("[VectorDB] Failed to initialize:", error);
    throw error;
  }
}

function ensureInitialized(): VectorCollections {
  if (!collections) {
    throw new Error("VectorDB not initialized. Call initVectorDB() first.");
  }
  return collections;
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

  const [tasks, results, messagesIn, messagesOut, context] = await Promise.all([
    cols.tasks.count(),
    cols.results.count(),
    cols.messagesIn.count(),
    cols.messagesOut.count(),
    cols.context.count(),
  ]);

  return {
    task_prompts: tasks,
    task_results: results,
    messages_inbound: messagesIn,
    messages_outbound: messagesOut,
    shared_context: context,
  };
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
    'shared_context'
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
  const embedFn = getEmbeddingFunction();
  await embedFn.generate(["warmup"]); // Trigger initialization
  console.error("[VectorDB] Embedding model pre-loaded");
}
