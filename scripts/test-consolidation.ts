/**
 * Test script for memory consolidation
 */
import { runConsolidation } from '../src/learning/consolidation';

async function main() {
  console.log('=== Memory Consolidation Test ===\n');

  console.log('Running consolidation (dry-run)...\n');
  const stats = await runConsolidation({
    dryRun: true,
    minSimilarity: 0.85,
    limit: 15
  });

  console.log('\n=== Final Stats ===');
  console.log(`Candidates found: ${stats.candidatesFound}`);
  console.log(`Total duplicates: ${stats.totalDuplicates}`);
  console.log(`Merged: ${stats.merged}`);
  if (stats.errors.length > 0) {
    console.log(`Errors: ${stats.errors.join(', ')}`);
  }
}

main().catch(console.error);
