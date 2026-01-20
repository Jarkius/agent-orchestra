/**
 * Migration Script: Migrate learnings to dual-collection pattern
 * Routes existing learnings to knowledge/lessons tables based on content classification
 */

import { listLearningsFromDb, createKnowledge, findOrCreateLesson, type LearningRecord } from '../../src/db';
import { classifyContent, type ContentType } from '../../src/learning/content-router';
import { embedKnowledge, embedLesson, isInitialized, initVectorDB } from '../../src/vector-db';

interface MigrationStats {
  total: number;
  toKnowledge: number;
  toLessons: number;
  keptInLearnings: number;
  errors: string[];
}

interface MigrationCandidate {
  learning: LearningRecord;
  classification: {
    type: ContentType;
    confidence: number;
    reason: string;
  };
  action: 'migrate_knowledge' | 'migrate_lesson' | 'keep';
}

/**
 * Analyze learnings and determine migration candidates
 */
export function analyzeMigrations(options?: {
  category?: string;
  limit?: number;
  minConfidenceToKeep?: string;
}): MigrationCandidate[] {
  const { category, limit = 500, minConfidenceToKeep = 'medium' } = options || {};

  const learnings = listLearningsFromDb({ category, limit });
  const candidates: MigrationCandidate[] = [];

  const confidenceOrder: Record<string, number> = {
    proven: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  const keepThreshold = confidenceOrder[minConfidenceToKeep] || 2;

  for (const learning of learnings) {
    const content = `${learning.title} ${learning.description || ''} ${learning.lesson || ''}`;
    const classification = classifyContent(content, {
      category: learning.category,
      title: learning.title,
      hasStructuredFields: !!(learning.what_happened || learning.lesson || learning.prevention),
    });

    // Determine action
    const learningConfidence = confidenceOrder[learning.confidence || 'low'] || 1;
    let action: MigrationCandidate['action'];

    if (learningConfidence >= keepThreshold) {
      // High confidence learnings stay as learnings
      action = 'keep';
    } else if (classification.type === 'knowledge' && classification.confidence > 0.4) {
      action = 'migrate_knowledge';
    } else if (classification.type === 'lesson' && classification.confidence > 0.4) {
      action = 'migrate_lesson';
    } else {
      // Low confidence classification → keep as learning
      action = 'keep';
    }

    candidates.push({
      learning,
      classification,
      action,
    });
  }

  return candidates;
}

/**
 * Execute migration for a single candidate
 */
async function migrateCandidate(candidate: MigrationCandidate): Promise<{ success: boolean; newId?: string; error?: string }> {
  const { learning, action } = candidate;

  try {
    switch (action) {
      case 'migrate_knowledge': {
        const content = learning.description || learning.lesson || learning.title;
        const id = createKnowledge({
          content,
          category: learning.category,
          agent_id: learning.agent_id,
        });

        // Embed in vector DB
        if (isInitialized()) {
          await embedKnowledge(`knowledge_${id}`, content, {
            category: learning.category,
            source_learning_id: learning.id,
          });
        }

        return { success: true, newId: `knowledge_${id}` };
      }

      case 'migrate_lesson': {
        const problem = learning.what_happened || learning.title;
        const solution = learning.lesson || learning.description || '';
        const outcome = learning.prevention || 'Pending verification';

        const id = findOrCreateLesson({
          problem,
          solution,
          outcome,
          category: learning.category,
          confidence: 0.5,
          agent_id: learning.agent_id,
        });

        // Embed in vector DB
        if (isInitialized()) {
          const embedText = `Problem: ${problem}\nSolution: ${solution}\nOutcome: ${outcome}`;
          await embedLesson(`lesson_${id}`, embedText, {
            problem,
            solution,
            outcome,
            category: learning.category,
            source_learning_id: learning.id,
          });
        }

        return { success: true, newId: `lesson_${id}` };
      }

      case 'keep':
      default:
        return { success: true };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run the full migration
 */
export async function runMigration(options?: {
  dryRun?: boolean;
  category?: string;
  limit?: number;
  minConfidenceToKeep?: string;
}): Promise<MigrationStats> {
  const { dryRun = true, category, limit, minConfidenceToKeep } = options || {};

  // Initialize vector DB if needed
  if (!dryRun && !isInitialized()) {
    await initVectorDB();
  }

  const candidates = analyzeMigrations({ category, limit, minConfidenceToKeep });

  const stats: MigrationStats = {
    total: candidates.length,
    toKnowledge: 0,
    toLessons: 0,
    keptInLearnings: 0,
    errors: [],
  };

  if (dryRun) {
    console.log('\n=== DRY RUN - No changes made ===\n');
    console.log(`Analyzed ${candidates.length} learnings:\n`);

    for (const candidate of candidates) {
      const { learning, classification, action } = candidate;
      const symbol = action === 'keep' ? '📘' : action === 'migrate_knowledge' ? '📚' : '📝';

      if (action === 'migrate_knowledge') stats.toKnowledge++;
      else if (action === 'migrate_lesson') stats.toLessons++;
      else stats.keptInLearnings++;

      console.log(`${symbol} #${learning.id} "${learning.title?.slice(0, 50)}..."`);
      console.log(`   Type: ${classification.type} (${(classification.confidence * 100).toFixed(0)}%)`);
      console.log(`   Action: ${action}`);
      console.log(`   Reason: ${classification.reason}\n`);
    }
  } else {
    console.log(`\nMigrating ${candidates.length} learnings...\n`);

    for (const candidate of candidates) {
      const { learning, action } = candidate;

      if (action === 'keep') {
        stats.keptInLearnings++;
        continue;
      }

      const result = await migrateCandidate(candidate);

      if (result.success) {
        if (action === 'migrate_knowledge') {
          stats.toKnowledge++;
          console.log(`✓ #${learning.id} → ${result.newId}`);
        } else if (action === 'migrate_lesson') {
          stats.toLessons++;
          console.log(`✓ #${learning.id} → ${result.newId}`);
        }
      } else {
        stats.errors.push(`#${learning.id}: ${result.error}`);
        console.log(`✗ #${learning.id}: ${result.error}`);
      }
    }
  }

  // Print summary
  console.log('\n=== Migration Summary ===');
  console.log(`Total analyzed: ${stats.total}`);
  console.log(`To knowledge:   ${stats.toKnowledge}`);
  console.log(`To lessons:     ${stats.toLessons}`);
  console.log(`Kept as learning: ${stats.keptInLearnings}`);
  if (stats.errors.length > 0) {
    console.log(`Errors: ${stats.errors.length}`);
  }

  return stats;
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const category = args.find(a => a.startsWith('--category='))?.split('=')[1];
  const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg) : undefined;

  console.log('Memory System Migration: Learnings → Dual Collection');
  console.log('====================================================');

  if (dryRun) {
    console.log('Running in DRY RUN mode. Use --execute to apply changes.\n');
  }

  await runMigration({ dryRun, category, limit });
}

// Run if called directly
if (import.meta.main) {
  main().catch(console.error);
}

// migrateCandidate exported for testing
export { migrateCandidate };
