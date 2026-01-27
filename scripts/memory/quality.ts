#!/usr/bin/env bun
/**
 * Memory Quality - Score all learnings using the quality scorer
 *
 * Usage:
 *   bun memory quality                 - Score all learnings
 *   bun memory quality --min 0.5       - Show only learnings with score >= 0.5
 *   bun memory quality --sort          - Sort by score descending
 *   bun memory quality --smart         - Use LLM for scoring (costs API)
 *   bun memory quality --limit 20      - Score only N learnings
 */

import { listLearningsFromDb, type LearningRecord } from '../../src/db';
import { QualityScorer, type QualityScore } from '../../src/learning/quality-scorer';

const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const useSmartMode = args.includes('--smart');
const sortByScore = args.includes('--sort');

// Parse --min value
const minIndex = args.findIndex(a => a === '--min');
const minScore = minIndex >= 0 ? parseFloat(args[minIndex + 1] || '0') : 0;

// Parse --limit value
const limitIndex = args.findIndex(a => a === '--limit');
const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1] || '100', 10) : 100;

if (showHelp) {
  console.log(`
  Memory Quality - Score learnings by quality

  USAGE
    bun memory quality [options]

  OPTIONS
    --min <score>   Only show learnings with score >= value (0-1)
    --sort          Sort by score descending
    --smart         Use LLM for scoring (costs API tokens)
    --limit <n>     Score only N learnings (default: 100)
    -h, --help      Show this help

  QUALITY DIMENSIONS
    Specificity     How specific vs generic (0-1)
    Actionability   Can someone act on this? (0-1)
    Evidence        Supporting data/metrics (0-1)
    Novelty         New insight vs common knowledge (0-1)

  EXAMPLES
    bun memory quality                  # Score all learnings
    bun memory quality --min 0.7        # Show high-quality learnings only
    bun memory quality --sort --limit 10 # Top 10 by score
`);
  process.exit(0);
}

interface ScoredLearning {
  learning: LearningRecord;
  score: QualityScore;
}

async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  LEARNING QUALITY ANALYSIS');
  console.log('════════════════════════════════════════════════════════════');
  console.log();

  // Initialize scorer
  const scorer = new QualityScorer({
    enableLLM: useSmartMode,
  });

  if (useSmartMode) {
    console.log('  Mode: Smart (LLM-assisted scoring)');
  } else {
    console.log('  Mode: Heuristic (fast, no API cost)');
  }
  console.log();

  // Get learnings
  const learnings = listLearningsFromDb({ limit });

  if (learnings.length === 0) {
    console.log('  No learnings found.');
    console.log('  Add learnings with: bun memory learn <category> "title"');
    process.exit(0);
  }

  console.log(`  Scoring ${learnings.length} learnings...`);
  console.log();

  // Score each learning
  const scored: ScoredLearning[] = [];

  for (let i = 0; i < learnings.length; i++) {
    const learning = learnings[i]!;
    const score = await scorer.scoreLearning(learning);

    if (score.overall >= minScore) {
      scored.push({ learning, score });
    }

    // Progress indicator
    if ((i + 1) % 10 === 0 || i === learnings.length - 1) {
      process.stdout.write(`\r  Scored: ${i + 1}/${learnings.length}`);
    }
  }

  console.log('\n');

  // Sort if requested
  if (sortByScore) {
    scored.sort((a, b) => b.score.overall - a.score.overall);
  }

  if (scored.length === 0) {
    console.log(`  No learnings found with score >= ${minScore}`);
    process.exit(0);
  }

  // Display results
  console.log('─'.repeat(60));
  console.log('  RESULTS');
  console.log('─'.repeat(60));
  console.log();

  for (const { learning, score } of scored.slice(0, 50)) {
    const bar = '█'.repeat(Math.round(score.overall * 10));
    const spaces = ' '.repeat(10 - Math.round(score.overall * 10));

    console.log(`  #${learning.id} ${learning.title.slice(0, 40).padEnd(40)}`);
    console.log(`     [${bar}${spaces}] ${(score.overall * 100).toFixed(0)}%`);
    console.log(`     S:${(score.specificity * 10).toFixed(0)} A:${(score.actionability * 10).toFixed(0)} E:${(score.evidence * 10).toFixed(0)} N:${(score.novelty * 10).toFixed(0)}`);
    if (score.reasoning) {
      console.log(`     ${score.reasoning.slice(0, 55)}...`);
    }
    console.log();
  }

  // Summary statistics
  console.log('─'.repeat(60));
  console.log('  SUMMARY');
  console.log('─'.repeat(60));
  console.log();

  const avgScore = scored.reduce((sum, s) => sum + s.score.overall, 0) / scored.length;
  const highQuality = scored.filter(s => s.score.overall >= 0.7).length;
  const mediumQuality = scored.filter(s => s.score.overall >= 0.4 && s.score.overall < 0.7).length;
  const lowQuality = scored.filter(s => s.score.overall < 0.4).length;

  console.log(`  Total scored:   ${scored.length}`);
  console.log(`  Average score:  ${(avgScore * 100).toFixed(1)}%`);
  console.log();
  console.log(`  High quality (≥70%):    ${highQuality}`);
  console.log(`  Medium quality (40-70%): ${mediumQuality}`);
  console.log(`  Low quality (<40%):     ${lowQuality}`);
  console.log();

  // Recommendations
  if (lowQuality > highQuality) {
    console.log('  ⚠️  Many low-quality learnings. Consider:');
    console.log('     - Adding more specific context');
    console.log('     - Including metrics and evidence');
    console.log('     - Focusing on actionable insights');
  } else if (highQuality > scored.length / 2) {
    console.log('  ✅ Good quality distribution!');
  }
}

main().catch(console.error);
