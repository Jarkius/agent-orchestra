/**
 * Entities - Knowledge Graph for learnings
 *
 * This module handles entity extraction, storage, and relationship
 * management for building a knowledge graph from learnings.
 */

import { db } from './core';
import type { LearningRecord } from './learnings';

// ============================================================================
// Types
// ============================================================================

export interface EntityRecord {
  id?: number;
  name: string;
  type?: 'concept' | 'tool' | 'pattern' | 'file' | 'category';
  created_at?: string;
}

export type RelationshipType =
  | 'depends_on' | 'enables' | 'conflicts_with' | 'alternative_to'
  | 'specializes' | 'generalizes' | 'precedes' | 'follows' | 'complements';

export interface EntityRelationship {
  id?: number;
  source_entity_id: number;
  target_entity_id: number;
  relationship_type: RelationshipType;
  strength: number;
  bidirectional: boolean;
  reasoning?: string;
  source_learning_id?: number;
  created_at?: string;
}

export interface EntityRelationshipWithNames extends EntityRelationship {
  source_name: string;
  target_name: string;
}

// ============================================================================
// Stopwords for entity extraction
// ============================================================================

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also',
  'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'any', 'some',
  'use', 'using', 'used', 'uses', 'get', 'set', 'add', 'new', 'old',
]);

// ============================================================================
// Entity Functions
// ============================================================================

/**
 * Extract entities (keywords) from text
 */
export function extractEntities(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')  // Keep hyphens for compound terms
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOPWORDS.has(word))
    .filter((word, index, self) => self.indexOf(word) === index); // Dedupe
}

/**
 * Get or create an entity by name
 */
export function getOrCreateEntity(name: string, type: EntityRecord['type'] = 'concept'): number {
  const normalized = name.toLowerCase().trim();

  // Atomic upsert - no TOCTOU race condition
  db.run(
    `INSERT INTO entities (name, type) VALUES (?, ?)
     ON CONFLICT(name) DO NOTHING`,
    [normalized, type]
  );

  // Get the ID (either newly inserted or existing)
  const row = db.query(`SELECT id FROM entities WHERE name = ?`).get(normalized) as { id: number };
  return row.id;
}

/**
 * Link a learning to an entity
 */
export function linkLearningToEntity(learningId: number, entityId: number, relevance: number = 1.0): void {
  db.run(
    `INSERT OR REPLACE INTO learning_entities (learning_id, entity_id, relevance) VALUES (?, ?, ?)`,
    [learningId, entityId, relevance]
  );
}

/**
 * Extract and link entities for a learning
 */
export function extractAndLinkEntities(learningId: number, text: string): string[] {
  const entities = extractEntities(text);

  for (const entityName of entities) {
    const entityId = getOrCreateEntity(entityName);
    linkLearningToEntity(learningId, entityId);
  }

  return entities;
}

/**
 * Get all entities for a learning
 */
export function getLearningEntities(learningId: number): EntityRecord[] {
  return db.query(
    `SELECT e.* FROM entities e
     JOIN learning_entities le ON e.id = le.entity_id
     WHERE le.learning_id = ?
     ORDER BY le.relevance DESC`
  ).all(learningId) as EntityRecord[];
}

/**
 * Get all learnings for an entity (by name or ID)
 */
export function getEntityLearnings(entityNameOrId: string | number): LearningRecord[] {
  const query = typeof entityNameOrId === 'number'
    ? `SELECT l.* FROM learnings l
       JOIN learning_entities le ON l.id = le.learning_id
       WHERE le.entity_id = ?
       ORDER BY l.confidence DESC, l.times_validated DESC`
    : `SELECT l.* FROM learnings l
       JOIN learning_entities le ON l.id = le.learning_id
       JOIN entities e ON le.entity_id = e.id
       WHERE e.name = ?
       ORDER BY l.confidence DESC, l.times_validated DESC`;

  const param = typeof entityNameOrId === 'number' ? entityNameOrId : entityNameOrId.toLowerCase().trim();
  return db.query(query).all(param) as LearningRecord[];
}

/**
 * Get related entities (entities that co-occur with given entity in learnings)
 */
export function getRelatedEntities(entityName: string, limit: number = 10): Array<{ entity: EntityRecord; sharedCount: number }> {
  const normalized = entityName.toLowerCase().trim();

  const results = db.query(
    `SELECT e.*, COUNT(DISTINCT le2.learning_id) as shared_count
     FROM entities e
     JOIN learning_entities le2 ON e.id = le2.entity_id
     WHERE le2.learning_id IN (
       SELECT le1.learning_id FROM learning_entities le1
       JOIN entities e1 ON le1.entity_id = e1.id
       WHERE e1.name = ?
     )
     AND e.name != ?
     GROUP BY e.id
     ORDER BY shared_count DESC
     LIMIT ?`
  ).all(normalized, normalized, limit) as any[];

  return results.map(row => ({
    entity: { id: row.id, name: row.name, type: row.type, created_at: row.created_at },
    sharedCount: row.shared_count,
  }));
}

/**
 * Get entity by name
 */
export function getEntityByName(name: string): EntityRecord | null {
  const normalized = name.toLowerCase().trim();
  return db.query(`SELECT * FROM entities WHERE name = ?`).get(normalized) as EntityRecord | null;
}

/**
 * List all entities with learning counts
 */
export function listEntities(limit: number = 50): Array<{ entity: EntityRecord; learningCount: number }> {
  const results = db.query(
    `SELECT e.*, COUNT(le.learning_id) as learning_count
     FROM entities e
     LEFT JOIN learning_entities le ON e.id = le.entity_id
     GROUP BY e.id
     ORDER BY learning_count DESC
     LIMIT ?`
  ).all(limit) as any[];

  return results.map(row => ({
    entity: { id: row.id, name: row.name, type: row.type, created_at: row.created_at },
    learningCount: row.learning_count,
  }));
}

/**
 * Find path between two entities through shared learnings (BFS)
 * Returns array of steps: [{entity, learning}, ...]
 */
export function findEntityPath(
  fromEntity: string,
  toEntity: string,
  maxDepth: number = 4
): Array<{ entity: EntityRecord; learning: LearningRecord | null }> | null {
  const fromNorm = fromEntity.toLowerCase().trim();
  const toNorm = toEntity.toLowerCase().trim();

  // Get starting entity
  const startEntity = getEntityByName(fromNorm);
  const endEntity = getEntityByName(toNorm);

  if (!startEntity || !endEntity || !startEntity.id || !endEntity.id) return null;
  if (startEntity.id === endEntity.id) return [{ entity: startEntity, learning: null }];

  const startId = startEntity.id;
  const endId = endEntity.id;

  // BFS to find shortest path
  const visited = new Set<number>([startId]);
  const queue: Array<{
    entityId: number;
    path: Array<{ entityId: number; learningId: number | null }>;
  }> = [{ entityId: startId, path: [{ entityId: startId, learningId: null }] }];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.path.length > maxDepth) continue;

    // Get learnings for current entity
    const learnings = db.query(
      `SELECT l.id as learning_id, e.id as entity_id
       FROM learnings l
       JOIN learning_entities le1 ON l.id = le1.learning_id
       JOIN learning_entities le2 ON l.id = le2.learning_id
       JOIN entities e ON le2.entity_id = e.id
       WHERE le1.entity_id = ? AND e.id != ?`
    ).all(current.entityId, current.entityId) as Array<{ learning_id: number; entity_id: number }>;

    for (const row of learnings) {
      if (visited.has(row.entity_id)) continue;
      visited.add(row.entity_id);

      const newPath = [...current.path, { entityId: row.entity_id, learningId: row.learning_id }];

      // Found target
      if (row.entity_id === endId) {
        // Convert to full records
        return newPath.map(step => ({
          entity: db.query(`SELECT * FROM entities WHERE id = ?`).get(step.entityId) as EntityRecord,
          learning: step.learningId
            ? (db.query(`SELECT * FROM learnings WHERE id = ?`).get(step.learningId) as LearningRecord)
            : null,
        }));
      }

      queue.push({ entityId: row.entity_id, path: newPath });
    }
  }

  return null; // No path found
}

// ============================================================================
// Entity Relationship Functions
// ============================================================================

/**
 * Add a relationship between two entities
 */
export function addEntityRelationship(
  sourceEntityId: number,
  targetEntityId: number,
  type: RelationshipType,
  options: {
    strength?: number;
    bidirectional?: boolean;
    reasoning?: string;
    sourceLearningId?: number;
  } = {}
): number {
  const { strength = 1.0, bidirectional = false, reasoning, sourceLearningId } = options;

  db.run(
    `INSERT INTO entity_relationships
     (source_entity_id, target_entity_id, relationship_type, strength, bidirectional, reasoning, source_learning_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_entity_id, target_entity_id, relationship_type) DO UPDATE SET
       strength = excluded.strength,
       bidirectional = excluded.bidirectional,
       reasoning = excluded.reasoning`,
    [sourceEntityId, targetEntityId, type, strength, bidirectional ? 1 : 0, reasoning, sourceLearningId]
  );

  const row = db.query(`SELECT last_insert_rowid() as id`).get() as { id: number };
  return row.id;
}

/**
 * Get all relationships for an entity (outgoing and optionally incoming)
 */
export function getEntityRelationships(
  entityId: number,
  options: { includeIncoming?: boolean; types?: RelationshipType[] } = {}
): EntityRelationshipWithNames[] {
  const { includeIncoming = true, types } = options;

  let sql = `
    SELECT r.*,
           es.name as source_name,
           et.name as target_name
    FROM entity_relationships r
    JOIN entities es ON r.source_entity_id = es.id
    JOIN entities et ON r.target_entity_id = et.id
    WHERE r.source_entity_id = ?`;

  if (includeIncoming) {
    sql += ` OR r.target_entity_id = ?`;
  }

  if (types && types.length > 0) {
    const typePlaceholders = types.map(() => '?').join(', ');
    sql += ` AND r.relationship_type IN (${typePlaceholders})`;
  }

  sql += ` ORDER BY r.strength DESC`;

  const params: any[] = includeIncoming ? [entityId, entityId] : [entityId];
  if (types && types.length > 0) {
    params.push(...types);
  }

  const results = db.query(sql).all(...params) as any[];

  return results.map(row => ({
    id: row.id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    relationship_type: row.relationship_type as RelationshipType,
    strength: row.strength,
    bidirectional: row.bidirectional === 1,
    reasoning: row.reasoning,
    source_learning_id: row.source_learning_id,
    created_at: row.created_at,
    source_name: row.source_name,
    target_name: row.target_name,
  }));
}

/**
 * Get entity hierarchy (generalizes/specializes chains)
 */
export function getEntityHierarchy(
  entityName: string,
  direction: 'up' | 'down' | 'both' = 'both'
): { ancestors: EntityRecord[]; descendants: EntityRecord[] } {
  const entity = getEntityByName(entityName);
  if (!entity || !entity.id) {
    return { ancestors: [], descendants: [] };
  }

  const ancestors: EntityRecord[] = [];
  const descendants: EntityRecord[] = [];

  // Go up (generalizes)
  if (direction === 'up' || direction === 'both') {
    const visited = new Set<number>([entity.id]);
    const queue = [entity.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const parents = db.query(`
        SELECT e.* FROM entities e
        JOIN entity_relationships r ON e.id = r.target_entity_id
        WHERE r.source_entity_id = ? AND r.relationship_type = 'specializes'
      `).all(currentId) as EntityRecord[];

      for (const parent of parents) {
        if (parent.id && !visited.has(parent.id)) {
          visited.add(parent.id);
          ancestors.push(parent);
          queue.push(parent.id);
        }
      }
    }
  }

  // Go down (specializes)
  if (direction === 'down' || direction === 'both') {
    const visited = new Set<number>([entity.id]);
    const queue = [entity.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = db.query(`
        SELECT e.* FROM entities e
        JOIN entity_relationships r ON e.id = r.source_entity_id
        WHERE r.target_entity_id = ? AND r.relationship_type = 'specializes'
      `).all(currentId) as EntityRecord[];

      for (const child of children) {
        if (child.id && !visited.has(child.id)) {
          visited.add(child.id);
          descendants.push(child);
          queue.push(child.id);
        }
      }
    }
  }

  return { ancestors, descendants };
}

/**
 * Find entities by relationship type
 */
export function findEntitiesByRelationship(
  entityName: string,
  relationshipType: RelationshipType,
  direction: 'outgoing' | 'incoming' | 'both' = 'both'
): EntityRecord[] {
  const entity = getEntityByName(entityName);
  if (!entity || !entity.id) return [];

  const results: EntityRecord[] = [];
  const visited = new Set<number>();

  if (direction === 'outgoing' || direction === 'both') {
    const outgoing = db.query(`
      SELECT e.* FROM entities e
      JOIN entity_relationships r ON e.id = r.target_entity_id
      WHERE r.source_entity_id = ? AND r.relationship_type = ?
    `).all(entity.id, relationshipType) as EntityRecord[];

    for (const e of outgoing) {
      if (e.id && !visited.has(e.id)) {
        visited.add(e.id);
        results.push(e);
      }
    }
  }

  if (direction === 'incoming' || direction === 'both') {
    const incoming = db.query(`
      SELECT e.* FROM entities e
      JOIN entity_relationships r ON e.id = r.source_entity_id
      WHERE r.target_entity_id = ? AND r.relationship_type = ?
    `).all(entity.id, relationshipType) as EntityRecord[];

    for (const e of incoming) {
      if (e.id && !visited.has(e.id)) {
        visited.add(e.id);
        results.push(e);
      }
    }
  }

  return results;
}

/**
 * Get relationship statistics
 */
export function getRelationshipStats(): {
  total: number;
  byType: Record<RelationshipType, number>;
  avgStrength: number;
} {
  const total = db.query(`SELECT COUNT(*) as count FROM entity_relationships`).get() as { count: number };
  const avgStrength = db.query(`SELECT AVG(strength) as avg FROM entity_relationships`).get() as { avg: number | null };

  const byType: Record<RelationshipType, number> = {} as any;
  const types = db.query(`
    SELECT relationship_type, COUNT(*) as count
    FROM entity_relationships
    GROUP BY relationship_type
  `).all() as Array<{ relationship_type: RelationshipType; count: number }>;

  for (const row of types) {
    byType[row.relationship_type] = row.count;
  }

  return {
    total: total.count,
    byType,
    avgStrength: avgStrength.avg ?? 0,
  };
}
