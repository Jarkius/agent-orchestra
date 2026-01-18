/**
 * Vector Search Tool Handlers
 * Consolidated search tool + health check
 */

import { z } from 'zod';
import { jsonResponse, errorResponse } from '../../utils/response';
import {
  searchSimilarTasks,
  searchSimilarResults,
  searchMessageHistory,
  getRelatedMemory,
  getCollectionStats,
  isInitialized,
  initVectorDB,
  getHealthStatus,
} from '../../../vector-db';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Ensure VectorDB is ready ============

async function ensureVectorDB() {
  if (!isInitialized()) {
    await initVectorDB();
  }
}

// ============ Schemas ============

const SearchSchema = z.object({
  type: z.enum(['tasks', 'results', 'messages', 'memory']),
  query: z.string().min(1),
  limit: z.number().min(1).max(20).optional(),
  agent_id: z.number().optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  include_tasks: z.boolean().optional(),
  include_results: z.boolean().optional(),
  include_messages: z.boolean().optional(),
});

// ============ Tool Definitions ============

export const vectorTools: ToolDefinition[] = [
  {
    name: 'search',
    description: 'Semantic search',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['tasks', 'results', 'messages', 'memory'] },
        query: { type: 'string' },
        limit: { type: 'number' },
        agent_id: { type: 'number' },
        direction: { type: 'string', enum: ['inbound', 'outbound'] },
        include_tasks: { type: 'boolean' },
        include_results: { type: 'boolean' },
        include_messages: { type: 'boolean' },
      },
      required: ['type', 'query'],
    },
  },
  {
    name: 'health_check',
    description: 'Health check',
    inputSchema: { type: 'object', properties: {} },
  },
];

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

// ============ Handlers ============

async function handleSearch(args: unknown) {
  await ensureVectorDB();
  const input = SearchSchema.parse(args);
  const { type, query, limit = 5, agent_id, direction } = input;

  try {
    switch (type) {
      case 'tasks': {
        const results = await searchSimilarTasks(query, limit, agent_id);
        return jsonResponse({
          type: 'tasks',
          query,
          count: results.ids[0]?.length || 0,
          results: formatSearchResults(results),
        });
      }

      case 'results': {
        const results = await searchSimilarResults(query, limit);
        return jsonResponse({
          type: 'results',
          query,
          count: results.ids[0]?.length || 0,
          results: formatSearchResults(results),
        });
      }

      case 'messages': {
        const results = await searchMessageHistory(query, direction, limit, agent_id);

        if ('inbound' in results || 'outbound' in results) {
          const combinedResults = results as { inbound?: any; outbound?: any };
          return jsonResponse({
            type: 'messages',
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
          const singleResult = results as any;
          return jsonResponse({
            type: 'messages',
            query,
            direction,
            count: singleResult.ids?.[0]?.length || 0,
            results: formatSearchResults(singleResult),
          });
        }
      }

      case 'memory': {
        const memory = await getRelatedMemory(query, {
          includeTasks: input.include_tasks ?? true,
          includeResults: input.include_results ?? true,
          includeMessages: input.include_messages ?? true,
          includeContext: false,
          limit,
        });

        return jsonResponse({
          type: 'memory',
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
      }

      default:
        return errorResponse(`Unknown search type: ${type}`);
    }
  } catch (error) {
    return errorResponse(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleHealthCheck() {
  try {
    const health = await getHealthStatus();
    return jsonResponse({
      status: health.chromadb.status === 'healthy' && health.collections.initialized ? 'healthy' : 'degraded',
      chromadb: health.chromadb,
      embedding: health.embedding,
      collections: health.collections,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
}

// ============ Export Handlers Map ============

export const vectorHandlers: Record<string, ToolHandler> = {
  search: handleSearch,
  health_check: handleHealthCheck,
};
