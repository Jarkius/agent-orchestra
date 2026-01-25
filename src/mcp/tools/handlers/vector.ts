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
  reconnectVectorDB,
  searchCodeVector,
  getCodeIndexStats,
} from '../../../vector-db';
import { hybridSearch } from '../../../indexer/hybrid-search';
import { getCodeFileStats } from '../../../db';
import { checkStartupHealth } from '../../startup-health';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Ensure VectorDB is ready ============

async function ensureVectorDB() {
  if (!isInitialized()) {
    await initVectorDB();
  }
}

// ============ Schemas ============

const SearchSchema = z.object({
  type: z.enum(['agent_tasks', 'results', 'messages', 'memory']),
  query: z.string().min(1),
  limit: z.number().min(1).max(20).optional(),
  agent_id: z.number().optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  include_tasks: z.boolean().optional(),
  include_results: z.boolean().optional(),
  include_messages: z.boolean().optional(),
});

const CodeSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(50).optional(),
  language: z.string().optional(),
  file_path: z.string().optional(),
});

// ============ Tool Definitions ============

export const vectorTools: ToolDefinition[] = [
  {
    name: 'search',
    description: 'Semantic search',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['agent_tasks', 'results', 'messages', 'memory'] },
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
    description: 'Health check. Use full=true for fresh clone detection and setup guidance.',
    inputSchema: {
      type: 'object',
      properties: {
        reconnect: { type: 'boolean', description: 'Reconnect to ChromaDB (use after reindex)' },
        full: { type: 'boolean', description: 'Include fresh clone detection and setup guidance' },
      },
    },
  },
  {
    name: 'search_code',
    description: 'Semantic code search - find code by meaning, not just keywords. Reduces grep/glob overhead.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Semantic query (e.g., "authentication middleware", "database connection handling")' },
        limit: { type: 'number', description: 'Max results (default: 10, max: 50)' },
        language: { type: 'string', description: 'Filter by language (typescript, python, go, etc.)' },
        file_path: { type: 'string', description: 'Filter by file path pattern' },
      },
      required: ['query'],
    },
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
      case 'agent_tasks': {
        const results = await searchSimilarTasks(query, limit, agent_id);
        return jsonResponse({
          type: 'agent_tasks',
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

async function handleHealthCheck(args: unknown) {
  try {
    const input = args as { reconnect?: boolean; full?: boolean };

    // Reconnect if requested (use after reindex/reset)
    if (input?.reconnect) {
      await reconnectVectorDB();
    }

    const health = await getHealthStatus();
    const response: Record<string, any> = {
      status: health.chromadb.status === 'healthy' && health.collections.initialized ? 'healthy' : 'degraded',
      chromadb: health.chromadb,
      embedding: health.embedding,
      collections: health.collections,
      reconnected: input?.reconnect || false,
      timestamp: new Date().toISOString(),
    };

    // Add fresh clone indicators if full check requested
    if (input?.full) {
      const startupHealth = await checkStartupHealth();
      response.startup = {
        isFreshClone: startupHealth.isFreshClone,
        severity: startupHealth.severity,
        indicators: startupHealth.indicators,
        guidance: startupHealth.guidance,
        stats: startupHealth.stats,
      };
      // Override status if startup check shows needs_setup
      if (startupHealth.severity === 'needs_setup') {
        response.status = 'needs_setup';
      }
    }

    return jsonResponse(response);
  } catch (error) {
    return jsonResponse({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
}

async function handleSearchCode(args: unknown) {
  await ensureVectorDB();
  const input = CodeSearchSchema.parse(args);
  const { query, limit = 10, language } = input;

  try {
    // Use hybrid search - auto-routes to SQLite (exact) or semantic
    const result = await hybridSearch(query, {
      limit,
      language,
    });

    // Get both index stats for context
    const chromaStats = await getCodeIndexStats();
    const sqliteStats = getCodeFileStats();

    return jsonResponse({
      query,
      search_method: result.source, // 'sqlite' or 'semantic'
      query_time_ms: result.query_time_ms,
      total_results: result.total_results,
      index_stats: {
        chromadb_documents: chromaStats.totalDocuments,
        sqlite_files: sqliteStats.totalFiles,
        languages: chromaStats.languages,
      },
      results: result.results.map(r => ({
        file_path: r.file_path,
        language: r.language || 'unknown',
        relevance: r.relevance || 0,
        functions: r.functions?.slice(0, 10),
        classes: r.classes?.slice(0, 5),
        snippets: r.snippets?.slice(0, 3).map(s => ({
          content: s.content.slice(0, 500) + (s.content.length > 500 ? '...' : ''),
          relevance: s.relevance,
        })),
      })),
    });
  } catch (error) {
    return errorResponse(`Code search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============ Export Handlers Map ============

export const vectorHandlers: Record<string, ToolHandler> = {
  search: handleSearch,
  health_check: handleHealthCheck,
  search_code: handleSearchCode,
};
