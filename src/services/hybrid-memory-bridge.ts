/**
 * Hybrid Memory Bridge
 *
 * Provides a unified interface for semantic search across multiple vector collections.
 * This bridges the recall service with the underlying ChromaDB vector database.
 */

import {
  searchSessions,
  searchLearnings,
  searchKnowledgeVector,
  searchLessonsVector,
  isInitialized,
  initVectorDB,
  type SearchResult,
} from '../vector-db';

export interface SemanticSearchResult {
  id: string;
  type: 'session' | 'learning' | 'knowledge' | 'lesson';
  content: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface SemanticSearchOptions {
  nResults?: number;
  collections?: ('sessions' | 'learnings' | 'knowledge' | 'lessons')[];
  project?: string;
  agentId?: number | null;
}

/**
 * Unified semantic search across all memory collections.
 * Returns results from sessions, learnings, knowledge, and lessons
 * ranked by similarity.
 */
export async function semanticSearch(
  query: string,
  options: SemanticSearchOptions = {}
): Promise<SemanticSearchResult[]> {
  const {
    nResults = 10,
    collections = ['sessions', 'learnings', 'knowledge', 'lessons'],
    agentId,
  } = options;

  // Ensure vector DB is initialized
  if (!isInitialized()) {
    try {
      await initVectorDB();
    } catch (error) {
      console.error('[HybridBridge] Failed to initialize vector DB:', error);
      return [];
    }
  }

  const results: SemanticSearchResult[] = [];
  const perCollectionLimit = Math.ceil(nResults / collections.length) + 2;

  // Search each collection in parallel
  const searchPromises: Promise<void>[] = [];

  if (collections.includes('sessions')) {
    searchPromises.push(
      searchSessions(query, { limit: perCollectionLimit, agentId })
        .then((res) => processSearchResults(res, 'session', results))
        .catch((err) => console.error('[HybridBridge] Session search error:', err))
    );
  }

  if (collections.includes('learnings')) {
    searchPromises.push(
      searchLearnings(query, { limit: perCollectionLimit, agentId })
        .then((res) => processSearchResults(res, 'learning', results))
        .catch((err) => console.error('[HybridBridge] Learning search error:', err))
    );
  }

  if (collections.includes('knowledge')) {
    searchPromises.push(
      searchKnowledgeVector(query, { limit: perCollectionLimit, agentId: agentId ?? undefined })
        .then((res) => processKnowledgeResults(res, 'knowledge', results))
        .catch((err) => console.error('[HybridBridge] Knowledge search error:', err))
    );
  }

  if (collections.includes('lessons')) {
    searchPromises.push(
      searchLessonsVector(query, { limit: perCollectionLimit, agentId: agentId ?? undefined })
        .then((res) => processKnowledgeResults(res, 'lesson', results))
        .catch((err) => console.error('[HybridBridge] Lesson search error:', err))
    );
  }

  await Promise.all(searchPromises);

  // Sort by similarity (highest first) and limit results
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, nResults);
}

/**
 * Process search results from sessions/learnings collections
 */
function processSearchResults(
  res: SearchResult,
  type: SemanticSearchResult['type'],
  results: SemanticSearchResult[]
): void {
  const ids = res.ids[0] || [];
  const documents = res.documents[0] || [];
  const distances = res.distances?.[0] || [];
  const metadatas = res.metadatas?.[0] || [];

  for (let i = 0; i < ids.length; i++) {
    const distance = distances[i] ?? 0.5;
    results.push({
      id: ids[i]!,
      type,
      content: documents[i] || '',
      similarity: 1 - distance,
      metadata: metadatas[i] || undefined,
    });
  }
}

/**
 * Process search results from knowledge/lessons collections (slightly different format)
 */
function processKnowledgeResults(
  res: {
    ids: string[][];
    documents: (string | null)[][];
    distances: (number | null)[][] | null;
    metadatas: (Record<string, unknown> | null)[][] | null;
  },
  type: SemanticSearchResult['type'],
  results: SemanticSearchResult[]
): void {
  const ids = res.ids[0] || [];
  const documents = res.documents[0] || [];
  const distances = res.distances?.[0] || [];
  const metadatas = res.metadatas?.[0] || [];

  for (let i = 0; i < ids.length; i++) {
    const distance = distances[i] ?? 0.5;
    results.push({
      id: ids[i]!,
      type,
      content: documents[i] || '',
      similarity: 1 - distance,
      metadata: metadatas[i] || undefined,
    });
  }
}

export default {
  semanticSearch,
};
