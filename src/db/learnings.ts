/**
 * Learnings - Knowledge capture and maturity tracking
 *
 * This module handles learning persistence with Oracle Incubate pattern
 * for knowledge maturity progression.
 */

import { db } from './core';
import type { Visibility } from './sessions';

// ============================================================================
// Types
// ============================================================================

// Maturity stages for knowledge progression (Oracle Incubate pattern)
export type MaturityStage = 'observation' | 'learning' | 'pattern' | 'principle' | 'wisdom';

export const MATURITY_ICONS: Record<MaturityStage, string> = {
  observation: '🥒',
  learning: '🌱',
  pattern: '🌿',
  principle: '🌳',
  wisdom: '🔮',
};

export const MATURITY_CRITERIA: Record<MaturityStage, { minValidations: number; description: string }> = {
  observation: { minValidations: 0, description: 'Raw insight, untested' },
  learning: { minValidations: 1, description: 'Tested once, not disproven' },
  pattern: { minValidations: 3, description: 'Used 3+ times, consistent results' },
  principle: { minValidations: 5, description: 'Context-independent, universally true' },
  wisdom: { minValidations: 10, description: 'Changed behavior fundamentally' },
};

export interface LearningRecord {
  id?: number;
  category: string;
  title: string;
  description?: string;
  context?: string;
  source_session_id?: string;
  source_url?: string;  // External reference URL(s)
  confidence?: 'low' | 'medium' | 'high' | 'proven';
  maturity_stage?: MaturityStage;
  times_validated?: number;
  last_validated_at?: string;
  agent_id?: number | null;
  visibility?: Visibility;
  created_at?: string;
  updated_at?: string;
  // Structured learning fields
  what_happened?: string;
  lesson?: string;
  prevention?: string;
  project_path?: string;  // Git root path for project/matrix scoping
  // Task linking fields
  source_task_id?: string;  // Link to agent_tasks that generated this
  source_mission_id?: string;  // Link to mission that generated this
  source_unified_task_id?: number;  // Link to business requirement
}

export interface ValidationResult {
  learning: LearningRecord;
  promoted: boolean;
  previousStage?: MaturityStage;
  newStage?: MaturityStage;
  promotionMessage?: string;
}

export interface ListLearningsOptions {
  category?: string;
  confidence?: string;
  limit?: number;
  agentId?: number | null;
  includeShared?: boolean;
  projectPath?: string;  // Filter by project/git root path
}

// ============================================================================
// Functions
// ============================================================================

export function createLearning(learning: LearningRecord): number {
  const result = db.run(
    `INSERT INTO learnings (category, title, description, context, source_session_id, source_url, confidence, agent_id, visibility, what_happened, lesson, prevention, project_path, source_task_id, source_mission_id, source_unified_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      learning.category,
      learning.title,
      learning.description || null,
      learning.context || null,
      learning.source_session_id || null,
      learning.source_url || null,
      learning.confidence || 'medium',
      learning.agent_id ?? null,
      learning.visibility || 'public',
      learning.what_happened || null,
      learning.lesson || null,
      learning.prevention || null,
      learning.project_path || null,
      learning.source_task_id || null,
      learning.source_mission_id || null,
      learning.source_unified_task_id || null,
    ]
  );
  return Number(result.lastInsertRowid);
}

export function getLearningById(learningId: number): LearningRecord | null {
  const row = db.query(`SELECT * FROM learnings WHERE id = ?`).get(learningId) as any;
  if (!row) return null;
  return {
    ...row,
    agent_id: row.agent_id ?? null,
    visibility: row.visibility || 'public',
    project_path: row.project_path || null,
  };
}

/**
 * Full-text search for learnings using SQLite FTS5
 * Returns learnings matching the query keywords, ranked by relevance
 */
export function searchLearningsFTS(query: string, limit = 10): Array<LearningRecord & { fts_rank: number }> {
  // Escape special FTS5 characters and add prefix matching
  const ftsQuery = query
    .replace(/['"]/g, '') // Remove quotes
    .split(/\s+/)
    .filter(term => term.length > 1)
    .map(term => `"${term}"*`) // Prefix match each term
    .join(' OR ');

  if (!ftsQuery) return [];

  try {
    const rows = db.query(`
      SELECT l.*, fts.rank as fts_rank
      FROM learnings l
      JOIN learnings_fts fts ON l.id = fts.rowid
      WHERE learnings_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(ftsQuery, limit) as any[];

    return rows.map(row => ({
      ...row,
      agent_id: row.agent_id ?? null,
      visibility: row.visibility || 'public',
      project_path: row.project_path || null,
    }));
  } catch (error) {
    // FTS table might not be populated yet
    console.error('[FTS] Search error:', error);
    return [];
  }
}

/**
 * Rebuild FTS index from existing learnings data
 */
export function rebuildLearningsFTS(): number {
  // Clear existing FTS data
  db.run(`DELETE FROM learnings_fts`);

  // Repopulate from learnings table
  const result = db.run(`
    INSERT INTO learnings_fts(rowid, title, description, lesson)
    SELECT id, title, description, lesson FROM learnings
  `);

  return result.changes;
}

export function updateLearning(learningId: number, updates: Partial<Pick<LearningRecord, 'title' | 'description' | 'context' | 'confidence' | 'source_url' | 'what_happened' | 'lesson' | 'prevention'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.context !== undefined) { fields.push('context = ?'); values.push(updates.context); }
  if (updates.confidence !== undefined) { fields.push('confidence = ?'); values.push(updates.confidence); }
  if (updates.source_url !== undefined) { fields.push('source_url = ?'); values.push(updates.source_url); }
  if (updates.what_happened !== undefined) { fields.push('what_happened = ?'); values.push(updates.what_happened); }
  if (updates.lesson !== undefined) { fields.push('lesson = ?'); values.push(updates.lesson); }
  if (updates.prevention !== undefined) { fields.push('prevention = ?'); values.push(updates.prevention); }

  if (fields.length === 0) return false;

  values.push(learningId);
  db.run(`UPDATE learnings SET ${fields.join(', ')} WHERE id = ?`, values);
  return true;
}

export function listLearningsFromDb(options?: ListLearningsOptions): LearningRecord[] {
  const { category, confidence, limit = 50, agentId, includeShared = true, projectPath } = options || {};
  let query = `SELECT * FROM learnings WHERE 1=1`;
  const params: any[] = [];

  // Project scoping - filter by git root path
  if (projectPath) {
    query += ` AND project_path = ?`;
    params.push(projectPath);
  }

  // Agent scoping
  if (agentId !== undefined) {
    if (includeShared) {
      // Include agent's own learnings plus shared/public from other agents
      query += ` AND (agent_id = ? OR agent_id IS NULL OR visibility IN ('shared', 'public'))`;
      params.push(agentId);
    } else {
      // Only agent's own learnings
      query += ` AND agent_id = ?`;
      params.push(agentId);
    }
  }

  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }
  if (confidence) {
    query += ` AND confidence = ?`;
    params.push(confidence);
  }
  query += ` ORDER BY times_validated DESC, created_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.query(query).all(...params) as any[];
  return rows.map(row => ({
    ...row,
    agent_id: row.agent_id ?? null,
    visibility: row.visibility || 'public',
    project_path: row.project_path || null,
  }));
}

/**
 * Calculate maturity stage based on times validated
 */
export function calculateMaturityStage(timesValidated: number): MaturityStage {
  if (timesValidated >= 10) return 'wisdom';
  if (timesValidated >= 5) return 'principle';
  if (timesValidated >= 3) return 'pattern';
  if (timesValidated >= 1) return 'learning';
  return 'observation';
}

export function validateLearning(learningId: number): ValidationResult | null {
  const learning = getLearningById(learningId);
  if (!learning) return null;

  const newCount = (learning.times_validated || 1) + 1;
  let newConfidence = learning.confidence || 'medium';

  // Confidence progression
  if (newCount >= 5) newConfidence = 'proven';
  else if (newCount >= 3) newConfidence = 'high';
  else if (newCount >= 2) newConfidence = 'medium';

  // Maturity stage progression (Oracle Incubate pattern)
  const previousStage = learning.maturity_stage || 'observation';
  const newStage = calculateMaturityStage(newCount);
  const promoted = newStage !== previousStage;

  db.run(
    `UPDATE learnings SET times_validated = ?, confidence = ?, maturity_stage = ?, last_validated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newCount, newConfidence, newStage, learningId]
  );

  const updatedLearning = getLearningById(learningId)!;

  const result: ValidationResult = {
    learning: updatedLearning,
    promoted,
  };

  if (promoted) {
    result.previousStage = previousStage;
    result.newStage = newStage;
    result.promotionMessage = `${MATURITY_ICONS[previousStage]} → ${MATURITY_ICONS[newStage]} Promoted from ${previousStage} to ${newStage}!`;
  }

  return result;
}

/**
 * Apply confidence decay to stale learnings
 *
 * Learnings that haven't been validated in a long time are demoted:
 * - proven → high after 180 days
 * - high → medium after 90 days
 * - medium → low after 60 days (if times_validated < 3)
 *
 * @param dryRun - If true, only report what would be decayed without making changes
 * @returns Count of learnings decayed per confidence level
 */
export function applyConfidenceDecay(dryRun = false): {
  provenToHigh: number;
  highToMedium: number;
  mediumToLow: number;
  total: number;
} {
  // Get counts first
  const provenToHigh = (db.query(`
    SELECT COUNT(*) as count FROM learnings
    WHERE confidence = 'proven'
      AND last_validated_at IS NOT NULL
      AND last_validated_at < datetime('now', '-180 days')
  `).get() as { count: number }).count;

  const highToMedium = (db.query(`
    SELECT COUNT(*) as count FROM learnings
    WHERE confidence = 'high'
      AND last_validated_at IS NOT NULL
      AND last_validated_at < datetime('now', '-90 days')
  `).get() as { count: number }).count;

  const mediumToLow = (db.query(`
    SELECT COUNT(*) as count FROM learnings
    WHERE confidence = 'medium'
      AND times_validated < 3
      AND (last_validated_at IS NULL OR last_validated_at < datetime('now', '-60 days'))
  `).get() as { count: number }).count;

  if (!dryRun) {
    // Decay proven → high (180+ days)
    db.run(`
      UPDATE learnings SET confidence = 'high'
      WHERE confidence = 'proven'
        AND last_validated_at IS NOT NULL
        AND last_validated_at < datetime('now', '-180 days')
    `);

    // Decay high → medium (90+ days)
    db.run(`
      UPDATE learnings SET confidence = 'medium'
      WHERE confidence = 'high'
        AND last_validated_at IS NOT NULL
        AND last_validated_at < datetime('now', '-90 days')
    `);

    // Decay medium → low (60+ days, only if not well-validated)
    db.run(`
      UPDATE learnings SET confidence = 'low'
      WHERE confidence = 'medium'
        AND times_validated < 3
        AND (last_validated_at IS NULL OR last_validated_at < datetime('now', '-60 days'))
    `);
  }

  return {
    provenToHigh,
    highToMedium,
    mediumToLow,
    total: provenToHigh + highToMedium + mediumToLow,
  };
}

/**
 * Get learnings that are ready for promotion (close to next threshold)
 */
export function getPromotionCandidates(limit = 10): Array<LearningRecord & { nextStage: MaturityStage; validationsNeeded: number }> {
  const learnings = db.query(`
    SELECT * FROM learnings
    WHERE maturity_stage != 'wisdom'
    ORDER BY times_validated DESC
    LIMIT ?
  `).all(limit) as LearningRecord[];

  return learnings.map(l => {
    const currentValidations = l.times_validated || 1;
    const currentStage = l.maturity_stage || 'observation';

    // Find next stage threshold
    let nextStage: MaturityStage = 'learning';
    let threshold = 1;

    if (currentStage === 'observation') {
      nextStage = 'learning';
      threshold = 1;
    } else if (currentStage === 'learning') {
      nextStage = 'pattern';
      threshold = 3;
    } else if (currentStage === 'pattern') {
      nextStage = 'principle';
      threshold = 5;
    } else if (currentStage === 'principle') {
      nextStage = 'wisdom';
      threshold = 10;
    }

    return {
      ...l,
      nextStage,
      validationsNeeded: Math.max(0, threshold - currentValidations),
    };
  }).filter(l => l.validationsNeeded <= 2); // Only show if within 2 validations of promotion
}

export function getLearningsBySession(sessionId: string): LearningRecord[] {
  return db.query(
    `SELECT * FROM learnings WHERE source_session_id = ? ORDER BY created_at`
  ).all(sessionId) as LearningRecord[];
}

// ============================================================================
// Random Wisdom (Oracle Reflect Pattern)
// ============================================================================

export interface RandomWisdomOptions {
  category?: string;
  minConfidence?: 'low' | 'medium' | 'high' | 'proven';
  minMaturity?: MaturityStage;
  excludeIds?: number[];
}

/**
 * Get a random learning for serendipitous wisdom retrieval.
 * Implements the Oracle Reflect pattern for breaking transactional coding loops.
 *
 * @param opts - Filter options for wisdom selection
 * @returns A random learning matching the criteria, or null if none found
 */
export function getRandomWisdom(opts?: RandomWisdomOptions): LearningRecord | null {
  const confidenceOrder = ['low', 'medium', 'high', 'proven'];
  const maturityOrder: MaturityStage[] = ['observation', 'learning', 'pattern', 'principle', 'wisdom'];

  // Build WHERE clauses
  const conditions: string[] = [];
  const params: any[] = [];

  // Filter by minimum confidence
  if (opts?.minConfidence) {
    const minIdx = confidenceOrder.indexOf(opts.minConfidence);
    const validConfidences = confidenceOrder.slice(minIdx);
    conditions.push(`confidence IN (${validConfidences.map(() => '?').join(',')})`);
    params.push(...validConfidences);
  }

  // Filter by minimum maturity
  if (opts?.minMaturity) {
    const minIdx = maturityOrder.indexOf(opts.minMaturity);
    const validStages = maturityOrder.slice(minIdx);
    conditions.push(`maturity_stage IN (${validStages.map(() => '?').join(',')})`);
    params.push(...validStages);
  }

  // Filter by category
  if (opts?.category) {
    conditions.push(`category = ?`);
    params.push(opts.category);
  }

  // Exclude specific IDs
  if (opts?.excludeIds && opts.excludeIds.length > 0) {
    conditions.push(`id NOT IN (${opts.excludeIds.map(() => '?').join(',')})`);
    params.push(...opts.excludeIds);
  }

  // Build query
  let query = `SELECT * FROM learnings`;
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }
  query += ` ORDER BY RANDOM() LIMIT 1`;

  return db.query(query).get(...params) as LearningRecord | null;
}

/**
 * Get multiple random learnings (for variety/batch display)
 */
export function getRandomWisdomBatch(count = 3, opts?: RandomWisdomOptions): LearningRecord[] {
  const results: LearningRecord[] = [];
  const excludeIds: number[] = [...(opts?.excludeIds || [])];

  for (let i = 0; i < count; i++) {
    const wisdom = getRandomWisdom({ ...opts, excludeIds });
    if (wisdom && wisdom.id) {
      results.push(wisdom);
      excludeIds.push(wisdom.id);
    } else {
      break; // No more matching learnings
    }
  }

  return results;
}
