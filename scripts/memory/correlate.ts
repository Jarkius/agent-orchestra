#!/usr/bin/env bun
/**
 * Memory Correlate - Link learnings to code files
 *
 * Usage:
 *   bun memory correlate                - Correlate all learnings with code
 *   bun memory correlate --smart        - Use LLM for better correlation
 *   bun memory correlate --dry-run      - Show what would be linked
 *   bun memory correlate --file <path>  - Find learnings for specific file
 *   bun memory correlate --learning <id> - Find code for specific learning
 */

import {
  CodeCorrelator,
  correlateAllLearnings,
  getCorrelationSummary,
  findLearningsForCode,
  findCodeForLearning,
} from '../../src/learning/code-correlation';
import { getLearningById, listLearningsFromDb } from '../../src/db';

const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const useSmartMode = args.includes('--smart');
const dryRun = args.includes('--dry-run');

// Parse --file value
const fileIndex = args.findIndex(a => a === '--file');
const filePath = fileIndex >= 0 ? args[fileIndex + 1] : null;

// Parse --learning value
const learningIndex = args.findIndex(a => a === '--learning');
const learningId = learningIndex >= 0 ? parseInt(args[learningIndex + 1] || '0', 10) : 0;

// Parse --limit value
const limitIndex = args.findIndex(a => a === '--limit');
const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1] || '50', 10) : 50;

if (showHelp) {
  console.log(`
  Memory Correlate - Link learnings to code files

  USAGE
    bun memory correlate [options]

  OPTIONS
    --smart            Use LLM for better correlation (costs API)
    --dry-run          Show what would be linked without saving
    --file <path>      Find learnings related to a file
    --learning <id>    Find code files related to a learning
    --limit <n>        Process only N learnings (default: 50)
    -h, --help         Show this help

  LINK TYPES
    derived_from       Learning was created by analyzing this code
    applies_to         Learning can be applied to improve this code
    example_in         This code demonstrates the learning
    pattern_match      This code follows the pattern in the learning

  EXAMPLES
    bun memory correlate                     # Correlate all
    bun memory correlate --dry-run           # Preview links
    bun memory correlate --file src/db.ts    # Learnings for file
    bun memory correlate --learning 42       # Code for learning #42
`);
  process.exit(0);
}

async function showFileCorrelations(path: string) {
  console.log('─'.repeat(60));
  console.log(`  LEARNINGS FOR: ${path}`);
  console.log('─'.repeat(60));
  console.log();

  const learnings = findLearningsForCode(path, { limit: 10 });

  if (learnings.length === 0) {
    console.log('  No learnings linked to this file.');
    console.log('  Run "bun memory correlate" to create links.');
    return;
  }

  for (const learning of learnings) {
    const relevance = Math.round(learning.relevance_score * 100);
    console.log(`  #${learning.id} [${learning.link_type}] ${relevance}%`);
    console.log(`     ${learning.title.slice(0, 55)}`);
    if (learning.description) {
      console.log(`     ${learning.description.slice(0, 50)}...`);
    }
    console.log();
  }
}

async function showLearningCorrelations(id: number) {
  const learning = getLearningById(id);

  if (!learning) {
    console.log(`  Learning #${id} not found.`);
    process.exit(1);
  }

  console.log('─'.repeat(60));
  console.log(`  CODE FOR LEARNING #${id}`);
  console.log('─'.repeat(60));
  console.log();
  console.log(`  Title: ${learning.title}`);
  console.log(`  Category: ${learning.category}`);
  console.log();

  const files = findCodeForLearning(id, { limit: 10 });

  if (files.length === 0) {
    console.log('  No code files linked to this learning.');
    console.log('  Run "bun memory correlate" to create links.');
    return;
  }

  for (const file of files) {
    const relevance = Math.round(file.relevance_score * 100);
    console.log(`  ${file.path}`);
    console.log(`     [${file.link_type}] ${relevance}% | ${file.language}`);
    console.log();
  }
}

async function correlateAll() {
  console.log('─'.repeat(60));
  console.log('  CORRELATING LEARNINGS WITH CODE');
  console.log('─'.repeat(60));
  console.log();

  const mode = useSmartMode ? 'Smart (LLM-assisted)' : 'Heuristic';
  console.log(`  Mode: ${mode}`);
  console.log(`  Dry run: ${dryRun ? 'Yes (no changes saved)' : 'No'}`);
  console.log(`  Limit: ${limit} learnings`);
  console.log();

  // Get current stats
  const beforeStats = getCorrelationSummary();
  console.log(`  Before: ${beforeStats.totalLinks} links`);
  console.log();

  // Run correlation
  const correlator = new CodeCorrelator({
    enableLLM: useSmartMode,
    persistLinks: !dryRun,
    maxLearnings: limit,
    minRelevanceScore: 0.5,
  });

  let current = 0;
  const result = await correlator.correlateAll({
    onProgress: (curr, total) => {
      current = curr;
      process.stdout.write(`\r  Processing: ${curr}/${total}`);
    },
  });

  console.log('\n');

  // Show results
  console.log(`  Learnings analyzed: ${result.stats.learningsAnalyzed}`);
  console.log(`  Files analyzed:     ${result.stats.filesAnalyzed}`);
  console.log(`  Links created:      ${result.stats.linksCreated}`);
  console.log(`  Used LLM:           ${result.stats.usedLLM ? 'Yes' : 'No'}`);
  console.log();

  // Show sample matches
  if (result.matches.length > 0) {
    console.log('  SAMPLE CORRELATIONS');
    console.log('  ' + '─'.repeat(56));

    for (const match of result.matches.slice(0, 5)) {
      const relevance = Math.round(match.relevanceScore * 100);
      console.log(`    #${match.learning.id} → ${match.codeFile.path}`);
      console.log(`       [${match.linkType}] ${relevance}%`);
      if (match.reasoning) {
        console.log(`       ${match.reasoning.slice(0, 45)}...`);
      }
      console.log();
    }
  }

  // Final stats
  if (!dryRun) {
    const afterStats = getCorrelationSummary();
    console.log('  SUMMARY');
    console.log('  ' + '─'.repeat(56));
    console.log(`    Total links:       ${afterStats.totalLinks}`);
    console.log(`    Linked learnings:  ${afterStats.linkedLearnings}`);
    console.log(`    Linked files:      ${afterStats.linkedFiles}`);
    console.log();

    if (afterStats.byType && Object.keys(afterStats.byType).length > 0) {
      console.log('    By type:');
      for (const [type, count] of Object.entries(afterStats.byType)) {
        console.log(`      ${type}: ${count}`);
      }
    }
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  LEARNING-CODE CORRELATION');
  console.log('════════════════════════════════════════════════════════════');
  console.log();

  if (filePath) {
    await showFileCorrelations(filePath);
  } else if (learningId) {
    await showLearningCorrelations(learningId);
  } else {
    await correlateAll();
  }
}

main().catch(console.error);
