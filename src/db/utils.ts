/**
 * Database utilities - shared helpers for db modules
 */

/**
 * Safely parse JSON with fallback
 */
export function parseJsonSafe<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Parse JSON or return the value if already parsed
 */
export function parseJsonOrValue<T>(value: T | string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  return parseJsonSafe(value, fallback);
}

/**
 * Visibility levels for shared data
 */
export type Visibility = 'private' | 'shared' | 'public';

/**
 * Build visibility filter clause for queries
 * Returns [clause, params] tuple
 */
export function buildVisibilityFilter(
  agentId: number | null | undefined,
  options: { column?: string; allowShared?: boolean } = {}
): [string, (number | null)[]] {
  const column = options.column || 'agent_id';
  const visColumn = column.replace('agent_id', 'visibility');

  if (agentId === undefined) {
    return ['', []];
  }

  if (agentId === null) {
    // Orchestrator: sees own (null) and shared/public
    return [
      ` AND (${column} IS NULL OR ${visColumn} IN ('shared', 'public'))`,
      []
    ];
  }

  // Agent: sees own and shared/public
  return [
    ` AND (${column} = ? OR ${column} IS NULL OR ${visColumn} IN ('shared', 'public'))`,
    [agentId]
  ];
}

/**
 * Standard pagination options
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * Build LIMIT/OFFSET clause
 */
export function buildPagination(options: PaginationOptions): string {
  const parts: string[] = [];
  if (options.limit !== undefined) {
    parts.push(`LIMIT ${options.limit}`);
  }
  if (options.offset !== undefined) {
    parts.push(`OFFSET ${options.offset}`);
  }
  return parts.join(' ');
}
