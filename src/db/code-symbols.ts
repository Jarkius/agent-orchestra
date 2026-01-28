/**
 * Code Symbols - Symbol tracking and pattern detection
 *
 * This module handles code symbol indexing (functions, classes, exports),
 * pattern detection, and learning-code linking for code intelligence.
 */

import { db } from './core';
import type { LearningRecord } from './learnings';
import type { CodeFileRecord } from './code-files';

// ============================================================================
// Types
// ============================================================================

export interface SymbolRecord {
  id?: number;
  code_file_id: string;
  name: string;
  type: 'function' | 'class' | 'export' | 'import';
  line_start?: number;
  line_end?: number;
  signature?: string;
  created_at?: string;
}

export interface CodePatternRecord {
  id?: number;
  code_file_id: string;
  pattern_name: string;
  category?: string;
  description?: string;
  evidence?: string;
  line_number?: number;
  confidence: number;
  detected_at?: string;
}

export interface LearningCodeLinkRecord {
  id?: number;
  learning_id: number;
  code_file_id: string;
  link_type: 'derived_from' | 'applies_to' | 'example_in' | 'pattern_match';
  relevance_score: number;
  created_at?: string;
}

// ============================================================================
// Symbol Functions (Code Learning)
// ============================================================================

/**
 * Upsert a symbol (update or insert)
 */
export function upsertSymbol(symbol: Omit<SymbolRecord, 'id' | 'created_at'>): number {
  const existing = db.query(`
    SELECT id FROM symbols
    WHERE code_file_id = ? AND name = ? AND type = ?
  `).get(symbol.code_file_id, symbol.name, symbol.type) as { id: number } | null;

  if (existing) {
    db.run(`
      UPDATE symbols SET
        line_start = ?, line_end = ?, signature = ?
      WHERE id = ?
    `, [symbol.line_start || null, symbol.line_end || null, symbol.signature || null, existing.id]);
    return existing.id;
  }

  const result = db.run(`
    INSERT INTO symbols (code_file_id, name, type, line_start, line_end, signature)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    symbol.code_file_id,
    symbol.name,
    symbol.type,
    symbol.line_start || null,
    symbol.line_end || null,
    symbol.signature || null,
  ]);
  return Number(result.lastInsertRowid);
}

/**
 * Find symbols by name (supports partial match)
 */
export function findSymbolByName(name: string, options?: {
  type?: 'function' | 'class' | 'export' | 'import';
  exactMatch?: boolean;
  limit?: number;
}): Array<SymbolRecord & { file_path: string }> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.exactMatch) {
    conditions.push('s.name = ?');
    params.push(name);
  } else {
    conditions.push('s.name LIKE ?');
    params.push(`%${name}%`);
  }

  if (options?.type) {
    conditions.push('s.type = ?');
    params.push(options.type);
  }

  const limit = options?.limit || 20;

  // Params order: WHERE conditions, then CASE for name, then LIMIT
  return db.query(`
    SELECT s.*, cf.file_path
    FROM symbols s
    JOIN code_files cf ON s.code_file_id = cf.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE WHEN s.name = ? THEN 0 ELSE 1 END,
      s.name
    LIMIT ?
  `).all(...params, name, limit) as Array<SymbolRecord & { file_path: string }>;
}

/**
 * Get all symbols for a code file
 */
export function getSymbolsForFile(codeFileId: string): SymbolRecord[] {
  return db.query(`
    SELECT * FROM symbols
    WHERE code_file_id = ?
    ORDER BY line_start ASC, name ASC
  `).all(codeFileId) as SymbolRecord[];
}

/**
 * Clear all symbols for a file (before re-indexing)
 */
export function clearSymbolsForFile(codeFileId: string): number {
  return db.run('DELETE FROM symbols WHERE code_file_id = ?', [codeFileId]).changes;
}

/**
 * Bulk insert symbols efficiently
 */
export function bulkInsertSymbols(symbols: Array<Omit<SymbolRecord, 'id' | 'created_at'>>): number {
  if (symbols.length === 0) return 0;

  const stmt = db.prepare(`
    INSERT INTO symbols (code_file_id, name, type, line_start, line_end, signature)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.run('BEGIN TRANSACTION');
  try {
    for (const symbol of symbols) {
      stmt.run(
        symbol.code_file_id,
        symbol.name,
        symbol.type,
        symbol.line_start || null,
        symbol.line_end || null,
        symbol.signature || null
      );
      inserted++;
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }

  return inserted;
}

/**
 * Get symbol statistics
 */
export function getSymbolStats(): {
  totalSymbols: number;
  byType: Record<string, number>;
  filesWithSymbols: number;
} {
  const total = (db.query('SELECT COUNT(*) as c FROM symbols').get() as { c: number }).c;
  const files = (db.query('SELECT COUNT(DISTINCT code_file_id) as c FROM symbols').get() as { c: number }).c;

  const typeRows = db.query(`
    SELECT type, COUNT(*) as count FROM symbols
    GROUP BY type
  `).all() as { type: string; count: number }[];

  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    byType[row.type] = row.count;
  }

  return {
    totalSymbols: total,
    byType,
    filesWithSymbols: files,
  };
}

// ============================================================================
// Code Pattern Functions (Pattern Learning)
// ============================================================================

/**
 * Upsert a detected pattern
 */
export function upsertCodePattern(pattern: Omit<CodePatternRecord, 'id' | 'detected_at'>): number {
  const existing = db.query(`
    SELECT id, confidence FROM code_patterns
    WHERE code_file_id = ? AND pattern_name = ? AND (line_number = ? OR (line_number IS NULL AND ? IS NULL))
  `).get(pattern.code_file_id, pattern.pattern_name, pattern.line_number, pattern.line_number) as { id: number; confidence: number } | null;

  if (existing) {
    // Increase confidence if re-detected
    const newConfidence = Math.min(1.0, existing.confidence + 0.1);
    db.run(`
      UPDATE code_patterns SET
        category = ?, description = ?, evidence = ?, confidence = ?, detected_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [pattern.category || null, pattern.description || null, pattern.evidence || null, newConfidence, existing.id]);
    return existing.id;
  }

  const result = db.run(`
    INSERT INTO code_patterns (code_file_id, pattern_name, category, description, evidence, line_number, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    pattern.code_file_id,
    pattern.pattern_name,
    pattern.category || null,
    pattern.description || null,
    pattern.evidence || null,
    pattern.line_number || null,
    pattern.confidence,
  ]);
  return Number(result.lastInsertRowid);
}

/**
 * Get patterns for a file
 */
export function getPatternsForFile(codeFileId: string): CodePatternRecord[] {
  return db.query(`
    SELECT * FROM code_patterns
    WHERE code_file_id = ?
    ORDER BY confidence DESC, pattern_name ASC
  `).all(codeFileId) as CodePatternRecord[];
}

/**
 * Find files containing a pattern
 */
export function getFilesByPattern(patternName: string, options?: {
  minConfidence?: number;
  limit?: number;
}): Array<CodePatternRecord & { file_path: string }> {
  const minConf = options?.minConfidence || 0.5;
  const limit = options?.limit || 50;

  return db.query(`
    SELECT cp.*, cf.file_path
    FROM code_patterns cp
    JOIN code_files cf ON cp.code_file_id = cf.id
    WHERE cp.pattern_name LIKE ?
      AND cp.confidence >= ?
    ORDER BY cp.confidence DESC
    LIMIT ?
  `).all(`%${patternName}%`, minConf, limit) as Array<CodePatternRecord & { file_path: string }>;
}

/**
 * Clear patterns for a file (before re-analysis)
 */
export function clearPatternsForFile(codeFileId: string): number {
  return db.run('DELETE FROM code_patterns WHERE code_file_id = ?', [codeFileId]).changes;
}

/**
 * Get pattern statistics
 */
export function getPatternStats(): {
  totalPatterns: number;
  byName: Record<string, number>;
  avgConfidence: number;
} {
  const total = (db.query('SELECT COUNT(*) as c FROM code_patterns').get() as { c: number }).c;
  const avgRow = db.query('SELECT AVG(confidence) as avg FROM code_patterns').get() as { avg: number | null };

  const nameRows = db.query(`
    SELECT pattern_name, COUNT(*) as count FROM code_patterns
    GROUP BY pattern_name
    ORDER BY count DESC
  `).all() as { pattern_name: string; count: number }[];

  const byName: Record<string, number> = {};
  for (const row of nameRows) {
    byName[row.pattern_name] = row.count;
  }

  return {
    totalPatterns: total,
    byName,
    avgConfidence: avgRow.avg || 0,
  };
}

// ============================================================================
// Learning-Code Link Functions
// ============================================================================

/**
 * Link a learning to a code file
 */
export function linkLearningToCode(link: Omit<LearningCodeLinkRecord, 'id' | 'created_at'>): number {
  try {
    const result = db.run(`
      INSERT INTO learning_code_links (learning_id, code_file_id, link_type, relevance_score)
      VALUES (?, ?, ?, ?)
    `, [link.learning_id, link.code_file_id, link.link_type, link.relevance_score]);
    return Number(result.lastInsertRowid);
  } catch {
    // Unique constraint - update relevance instead
    db.run(`
      UPDATE learning_code_links SET relevance_score = ?
      WHERE learning_id = ? AND code_file_id = ? AND link_type = ?
    `, [link.relevance_score, link.learning_id, link.code_file_id, link.link_type]);
    return 0;
  }
}

/**
 * Get learnings derived from a code file
 */
export function getLearningsForFile(codeFileId: string, options?: {
  linkType?: LearningCodeLinkRecord['link_type'];
  minRelevance?: number;
  limit?: number;
}): Array<LearningRecord & { link_type: string; relevance_score: number }> {
  const conditions: string[] = ['lcl.code_file_id = ?'];
  const params: any[] = [codeFileId];

  if (options?.linkType) {
    conditions.push('lcl.link_type = ?');
    params.push(options.linkType);
  }

  if (options?.minRelevance) {
    conditions.push('lcl.relevance_score >= ?');
    params.push(options.minRelevance);
  }

  const limit = options?.limit || 20;
  params.push(limit);

  return db.query(`
    SELECT l.*, lcl.link_type, lcl.relevance_score
    FROM learnings l
    JOIN learning_code_links lcl ON l.id = lcl.learning_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY lcl.relevance_score DESC
    LIMIT ?
  `).all(...params) as Array<LearningRecord & { link_type: string; relevance_score: number }>;
}

/**
 * Get code files linked to a learning
 */
export function getFilesForLearning(learningId: number, options?: {
  linkType?: LearningCodeLinkRecord['link_type'];
  limit?: number;
}): Array<CodeFileRecord & { link_type: string; relevance_score: number }> {
  const conditions: string[] = ['lcl.learning_id = ?'];
  const params: any[] = [learningId];

  if (options?.linkType) {
    conditions.push('lcl.link_type = ?');
    params.push(options.linkType);
  }

  const limit = options?.limit || 20;
  params.push(limit);

  return db.query(`
    SELECT cf.*, lcl.link_type, lcl.relevance_score
    FROM code_files cf
    JOIN learning_code_links lcl ON cf.id = lcl.code_file_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY lcl.relevance_score DESC
    LIMIT ?
  `).all(...params) as Array<CodeFileRecord & { link_type: string; relevance_score: number }>;
}

/**
 * Remove a learning-code link
 */
export function unlinkLearningFromCode(learningId: number, codeFileId: string, linkType?: string): number {
  if (linkType) {
    return db.run(
      'DELETE FROM learning_code_links WHERE learning_id = ? AND code_file_id = ? AND link_type = ?',
      [learningId, codeFileId, linkType]
    ).changes;
  }
  return db.run(
    'DELETE FROM learning_code_links WHERE learning_id = ? AND code_file_id = ?',
    [learningId, codeFileId]
  ).changes;
}

/**
 * Get learning-code link statistics
 */
export function getLearningCodeLinkStats(): {
  totalLinks: number;
  byType: Record<string, number>;
  linkedLearnings: number;
  linkedFiles: number;
} {
  const total = (db.query('SELECT COUNT(*) as c FROM learning_code_links').get() as { c: number }).c;
  const learnings = (db.query('SELECT COUNT(DISTINCT learning_id) as c FROM learning_code_links').get() as { c: number }).c;
  const files = (db.query('SELECT COUNT(DISTINCT code_file_id) as c FROM learning_code_links').get() as { c: number }).c;

  const typeRows = db.query(`
    SELECT link_type, COUNT(*) as count FROM learning_code_links
    GROUP BY link_type
  `).all() as { link_type: string; count: number }[];

  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    byType[row.link_type] = row.count;
  }

  return {
    totalLinks: total,
    byType,
    linkedLearnings: learnings,
    linkedFiles: files,
  };
}
