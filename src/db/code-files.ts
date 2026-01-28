/**
 * Code Files Index - SQLite-indexed code file management
 *
 * This module provides fast code file lookup and management without
 * requiring ChromaDB. Used by the code indexer for file tracking.
 */

import { db } from './core';

// ============================================================================
// Types
// ============================================================================

export interface CodeFileRecord {
  id: string;
  file_path: string;
  real_path: string | null;
  project_id: string;
  file_name: string;
  language: string | null;
  line_count: number;
  size_bytes: number;
  chunk_count: number;
  functions: string | null;
  classes: string | null;
  imports: string | null;
  exports: string | null;
  is_external: number;
  content: string | null;  // Full source code for fast retrieval and pattern analysis
  indexed_at: string;
  updated_at: string;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Check if a file is indexed (fast SQLite lookup, no ChromaDB needed)
 */
export function isFileIndexed(filePath: string, projectId?: string): boolean {
  const query = projectId
    ? db.query('SELECT 1 FROM code_files WHERE file_path = ? AND project_id = ?')
    : db.query('SELECT 1 FROM code_files WHERE file_path = ?');
  const row = projectId ? query.get(filePath, projectId) : query.get(filePath);
  return !!row;
}

/**
 * Find files by pattern (like glob but from index)
 */
export function findIndexedFiles(pattern: string, options?: {
  projectId?: string;
  language?: string;
  limit?: number;
  includeExternal?: boolean;
}): CodeFileRecord[] {
  const conditions: string[] = ['(file_path LIKE ? OR file_name LIKE ?)'];
  const params: any[] = [`%${pattern}%`, `%${pattern}%`];

  if (options?.projectId) {
    conditions.push('project_id = ?');
    params.push(options.projectId);
  }
  if (options?.language) {
    conditions.push('language = ?');
    params.push(options.language);
  }
  if (!options?.includeExternal) {
    conditions.push('is_external = 0');
  }

  const limit = options?.limit || 50;
  const sql = `
    SELECT * FROM code_files
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  params.push(limit);

  return db.query(sql).all(...params) as CodeFileRecord[];
}

/**
 * List files by language
 */
export function getFilesByLanguage(language: string, projectId?: string): string[] {
  const query = projectId
    ? db.query('SELECT file_path FROM code_files WHERE language = ? AND project_id = ?')
    : db.query('SELECT file_path FROM code_files WHERE language = ?');
  const rows = projectId
    ? query.all(language, projectId)
    : query.all(language);
  return (rows as { file_path: string }[]).map(r => r.file_path);
}

/**
 * Get file metadata instantly from SQLite
 */
export function getFileMetadata(filePath: string, projectId?: string): CodeFileRecord | null {
  const query = projectId
    ? db.query('SELECT * FROM code_files WHERE file_path = ? AND project_id = ?')
    : db.query('SELECT * FROM code_files WHERE file_path = ? LIMIT 1');
  return (projectId
    ? query.get(filePath, projectId)
    : query.get(filePath)) as CodeFileRecord | null;
}

/**
 * Upsert a code file record (called by indexer after embedding)
 */
export function upsertCodeFile(record: Omit<CodeFileRecord, 'indexed_at' | 'updated_at'> & {
  indexed_at?: string;
  updated_at?: string;
}): void {
  const now = new Date().toISOString();
  db.run(`
    INSERT INTO code_files
    (id, file_path, real_path, project_id, file_name, language, line_count,
     size_bytes, chunk_count, functions, classes, imports, exports,
     is_external, content, indexed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path, project_id) DO UPDATE SET
      real_path = excluded.real_path,
      file_name = excluded.file_name,
      language = excluded.language,
      line_count = excluded.line_count,
      size_bytes = excluded.size_bytes,
      chunk_count = excluded.chunk_count,
      functions = excluded.functions,
      classes = excluded.classes,
      imports = excluded.imports,
      exports = excluded.exports,
      is_external = excluded.is_external,
      content = excluded.content,
      updated_at = excluded.updated_at
  `, [
    record.id,
    record.file_path,
    record.real_path,
    record.project_id,
    record.file_name,
    record.language,
    record.line_count,
    record.size_bytes,
    record.chunk_count,
    record.functions,
    record.classes,
    record.imports,
    record.exports,
    record.is_external,
    record.content,
    record.indexed_at || now,
    record.updated_at || now,
  ]);
}

/**
 * Remove a code file from the index
 */
export function removeCodeFile(filePath: string, projectId: string): void {
  db.run('DELETE FROM code_files WHERE file_path = ? AND project_id = ?', [filePath, projectId]);
}

/**
 * Get a single code file by path (includes full content)
 */
export function getCodeFile(filePath: string, projectId?: string): CodeFileRecord | null {
  if (projectId) {
    return db.query('SELECT * FROM code_files WHERE file_path = ? AND project_id = ?')
      .get(filePath, projectId) as CodeFileRecord | null;
  }
  return db.query('SELECT * FROM code_files WHERE file_path = ?')
    .get(filePath) as CodeFileRecord | null;
}

/**
 * Get all code files (optionally with content for bulk operations)
 */
export function getAllCodeFiles(options?: {
  projectId?: string;
  language?: string;
  includeContent?: boolean;
  limit?: number;
}): CodeFileRecord[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.projectId) {
    conditions.push('project_id = ?');
    params.push(options.projectId);
  }
  if (options?.language) {
    conditions.push('language = ?');
    params.push(options.language);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const selectCols = options?.includeContent
    ? '*'
    : 'id, file_path, real_path, project_id, file_name, language, line_count, size_bytes, chunk_count, functions, classes, imports, exports, is_external, indexed_at, updated_at';
  const limitClause = options?.limit ? `LIMIT ${options.limit}` : '';

  return db.query(`SELECT ${selectCols} FROM code_files ${whereClause} ORDER BY file_path ${limitClause}`)
    .all(...params) as CodeFileRecord[];
}

/**
 * Get code file index statistics
 */
export function getCodeFileStats(projectId?: string): {
  totalFiles: number;
  byLanguage: Record<string, number>;
  externalFiles: number;
  lastIndexed: string | null;
} {
  const whereClause = projectId ? 'WHERE project_id = ?' : '';
  const params = projectId ? [projectId] : [];

  const totalRow = db.query(`SELECT COUNT(*) as count FROM code_files ${whereClause}`).get(...params) as { count: number };
  const externalRow = db.query(`SELECT COUNT(*) as count FROM code_files ${whereClause ? whereClause + ' AND' : 'WHERE'} is_external = 1`).get(...params) as { count: number };
  const lastRow = db.query(`SELECT MAX(updated_at) as last FROM code_files ${whereClause}`).get(...params) as { last: string | null };

  const langRows = db.query(`
    SELECT language, COUNT(*) as count FROM code_files
    ${whereClause}
    GROUP BY language
    ORDER BY count DESC
  `).all(...params) as { language: string | null; count: number }[];

  const byLanguage: Record<string, number> = {};
  for (const row of langRows) {
    byLanguage[row.language || 'unknown'] = row.count;
  }

  return {
    totalFiles: totalRow.count,
    byLanguage,
    externalFiles: externalRow.count,
    lastIndexed: lastRow.last,
  };
}

/**
 * Quick check for fresh clone indicators
 * Used by MCP startup health check - lightweight, no vector ops
 */
export function getSystemStateQuick(): {
  hasAgents: boolean;
  hasSessions: boolean;
  hasLearnings: boolean;
  hasCodeIndex: boolean;
  agentCount: number;
  sessionCount: number;
  learningCount: number;
  codeFileCount: number;
} {
  const agents = (db.query('SELECT COUNT(*) as c FROM agents').get() as { c: number }).c;
  const sessions = (db.query('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c;
  const learnings = (db.query('SELECT COUNT(*) as c FROM learnings').get() as { c: number }).c;

  let codeFiles = 0;
  try {
    codeFiles = (db.query('SELECT COUNT(*) as c FROM code_files').get() as { c: number }).c;
  } catch {
    // Table may not exist on fresh clone
  }

  return {
    hasAgents: agents > 0,
    hasSessions: sessions > 0,
    hasLearnings: learnings > 0,
    hasCodeIndex: codeFiles > 0,
    agentCount: agents,
    sessionCount: sessions,
    learningCount: learnings,
    codeFileCount: codeFiles,
  };
}

/**
 * Find files containing a function or class name
 */
export function findFilesBySymbol(symbol: string, options?: {
  projectId?: string;
  symbolType?: 'function' | 'class' | 'any';
  limit?: number;
}): CodeFileRecord[] {
  const conditions: string[] = [];
  const params: any[] = [];
  const searchPattern = `%"${symbol}"%`;

  if (options?.symbolType === 'function') {
    conditions.push('functions LIKE ?');
    params.push(searchPattern);
  } else if (options?.symbolType === 'class') {
    conditions.push('classes LIKE ?');
    params.push(searchPattern);
  } else {
    conditions.push('(functions LIKE ? OR classes LIKE ?)');
    params.push(searchPattern, searchPattern);
  }

  if (options?.projectId) {
    conditions.push('project_id = ?');
    params.push(options.projectId);
  }

  const limit = options?.limit || 20;
  const sql = `
    SELECT * FROM code_files
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  params.push(limit);

  return db.query(sql).all(...params) as CodeFileRecord[];
}
