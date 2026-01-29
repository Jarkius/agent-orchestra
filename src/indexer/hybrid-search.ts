/**
 * Hybrid Search - Routes queries to SQLite (exact) or ChromaDB (semantic)
 *
 * Uses SQLite for:
 * - File path lookups
 * - Function/class name searches
 * - Language filtering
 *
 * Uses ChromaDB for:
 * - Conceptual queries ("how does X work")
 * - Semantic similarity
 */

import {
  findIndexedFiles,
  findFilesBySymbol,
  getFilesByLanguage,
  getCodeFileStats,
  logSearch,
  type CodeFileRecord,
} from '../db';
import { searchCodeVector, getCodeIndexStats } from '../vector-db';

export interface HybridSearchOptions {
  limit?: number;
  language?: string;
  projectId?: string;
  scope?: 'project' | 'all' | 'external';
  includeExternal?: boolean;
}

export interface HybridSearchResult {
  source: 'sqlite' | 'semantic';
  query: string;
  total_results: number;
  results: SearchResultItem[];
  query_time_ms: number;
}

export interface SearchResultItem {
  file_path: string;
  language?: string;
  relevance?: number;
  // SQLite-specific
  functions?: string[];
  classes?: string[];
  line_count?: number;
  // Semantic-specific
  snippets?: { content: string; relevance: number }[];
}

/**
 * Detect if query looks like an exact match search
 * - Single identifier (function/class name): connectToHub, UserService
 * - File path pattern: src/matrix, .ts
 */
function isExactQuery(query: string): boolean {
  // Single identifier (alphanumeric with underscores, no spaces)
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(query)) {
    return true;
  }
  // File path pattern (contains / or . with extension)
  if (query.includes('/') || /\.[a-z]{1,4}$/.test(query)) {
    return true;
  }
  // Short query (1-2 words) likely a symbol
  if (query.split(/\s+/).length <= 2 && query.length < 30) {
    return true;
  }
  return false;
}

/**
 * Search SQLite for exact matches
 */
function searchSqlite(query: string, options?: HybridSearchOptions): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();

  // Search by file path/name
  const fileMatches = findIndexedFiles(query, {
    projectId: options?.projectId,
    language: options?.language,
    limit: options?.limit || 20,
    includeExternal: options?.includeExternal,
  });

  for (const file of fileMatches) {
    if (!seen.has(file.file_path)) {
      seen.add(file.file_path);
      results.push({
        file_path: file.file_path,
        language: file.language || undefined,
        functions: file.functions ? JSON.parse(file.functions) : undefined,
        classes: file.classes ? JSON.parse(file.classes) : undefined,
        line_count: file.line_count,
        relevance: 100, // Exact match
      });
    }
  }

  // Search by function/class name
  const symbolMatches = findFilesBySymbol(query, {
    projectId: options?.projectId,
    limit: options?.limit || 20,
  });

  for (const file of symbolMatches) {
    if (!seen.has(file.file_path)) {
      seen.add(file.file_path);
      results.push({
        file_path: file.file_path,
        language: file.language || undefined,
        functions: file.functions ? JSON.parse(file.functions) : undefined,
        classes: file.classes ? JSON.parse(file.classes) : undefined,
        line_count: file.line_count,
        relevance: 90, // Symbol match
      });
    }
  }

  return results.slice(0, options?.limit || 20);
}

/**
 * Search ChromaDB for semantic matches
 */
async function searchSemantic(query: string, options?: HybridSearchOptions): Promise<SearchResultItem[]> {
  const chromaResults = await searchCodeVector(query, {
    limit: options?.limit || 10,
    language: options?.language,
  });

  // Group by file and aggregate snippets
  const fileMap = new Map<string, SearchResultItem>();

  // ChromaDB returns nested arrays: ids[0], documents[0], etc.
  const ids = chromaResults.ids[0] || [];
  const documents = chromaResults.documents[0] || [];
  const distances = chromaResults.distances?.[0] || [];
  const metadatas = chromaResults.metadatas?.[0] || [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;

    const content = documents[i] || '';
    const distance = distances[i] || 0;
    const metadata = metadatas[i] || {};

    // Extract file_path from metadata or ID (ID format: path:chunk:N)
    const filePath = (metadata.file_path as string) || id.split(':chunk:')[0];
    if (!filePath) continue;

    const language = (metadata.language as string) || 'unknown';
    const relevance = Math.round((1 - (distance as number)) * 100);

    const existing = fileMap.get(filePath);
    if (existing) {
      // Add snippet to existing file
      existing.snippets?.push({
        content,
        relevance,
      });
      // Keep highest relevance
      if (relevance > (existing.relevance || 0)) {
        existing.relevance = relevance;
      }
    } else {
      fileMap.set(filePath, {
        file_path: filePath,
        language,
        relevance,
        snippets: [{
          content,
          relevance,
        }],
      });
    }
  }

  return Array.from(fileMap.values());
}

/**
 * Hybrid search - automatically routes to best search method
 */
export async function hybridSearch(
  query: string,
  options?: HybridSearchOptions
): Promise<HybridSearchResult> {
  const startTime = Date.now();

  // Determine search strategy
  const useExact = isExactQuery(query);

  if (useExact) {
    // Try SQLite first for exact matches
    const sqliteResults = searchSqlite(query, options);

    if (sqliteResults.length > 0) {
      const result = {
        source: 'sqlite' as const,
        query,
        total_results: sqliteResults.length,
        results: sqliteResults,
        query_time_ms: Date.now() - startTime,
      };

      // Log the search for analytics
      logSearch({
        query,
        query_type: 'code',
        result_count: result.total_results,
        latency_ms: result.query_time_ms,
        source: 'hybrid-search-sqlite',
      });

      return result;
    }
  }

  // Fall back to semantic search
  const semanticResults = await searchSemantic(query, options);

  const result = {
    source: 'semantic' as const,
    query,
    total_results: semanticResults.length,
    results: semanticResults,
    query_time_ms: Date.now() - startTime,
  };

  // Log the search for analytics
  logSearch({
    query,
    query_type: 'semantic',
    result_count: result.total_results,
    latency_ms: result.query_time_ms,
    source: 'hybrid-search-semantic',
  });

  return result;
}

/**
 * Force SQLite-only search (fast, for file lookups)
 */
export function fastSearch(query: string, options?: HybridSearchOptions): HybridSearchResult {
  const startTime = Date.now();
  const results = searchSqlite(query, options);

  return {
    source: 'sqlite',
    query,
    total_results: results.length,
    results,
    query_time_ms: Date.now() - startTime,
  };
}

/**
 * Force semantic-only search (for conceptual queries)
 */
export async function semanticSearch(
  query: string,
  options?: HybridSearchOptions
): Promise<HybridSearchResult> {
  const startTime = Date.now();
  const results = await searchSemantic(query, options);

  return {
    source: 'semantic',
    query,
    total_results: results.length,
    results,
    query_time_ms: Date.now() - startTime,
  };
}

/**
 * Get combined index health status
 */
export async function getIndexHealth(projectId?: string): Promise<{
  sqlite: {
    totalFiles: number;
    byLanguage: Record<string, number>;
    externalFiles: number;
    lastIndexed: string | null;
  };
  chromadb: {
    totalDocuments: number;
    languages: Record<string, number>;
  };
  inSync: boolean;
  drift: number;
}> {
  const sqliteStats = getCodeFileStats(projectId);
  const chromaStats = await getCodeIndexStats();

  // Estimate: ~10 chunks per file average
  const estimatedChromaFiles = Math.round(chromaStats.totalDocuments / 10);
  const drift = Math.abs(sqliteStats.totalFiles - estimatedChromaFiles);

  return {
    sqlite: sqliteStats,
    chromadb: chromaStats,
    inSync: drift < 5, // Allow small drift
    drift,
  };
}
