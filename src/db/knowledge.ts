/**
 * Knowledge - Knowledge and Lesson persistence
 *
 * This module handles the dual-collection pattern for
 * knowledge items and problem/solution lessons.
 */

import { db } from './core';

// ============================================================================
// Types
// ============================================================================

export interface KnowledgeRecord {
  id?: number;
  content: string;
  mission_id?: string;
  category?: string;
  agent_id?: number;
  created_at?: string;
}

export interface LessonRecord {
  id?: number;
  problem: string;
  solution: string;
  outcome: string;
  category?: string;
  confidence?: number;
  frequency?: number;
  agent_id?: number;
  created_at?: string;
}

// ============================================================================
// Knowledge Functions (Dual-Collection Pattern)
// ============================================================================

export function createKnowledge(knowledge: Omit<KnowledgeRecord, 'id' | 'created_at'>): number {
  const result = db.run(
    `INSERT INTO knowledge (content, mission_id, category, agent_id)
     VALUES (?, ?, ?, ?)`,
    [
      knowledge.content,
      knowledge.mission_id || null,
      knowledge.category || null,
      knowledge.agent_id ?? null,
    ]
  );
  return Number(result.lastInsertRowid);
}

export function getKnowledgeById(knowledgeId: number): KnowledgeRecord | null {
  return db.query(`SELECT * FROM knowledge WHERE id = ?`).get(knowledgeId) as KnowledgeRecord | null;
}

export function listKnowledge(options?: {
  category?: string;
  missionId?: string;
  agentId?: number;
  limit?: number;
}): KnowledgeRecord[] {
  const { category, missionId, agentId, limit = 50 } = options || {};
  let query = `SELECT * FROM knowledge WHERE 1=1`;
  const params: any[] = [];

  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }
  if (missionId) {
    query += ` AND mission_id = ?`;
    params.push(missionId);
  }
  if (agentId !== undefined) {
    query += ` AND agent_id = ?`;
    params.push(agentId);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  return db.query(query).all(...params) as KnowledgeRecord[];
}

// ============================================================================
// Lesson Functions (Dual-Collection Pattern)
// ============================================================================

export function createLesson(lesson: Omit<LessonRecord, 'id' | 'created_at' | 'frequency'>): number {
  const result = db.run(
    `INSERT INTO lessons (problem, solution, outcome, category, confidence, agent_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      lesson.problem,
      lesson.solution,
      lesson.outcome,
      lesson.category || null,
      lesson.confidence ?? 0.5,
      lesson.agent_id ?? null,
    ]
  );
  return Number(result.lastInsertRowid);
}

export function getLessonById(lessonId: number): LessonRecord | null {
  return db.query(`SELECT * FROM lessons WHERE id = ?`).get(lessonId) as LessonRecord | null;
}

export function updateLessonFrequency(lessonId: number): void {
  db.run(
    `UPDATE lessons SET frequency = frequency + 1 WHERE id = ?`,
    [lessonId]
  );
}

export function updateLessonConfidence(lessonId: number, confidence: number): void {
  db.run(
    `UPDATE lessons SET confidence = ? WHERE id = ?`,
    [Math.max(0, Math.min(1, confidence)), lessonId]
  );
}

export function listLessons(options?: {
  category?: string;
  minConfidence?: number;
  agentId?: number;
  limit?: number;
}): LessonRecord[] {
  const { category, minConfidence, agentId, limit = 50 } = options || {};
  let query = `SELECT * FROM lessons WHERE 1=1`;
  const params: any[] = [];

  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }
  if (minConfidence !== undefined) {
    query += ` AND confidence >= ?`;
    params.push(minConfidence);
  }
  if (agentId !== undefined) {
    query += ` AND agent_id = ?`;
    params.push(agentId);
  }

  query += ` ORDER BY (frequency * confidence) DESC, created_at DESC LIMIT ?`;
  params.push(limit);

  return db.query(query).all(...params) as LessonRecord[];
}

/**
 * Find or create a lesson - if a similar problem exists, update frequency
 */
export function findOrCreateLesson(lesson: Omit<LessonRecord, 'id' | 'created_at' | 'frequency'>): number {
  // Check for existing lesson with same problem (case-insensitive)
  const existing = db.query(
    `SELECT id FROM lessons WHERE LOWER(problem) = LOWER(?) LIMIT 1`
  ).get(lesson.problem) as { id: number } | null;

  if (existing) {
    updateLessonFrequency(existing.id);
    return existing.id;
  }

  return createLesson(lesson);
}

/**
 * Decay confidence of stale learnings
 */
export function decayStaleConfidence(olderThanDays: number): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  // Decay proven → high, high → medium, medium → low
  // Skip those validated recently
  const result = db.run(`
    UPDATE learnings
    SET confidence = CASE
      WHEN confidence = 'proven' THEN 'high'
      WHEN confidence = 'high' THEN 'medium'
      WHEN confidence = 'medium' THEN 'low'
      ELSE confidence
    END
    WHERE created_at < ?
      AND (last_validated_at IS NULL OR last_validated_at < ?)
      AND confidence != 'low'
  `, [cutoffDate.toISOString(), cutoffDate.toISOString()]);

  return result.changes;
}
