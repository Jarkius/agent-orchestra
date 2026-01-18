/**
 * Vector Search Tool Handlers (Phase 2)
 * search_similar_tasks, search_similar_results,
 * search_message_history, get_related_memory
 */

import { jsonResponse, errorResponse } from '../../utils/response';
import {
  SearchSimilarTasksSchema,
  SearchSimilarResultsSchema,
  SearchMessageHistorySchema,
  GetRelatedMemorySchema,
  type SearchSimilarTasksInput,
  type SearchSimilarResultsInput,
  type SearchMessageHistoryInput,
  type GetRelatedMemoryInput,
} from '../../utils/validation';
import {
  searchSimilarTasks,
  searchSimilarResults,
  searchMessageHistory,
  getRelatedMemory,
  getCollectionStats,
  isInitialized,
  initVectorDB,
  getHealthStatus,
  checkChromaHealth,
  getEmbeddingProviderInfo,
} from '../../../vector-db';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Ensure VectorDB is ready ============

async function ensureVectorDB() {
  if (!isInitialized()) {
    await initVectorDB();
  }
}

// ============ Tool Definitions ============

export const vectorTools: ToolDefinition[] = [
  {
    name: "search_similar_tasks",
    description: "Find similar tasks",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        agent_id: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_similar_results",
    description: "Find similar results",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_message_history",
    description: "Search messages",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        direction: { type: "string", enum: ["inbound", "outbound"] },
        agent_id: { type: "number" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_related_memory",
    description: "Related memory",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        include_tasks: { type: "boolean" },
        include_results: { type: "boolean" },
        include_messages: { type: "boolean" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_vector_stats",
    description: "Vector stats",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "health_check",
    description: "Health check",
    inputSchema: { type: "object", properties: {} },
  },
];

// ============ Tool Handlers ============

async function handleSearchSimilarTasks(args: unknown) {
  await ensureVectorDB();
  const input = SearchSimilarTasksSchema.parse(args) as SearchSimilarTasksInput;
  const { query, limit, agent_id } = input;

  try {
    const results = await searchSimilarTasks(query, limit, agent_id);
    return jsonResponse({
      query,
      count: results.ids[0]?.length || 0,
      results: formatSearchResults(results),
    });
  } catch (error) {
    return errorResponse(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleSearchSimilarResults(args: unknown) {
  await ensureVectorDB();
  const input = SearchSimilarResultsSchema.parse(args) as SearchSimilarResultsInput;
  const { query, limit } = input;

  try {
    const results = await searchSimilarResults(query, limit);
    return jsonResponse({
      query,
      count: results.ids[0]?.length || 0,
      results: formatSearchResults(results),
    });
  } catch (error) {
    return errorResponse(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleSearchMessageHistory(args: unknown) {
  await ensureVectorDB();
  const input = SearchMessageHistorySchema.parse(args) as SearchMessageHistoryInput;
  const { query, direction, agent_id, limit } = input;

  try {
    const results = await searchMessageHistory(query, direction, limit, agent_id);

    if ('inbound' in results || 'outbound' in results) {
      // Combined results
      const combinedResults = results as { inbound?: any; outbound?: any };
      return jsonResponse({
        query,
        inbound: {
          count: combinedResults.inbound?.ids?.[0]?.length || 0,
          results: combinedResults.inbound ? formatSearchResults(combinedResults.inbound) : [],
        },
        outbound: {
          count: combinedResults.outbound?.ids?.[0]?.length || 0,
          results: combinedResults.outbound ? formatSearchResults(combinedResults.outbound) : [],
        },
      });
    } else {
      // Single direction results
      const singleResult = results as any;
      return jsonResponse({
        query,
        direction,
        count: singleResult.ids?.[0]?.length || 0,
        results: formatSearchResults(singleResult),
      });
    }
  } catch (error) {
    return errorResponse(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleGetRelatedMemory(args: unknown) {
  await ensureVectorDB();
  const input = GetRelatedMemorySchema.parse(args) as GetRelatedMemoryInput;
  const { query, include_tasks, include_results, include_messages, limit } = input;

  try {
    const memory = await getRelatedMemory(query, {
      includeTasks: include_tasks,
      includeResults: include_results,
      includeMessages: include_messages,
      includeContext: false,
      limit,
    });

    return jsonResponse({
      query,
      tasks: memory.tasks ? {
        count: memory.tasks.ids[0]?.length || 0,
        results: formatSearchResults(memory.tasks),
      } : null,
      results: memory.results ? {
        count: memory.results.ids[0]?.length || 0,
        results: formatSearchResults(memory.results),
      } : null,
      messages: memory.messages ? {
        inbound: memory.messages.inbound ? {
          count: memory.messages.inbound.ids[0]?.length || 0,
          results: formatSearchResults(memory.messages.inbound),
        } : null,
        outbound: memory.messages.outbound ? {
          count: memory.messages.outbound.ids[0]?.length || 0,
          results: formatSearchResults(memory.messages.outbound),
        } : null,
      } : null,
    });
  } catch (error) {
    return errorResponse(`Memory search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleGetVectorStats() {
  await ensureVectorDB();

  try {
    const stats = await getCollectionStats();
    return jsonResponse({
      collections: stats,
      total: Object.values(stats).reduce((a, b) => a + b, 0),
    });
  } catch (error) {
    return errorResponse(`Failed to get stats: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleHealthCheck() {
  try {
    const health = await getHealthStatus();
    return jsonResponse({
      status: health.chromadb.status === "healthy" && health.collections.initialized ? "healthy" : "degraded",
      chromadb: health.chromadb,
      embedding: health.embedding,
      collections: health.collections,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse({
      status: "unhealthy",
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
}

// ============ Helper Functions ============

function formatSearchResults(results: any) {
  if (!results.ids[0]) return [];

  return results.ids[0].map((id: string, i: number) => ({
    id,
    document: results.documents[0]?.[i] || null,
    metadata: results.metadatas[0]?.[i] || null,
    distance: results.distances?.[0]?.[i] || null,
  }));
}

// ============ Export Handlers Map ============

export const vectorHandlers: Record<string, ToolHandler> = {
  search_similar_tasks: handleSearchSimilarTasks,
  search_similar_results: handleSearchSimilarResults,
  search_message_history: handleSearchMessageHistory,
  get_related_memory: handleGetRelatedMemory,
  get_vector_stats: handleGetVectorStats,
  health_check: handleHealthCheck,
};
