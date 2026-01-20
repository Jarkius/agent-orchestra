/**
 * Memory Consolidation Engine
 * Finds and merges duplicate learnings to reduce noise and maintain single source of truth
 */

import {
  getLearningById,
  listLearningsFromDb,
  getLinkedLearnings,
  createLearningLink,
  deleteLearning,
  type LearningRecord,
} from '../db';
import {
  searchLearnings,
  saveLearning,
  isInitialized,
  initVectorDB,
} from '../vector-db';
import { Database } from 'bun:sqlite';
import { ChromaClient } from 'chromadb';

// Types
export interface ConsolidationCandidate {
  primary: LearningRecord;
  duplicates: LearningRecord[];
  avgSimilarity: number;
  sharedEntities: string[];
}

export interface MergeStrategy {
  keepId: number;
  mergeIds: number[];
  combinedConfidence: 'low' | 'medium' | 'high' | 'proven';
  combinedValidations: number;
  mergedDescription: string;
}

export interface ConsolidationResult {
  keptId: number;
  mergedCount: number;
  linksUpdated: number;
}

export interface ConsolidationStats {
  candidatesFound: number;
  totalDuplicates: number;
  merged: number;
  errors: string[];
}

// Confidence ordering for comparison
const CONFIDENCE_ORDER: Record<string, number> = {
  proven: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Find learnings that are candidates for consolidation based on semantic similarity
 */
export async function findConsolidationCandidates(options?: {
  minSimilarity?: number;
  category?: string;
  limit?: number;
}): Promise<ConsolidationCandidate[]> {
  const { minSimilarity = 0.90, category, limit = 50 } = options || {};

  if (!isInitialized()) await initVectorDB();

  // Get all learnings
  const learnings = listLearningsFromDb({
    category,
    limit: 500, // Process up to 500 learnings
  });

  const candidates: ConsolidationCandidate[] = [];
  const processed = new Set<number>();

  for (const learning of learnings) {
    if (processed.has(learning.id!)) continue;

    // Search for similar learnings
    const searchText = `${learning.title} ${learning.description || ''} ${learning.lesson || ''}`;
    const similar = await searchLearnings(searchText, {
      limit: 10,
      category,
    });

    if (!similar.ids[0] || similar.ids[0].length <= 1) continue;

    // Filter by similarity threshold
    const duplicates: LearningRecord[] = [];
    let totalSimilarity = 0;

    for (let i = 0; i < similar.ids[0].length; i++) {
      const id = parseInt(similar.ids[0][i].replace('learning_', ''));
      const distance = similar.distances?.[0]?.[i] ?? 1;
      const similarity = 1 - distance; // Convert distance to similarity

      if (id !== learning.id && similarity >= minSimilarity && !processed.has(id)) {
        const dup = getLearningById(id);
        if (dup) {
          duplicates.push(dup);
          totalSimilarity += similarity;
          processed.add(id);
        }
      }
    }

    if (duplicates.length > 0) {
      processed.add(learning.id!);
      candidates.push({
        primary: learning,
        duplicates,
        avgSimilarity: totalSimilarity / duplicates.length,
        sharedEntities: [], // Could be populated from knowledge graph
      });

      if (candidates.length >= limit) break;
    }
  }

  // Sort by number of duplicates (most duplicates first)
  return candidates.sort((a, b) => b.duplicates.length - a.duplicates.length);
}

/**
 * Calculate the optimal merge strategy for a set of duplicate learnings
 */
export function calculateMergeStrategy(
  primary: LearningRecord,
  duplicates: LearningRecord[]
): MergeStrategy {
  const allLearnings = [primary, ...duplicates];

  // Find the one with highest confidence
  let bestLearning = primary;
  for (const learning of allLearnings) {
    const currentScore = CONFIDENCE_ORDER[learning.confidence || 'low'] || 1;
    const bestScore = CONFIDENCE_ORDER[bestLearning.confidence || 'low'] || 1;

    if (currentScore > bestScore) {
      bestLearning = learning;
    } else if (currentScore === bestScore) {
      // Tie-breaker: more validations wins
      if ((learning.times_validated || 0) > (bestLearning.times_validated || 0)) {
        bestLearning = learning;
      }
    }
  }

  // Sum all validations
  const combinedValidations = allLearnings.reduce(
    (sum, l) => sum + (l.times_validated || 1),
    0
  );

  // Determine combined confidence based on total validations
  let combinedConfidence: MergeStrategy['combinedConfidence'] = 'low';
  if (combinedValidations >= 5) combinedConfidence = 'proven';
  else if (combinedValidations >= 3) combinedConfidence = 'high';
  else if (combinedValidations >= 2) combinedConfidence = 'medium';

  // Merge descriptions (combine unique content)
  const descriptions = allLearnings
    .map(l => l.description || l.lesson || '')
    .filter(d => d.length > 0);
  const uniqueDescriptions = [...new Set(descriptions)];
  const mergedDescription = uniqueDescriptions.join('\n\n---\n\n');

  return {
    keepId: bestLearning.id!,
    mergeIds: allLearnings.filter(l => l.id !== bestLearning.id).map(l => l.id!),
    combinedConfidence,
    combinedValidations,
    mergedDescription,
  };
}

/**
 * Execute the consolidation - merge duplicates into primary learning
 */
export async function consolidateLearnings(
  strategy: MergeStrategy
): Promise<ConsolidationResult> {
  const db = new Database('agents.db');
  let linksUpdated = 0;

  try {
    // 1. Update primary learning with combined data
    db.run(
      `UPDATE learnings
       SET confidence = ?,
           times_validated = ?,
           description = COALESCE(description, '') || CASE WHEN ? != '' THEN '\n\n' || ? ELSE '' END
       WHERE id = ?`,
      [
        strategy.combinedConfidence,
        strategy.combinedValidations,
        strategy.mergedDescription,
        strategy.mergedDescription,
        strategy.keepId,
      ]
    );

    // 2. Redirect all learning_links from merged → primary
    for (const mergeId of strategy.mergeIds) {
      // Update links pointing TO the merged learning (ignore if creates duplicate)
      const updateTo = db.run(
        `UPDATE OR IGNORE learning_links
         SET to_learning_id = ?
         WHERE to_learning_id = ? AND from_learning_id != ?`,
        [strategy.keepId, mergeId, strategy.keepId]
      );
      linksUpdated += updateTo.changes;

      // Update links pointing FROM the merged learning (ignore if creates duplicate)
      const updateFrom = db.run(
        `UPDATE OR IGNORE learning_links
         SET from_learning_id = ?
         WHERE from_learning_id = ? AND to_learning_id != ?`,
        [strategy.keepId, mergeId, strategy.keepId]
      );
      linksUpdated += updateFrom.changes;

      // Remove self-links (where both from and to are now keepId)
      db.run(
        `DELETE FROM learning_links WHERE from_learning_id = ? AND to_learning_id = ?`,
        [strategy.keepId, strategy.keepId]
      );

      // Remove orphaned links that couldn't be updated (still point to merged learning)
      db.run(
        `DELETE FROM learning_links WHERE from_learning_id = ? OR to_learning_id = ?`,
        [mergeId, mergeId]
      );
    }

    // 3. Update entity links
    for (const mergeId of strategy.mergeIds) {
      db.run(
        `UPDATE OR IGNORE learning_entities
         SET learning_id = ?
         WHERE learning_id = ?`,
        [strategy.keepId, mergeId]
      );
      // Delete any that couldn't be updated (duplicates)
      db.run(
        `DELETE FROM learning_entities WHERE learning_id = ?`,
        [mergeId]
      );
    }

    // 4. Delete merged learnings from SQLite
    for (const mergeId of strategy.mergeIds) {
      db.run(`DELETE FROM learnings WHERE id = ?`, [mergeId]);
    }

    // 5. Update ChromaDB - delete old embeddings and re-embed primary
    const primaryLearning = getLearningById(strategy.keepId);
    if (primaryLearning) {
      try {
        const client = new ChromaClient();
        const collection = await client.getCollection({ name: 'orchestrator_learnings' });

        // Delete old embeddings for merged learnings
        const idsToDelete = strategy.mergeIds.map(id => String(id));
        if (idsToDelete.length > 0) {
          await collection.delete({ ids: idsToDelete });
        }

        // Re-embed primary with updated content
        await saveLearning(
          strategy.keepId,
          primaryLearning.title,
          primaryLearning.description || primaryLearning.lesson || '',
          {
            category: primaryLearning.category,
            confidence: strategy.combinedConfidence,
            source_session_id: primaryLearning.source_session_id || '',
            created_at: primaryLearning.created_at || new Date().toISOString(),
            agent_id: primaryLearning.agent_id,
            visibility: primaryLearning.visibility || 'public',
          }
        );
      } catch (chromaError) {
        console.error('ChromaDB update failed:', chromaError);
        // Continue - SQLite is source of truth
      }
    }

    return {
      keptId: strategy.keepId,
      mergedCount: strategy.mergeIds.length,
      linksUpdated,
    };
  } finally {
    db.close();
  }
}

/**
 * Run full consolidation process
 */
export async function runConsolidation(options?: {
  dryRun?: boolean;
  minSimilarity?: number;
  category?: string;
  limit?: number;
}): Promise<ConsolidationStats> {
  const { dryRun = true, minSimilarity = 0.90, category, limit = 10 } = options || {};

  const stats: ConsolidationStats = {
    candidatesFound: 0,
    totalDuplicates: 0,
    merged: 0,
    errors: [],
  };

  // Find candidates
  const candidates = await findConsolidationCandidates({
    minSimilarity,
    category,
    limit,
  });

  stats.candidatesFound = candidates.length;
  stats.totalDuplicates = candidates.reduce((sum, c) => sum + c.duplicates.length, 0);

  if (dryRun) {
    console.log('\n=== DRY RUN - No changes made ===\n');
    for (const candidate of candidates) {
      console.log(`Primary: #${candidate.primary.id} "${candidate.primary.title}"`);
      console.log(`  Duplicates (${candidate.duplicates.length}):`);
      for (const dup of candidate.duplicates) {
        console.log(`    - #${dup.id} "${dup.title}" (${dup.confidence})`);
      }
      console.log(`  Avg similarity: ${(candidate.avgSimilarity * 100).toFixed(1)}%\n`);
    }
    return stats;
  }

  // Execute consolidations
  for (const candidate of candidates) {
    try {
      const strategy = calculateMergeStrategy(candidate.primary, candidate.duplicates);
      const result = await consolidateLearnings(strategy);
      stats.merged += result.mergedCount;
      console.log(
        `Merged ${result.mergedCount} learnings into #${result.keptId} (${result.linksUpdated} links updated)`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      stats.errors.push(`Failed to consolidate #${candidate.primary.id}: ${msg}`);
    }
  }

  return stats;
}

export default {
  findConsolidationCandidates,
  calculateMergeStrategy,
  consolidateLearnings,
  runConsolidation,
};
