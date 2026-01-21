#!/usr/bin/env bun
/**
 * /consolidate - Find and merge duplicate learnings
 *
 * Usage:
 *   bun memory consolidate              # Dry run (preview duplicates)
 *   bun memory consolidate --apply      # Execute merges
 *   bun memory consolidate --category insight  # Filter by category
 *   bun memory consolidate --threshold 0.85    # Lower similarity threshold
 *   bun memory consolidate --limit 20   # Process more candidates
 */

import {
  runConsolidation,
  findConsolidationCandidates,
  calculateMergeStrategy,
  type ConsolidationCandidate,
} from '../../src/learning/consolidation';
import { getConfidenceBadge } from '../../src/utils/formatters';

// Parse arguments
const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

const apply = args.includes('--apply');
const category = getArg('category');
const threshold = parseFloat(getArg('threshold') || '0.90');
const limit = parseInt(getArg('limit') || '10');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📚 Memory Consolidate - Reduce duplicate learnings

Usage: bun memory consolidate [options]

Options:
  --apply           Execute merges (default: dry run)
  --category <cat>  Filter by category (insight, pattern, etc.)
  --threshold <n>   Similarity threshold 0.5-1.0 (default: 0.90)
  --limit <n>       Max candidates to process (default: 10)

Examples:
  bun memory consolidate                    # Preview duplicates
  bun memory consolidate --apply            # Merge duplicates
  bun memory consolidate --category insight # Only insight category
  bun memory consolidate --threshold 0.85   # Lower threshold (more matches)
`);
  process.exit(0);
}

async function main() {
  console.log('\n\x1b[1m🔍 Memory Consolidation\x1b[0m\n');
  console.log(`  Mode: ${apply ? '\x1b[33mAPPLY (will merge)\x1b[0m' : '\x1b[36mDRY RUN (preview)\x1b[0m'}`);
  console.log(`  Threshold: ${(threshold * 100).toFixed(0)}% similarity`);
  console.log(`  Limit: ${limit} candidates`);
  if (category) {
    console.log(`  Category: ${category}`);
  }
  console.log('');

  if (apply) {
    // Execute with runConsolidation
    const stats = await runConsolidation({
      dryRun: false,
      minSimilarity: threshold,
      category,
      limit,
    });

    console.log('\n\x1b[1m📊 Results\x1b[0m');
    console.log(`  Candidates found: ${stats.candidatesFound}`);
    console.log(`  Total duplicates: ${stats.totalDuplicates}`);
    console.log(`  \x1b[32mMerged: ${stats.merged}\x1b[0m`);

    if (stats.errors.length > 0) {
      console.log('\n\x1b[31mErrors:\x1b[0m');
      for (const err of stats.errors) {
        console.log(`  - ${err}`);
      }
    }
  } else {
    // Dry run - show detailed preview
    const candidates = await findConsolidationCandidates({
      minSimilarity: threshold,
      category,
      limit,
    });

    if (candidates.length === 0) {
      console.log('\x1b[32m✓ No duplicates found above threshold\x1b[0m\n');
      return;
    }

    console.log(`\x1b[33mFound ${candidates.length} consolidation candidates:\x1b[0m\n`);

    for (const candidate of candidates) {
      const strategy = calculateMergeStrategy(candidate.primary, candidate.duplicates);
      const primaryBadge = getConfidenceBadge(
        candidate.primary.confidence || 'low',
        candidate.primary.times_validated
      );

      console.log(`\x1b[1m${primaryBadge} #${candidate.primary.id}\x1b[0m "${candidate.primary.title}"`);
      console.log(`  \x1b[2m${candidate.primary.category} | ${candidate.avgSimilarity.toFixed(1)}% avg similarity\x1b[0m`);
      console.log(`  Would merge ${candidate.duplicates.length} duplicate(s):`);

      for (const dup of candidate.duplicates) {
        const dupBadge = getConfidenceBadge(dup.confidence || 'low', dup.times_validated);
        console.log(`    ${dupBadge} #${dup.id} "${dup.title}"`);
      }

      console.log(`  \x1b[32m→ Result: ${strategy.combinedConfidence} (${strategy.combinedValidations} validations)\x1b[0m\n`);
    }

    const totalDups = candidates.reduce((sum, c) => sum + c.duplicates.length, 0);
    console.log('─'.repeat(50));
    console.log(`\x1b[1mSummary:\x1b[0m ${candidates.length} groups, ${totalDups} duplicates`);
    console.log(`Run with \x1b[33m--apply\x1b[0m to merge.\n`);
  }
}

main().catch(err => {
  console.error('\x1b[31mError:\x1b[0m', err.message);
  process.exit(1);
});
