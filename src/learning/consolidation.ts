/**
 * Memory Consolidation Engine
 * Finds and merges duplicate learnings to reduce noise and maintain single source of truth
 *
 * Two modes:
 * 1. Simple mode: Uses semantic similarity threshold (fast, no API cost)
 * 2. Smart mode: Uses Claude Sonnet to reason about duplicates (higher quality)
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
import { ExternalLLM, type LLMProvider } from '../services/external-llm';

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

// Smart deduplication types
export interface SmartDeduplicationResult {
  keep: LearningRecord;
  merge: LearningRecord[];
  reasoning: string;
  mergedContent: string;  // Combined best parts
  isDuplicate: boolean;   // LLM confirmed these are duplicates
}

export interface SmartDeduplicationConfig {
  provider: LLMProvider;
  model?: string;
  enableLLM: boolean;
}

const DEFAULT_SMART_DEDUP_CONFIG: SmartDeduplicationConfig = {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  enableLLM: true,
};

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
        const url = process.env.CHROMA_URL || 'http://localhost:8100';
        const parsed = new URL(url);
        const client = new ChromaClient({
          host: parsed.hostname,
          port: parseInt(parsed.port) || 8100,
        });
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

// ============ Smart Deduplication (Sonnet-based) ============

/**
 * Use LLM to determine if learnings are truly duplicates
 * and merge their best content
 */
export async function smartDeduplicate(
  primary: LearningRecord,
  candidates: LearningRecord[],
  config: Partial<SmartDeduplicationConfig> = {}
): Promise<SmartDeduplicationResult> {
  const mergedConfig = { ...DEFAULT_SMART_DEDUP_CONFIG, ...config };

  // If LLM disabled or no candidates, return primary as-is
  if (!mergedConfig.enableLLM || candidates.length === 0) {
    return {
      keep: primary,
      merge: [],
      reasoning: 'No LLM or no candidates',
      mergedContent: primary.description || primary.lesson || '',
      isDuplicate: false,
    };
  }

  let llm: ExternalLLM;
  try {
    llm = new ExternalLLM(mergedConfig.provider);
  } catch (error) {
    console.error(`[SmartDedup] LLM init failed: ${error}`);
    return {
      keep: primary,
      merge: [],
      reasoning: 'LLM unavailable',
      mergedContent: primary.description || primary.lesson || '',
      isDuplicate: false,
    };
  }

  const prompt = buildDeduplicationPrompt(primary, candidates);

  try {
    const response = await llm.query(prompt, {
      model: mergedConfig.model,
      maxOutputTokens: 2048,
      temperature: 0.3,
    });

    return parseDeduplicationResponse(response.text, primary, candidates);
  } catch (error) {
    console.error(`[SmartDedup] LLM query failed: ${error}`);
    return {
      keep: primary,
      merge: [],
      reasoning: `LLM error: ${error}`,
      mergedContent: primary.description || primary.lesson || '',
      isDuplicate: false,
    };
  }
}

/**
 * Build prompt for LLM deduplication analysis
 */
function buildDeduplicationPrompt(
  primary: LearningRecord,
  candidates: LearningRecord[]
): string {
  const candidateText = candidates.map((c, i) => `
### Candidate ${i + 1} (ID: ${c.id})
Title: ${c.title}
Category: ${c.category}
Content: ${c.description || c.lesson || ''}
Confidence: ${c.confidence}
Validated: ${c.times_validated || 0} times`).join('\n');

  return `Analyze whether these learnings are duplicates and should be merged.

## Primary Learning (ID: ${primary.id})
Title: ${primary.title}
Category: ${primary.category}
Content: ${primary.description || primary.lesson || ''}
Confidence: ${primary.confidence}
Validated: ${primary.times_validated || 0} times

## Candidate Duplicates
${candidateText}

## Analysis Tasks

1. **Determine duplicates**: Are any candidates saying the same thing as the primary?
   - TRUE duplicate: Same core insight, just different wording
   - FALSE duplicate: Related but distinct insights (should NOT merge)

2. **Select best version**: Which has the clearest, most complete explanation?

3. **Merge content**: Combine unique valuable parts from all true duplicates.

Respond in this exact JSON format:
{
  "isDuplicate": [true/false for each candidate],
  "keepId": ID of the best version to keep,
  "mergeIds": [IDs of learnings to merge into the kept one],
  "mergedContent": "Combined best explanation (keep unique valuable parts from each)",
  "reasoning": "Brief explanation of the decision"
}

Be conservative - only mark as duplicate if they're truly redundant.`;
}

/**
 * Parse LLM response into deduplication result
 */
function parseDeduplicationResponse(
  response: string,
  primary: LearningRecord,
  candidates: LearningRecord[]
): SmartDeduplicationResult {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const allLearnings = [primary, ...candidates];

    // Find the learning to keep
    const keepId = typeof parsed.keepId === 'number' ? parsed.keepId : primary.id;
    const keepLearning = allLearnings.find(l => l.id === keepId) || primary;

    // Find learnings to merge
    const mergeIds: number[] = Array.isArray(parsed.mergeIds) ? parsed.mergeIds : [];
    const mergeLearnings = allLearnings.filter(l => mergeIds.includes(l.id!));

    // Check if any duplicates were found
    const isDuplicate = Array.isArray(parsed.isDuplicate)
      ? parsed.isDuplicate.some((d: boolean) => d)
      : mergeIds.length > 0;

    return {
      keep: keepLearning,
      merge: mergeLearnings,
      reasoning: parsed.reasoning || 'LLM decision',
      mergedContent: parsed.mergedContent || keepLearning.description || keepLearning.lesson || '',
      isDuplicate,
    };
  } catch (error) {
    console.error(`[SmartDedup] Parse error: ${error}`);
    return {
      keep: primary,
      merge: [],
      reasoning: `Parse error: ${error}`,
      mergedContent: primary.description || primary.lesson || '',
      isDuplicate: false,
    };
  }
}

/**
 * Run smart consolidation using LLM
 */
export async function runSmartConsolidation(options?: {
  dryRun?: boolean;
  minSimilarity?: number;
  category?: string;
  limit?: number;
  llmConfig?: Partial<SmartDeduplicationConfig>;
}): Promise<ConsolidationStats> {
  const {
    dryRun = true,
    minSimilarity = 0.85,  // Lower threshold since LLM will verify
    category,
    limit = 10,
    llmConfig = {},
  } = options || {};

  const stats: ConsolidationStats = {
    candidatesFound: 0,
    totalDuplicates: 0,
    merged: 0,
    errors: [],
  };

  // Find candidates using similarity search
  const candidates = await findConsolidationCandidates({
    minSimilarity,
    category,
    limit,
  });

  stats.candidatesFound = candidates.length;

  if (dryRun) {
    console.log('\n=== SMART DEDUP DRY RUN ===\n');
  }

  for (const candidate of candidates) {
    try {
      // Use LLM to verify and merge
      const result = await smartDeduplicate(
        candidate.primary,
        candidate.duplicates,
        llmConfig
      );

      if (result.isDuplicate && result.merge.length > 0) {
        stats.totalDuplicates += result.merge.length;

        if (dryRun) {
          console.log(`Primary: #${candidate.primary.id} "${candidate.primary.title}"`);
          console.log(`  LLM says: ${result.isDuplicate ? 'DUPLICATE' : 'NOT duplicate'}`);
          console.log(`  Keep: #${result.keep.id}`);
          console.log(`  Merge: ${result.merge.map(m => `#${m.id}`).join(', ')}`);
          console.log(`  Reasoning: ${result.reasoning}`);
          console.log(`  Merged content: ${result.mergedContent.slice(0, 100)}...`);
          console.log('');
        } else {
          // Execute merge
          const strategy = calculateMergeStrategy(result.keep, result.merge);
          strategy.mergedDescription = result.mergedContent;
          const mergeResult = await consolidateLearnings(strategy);
          stats.merged += mergeResult.mergedCount;
          console.log(
            `Merged ${mergeResult.mergedCount} learnings into #${mergeResult.keptId} (${result.reasoning})`
          );
        }
      } else if (dryRun) {
        console.log(`Primary: #${candidate.primary.id} - LLM says NOT a duplicate`);
        console.log(`  Reasoning: ${result.reasoning}`);
        console.log('');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      stats.errors.push(`Smart dedup failed for #${candidate.primary.id}: ${msg}`);
    }
  }

  return stats;
}

export default {
  findConsolidationCandidates,
  calculateMergeStrategy,
  consolidateLearnings,
  runConsolidation,
  smartDeduplicate,
  runSmartConsolidation,
};
