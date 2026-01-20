#!/usr/bin/env bun
/**
 * Search Validation Runner
 *
 * Runs validation tests, records feedback, and recommends weight adjustments.
 * This creates a negative feedback loop for continuous improvement.
 *
 * Usage:
 *   bun scripts/memory/validate-search.ts           # Run validation
 *   bun scripts/memory/validate-search.ts metrics   # Show metrics
 *   bun scripts/memory/validate-search.ts recommend # Get weight recommendations
 *   bun scripts/memory/validate-search.ts problems  # Show problematic queries
 */

import { searchLearnings, initVectorDB } from '../../src/vector-db';
import { searchLearningsFTS } from '../../src/db';
import { hybridSearchLearnings } from '../../src/services/recall-service';
import {
  runValidationTests,
  calculateSearchMetrics,
  recommendWeights,
  getProblematicQueries,
  getRecentFeedback,
  recordValidationResult,
} from '../../src/learning/search-validation';

// Test cases for validation
// These are query -> expected learning ID pairs for measuring search quality
const VALIDATION_CASES = [
  { query: 'typography guidelines', expectedId: 1551 },
  { query: 'frontend design', expectedId: 1551 },
  { query: 'bold aesthetic direction', expectedId: 1551 },
  { query: 'git worktree parallel', expectedId: 306 },
  { query: 'MCP server restart', expectedId: 1545 },
  { query: 'sessions ephemeral learnings persistent', expectedId: 129 },
  { query: 'ChromaDB vector embedding', expectedId: 1243 },
  { query: 'spawn script path', expectedId: 260 },
];

// ANSI colors
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function searchAdapter(query: string, type: 'vector' | 'fts' | 'hybrid'): Promise<number[]> {
  if (type === 'vector') {
    const results = await searchLearnings(query, { limit: 10 });
    const ids = results.ids[0] || [];
    // Dedupe chunks to parent IDs
    const seen = new Set<number>();
    return ids.map(id => parseInt(String(id).split('_chunk_')[0]))
      .filter(id => !isNaN(id) && !seen.has(id) && seen.add(id));
  }

  if (type === 'fts') {
    const results = searchLearningsFTS(query, 10);
    return results.map(r => r.id!);
  }

  // Hybrid
  const results = await hybridSearchLearnings(query, { limit: 10 });
  return results.map(r => r.id);
}

async function runValidation() {
  console.log('\n' + '═'.repeat(60));
  console.log(bold('  SEARCH VALIDATION'));
  console.log('═'.repeat(60));

  await initVectorDB();
  console.log(green('  ✓ Initialized\n'));

  console.log(dim('Running validation tests...\n'));

  const results = await runValidationTests(VALIDATION_CASES, searchAdapter);

  console.log(bold('  Results:'));
  console.log();

  const total = VALIDATION_CASES.length;

  // Vector
  const vecPass = results.vector.passed;
  const vecIcon = vecPass === total ? green('✓') : vecPass > total/2 ? yellow('~') : red('✗');
  console.log(`  ${vecIcon} Vector:  ${vecPass}/${total} passed  MRR: ${results.vector.mrr.toFixed(3)}`);

  // FTS
  const ftsPass = results.fts.passed;
  const ftsIcon = ftsPass === total ? green('✓') : ftsPass > total/2 ? yellow('~') : red('✗');
  console.log(`  ${ftsIcon} FTS:     ${ftsPass}/${total} passed  MRR: ${results.fts.mrr.toFixed(3)}`);

  // Hybrid
  const hybridPass = results.hybrid.passed;
  const hybridIcon = hybridPass === total ? green('✓') : hybridPass > total/2 ? yellow('~') : red('✗');
  console.log(`  ${hybridIcon} Hybrid:  ${hybridPass}/${total} passed  MRR: ${results.hybrid.mrr.toFixed(3)}`);

  console.log();

  // Show which tests failed
  const failures: string[] = [];
  for (const testCase of VALIDATION_CASES) {
    const hybridResults = await searchAdapter(testCase.query, 'hybrid');
    if (!hybridResults.slice(0, 5).includes(testCase.expectedId)) {
      failures.push(`  - "${testCase.query}" → expected #${testCase.expectedId}`);
    }
  }

  if (failures.length > 0) {
    console.log(yellow('  Failed tests (hybrid):'));
    failures.forEach(f => console.log(f));
    console.log();
  }

  // Get recommendation
  const rec = recommendWeights();
  console.log(bold('  Weight Recommendation:'));
  console.log(`    Current:     vector=${rec.current_vector_weight}, keyword=${rec.current_keyword_weight}`);
  console.log(`    Recommended: vector=${rec.recommended_vector_weight}, keyword=${rec.recommended_keyword_weight}`);
  console.log(`    Confidence:  ${(rec.confidence * 100).toFixed(0)}%`);
  console.log(`    Reason:      ${rec.reason}`);
  console.log();
}

function showMetrics() {
  console.log('\n' + '═'.repeat(60));
  console.log(bold('  SEARCH METRICS'));
  console.log('═'.repeat(60));

  const metrics = calculateSearchMetrics();

  console.log();
  console.log(bold('  Overall:'));
  console.log(`    Total searches:  ${metrics.total_searches}`);
  console.log(`    Relevant:        ${metrics.relevant_count} (${(metrics.precision * 100).toFixed(1)}% precision)`);
  console.log(`    Misses:          ${metrics.miss_count} (${((1 - metrics.recall_estimate) * 100).toFixed(1)}% miss rate)`);
  console.log(`    MRR:             ${metrics.mrr.toFixed(3)}`);
  console.log(`    Avg latency:     ${metrics.avg_latency_ms.toFixed(0)}ms`);
  console.log();

  console.log(bold('  By Search Type:'));
  for (const [type, data] of Object.entries(metrics.by_type)) {
    if (data.count > 0) {
      console.log(`    ${type}: ${data.count} searches, precision=${(data.precision * 100).toFixed(1)}%, MRR=${data.mrr.toFixed(3)}`);
    }
  }
  console.log();
}

function showRecommendation() {
  console.log('\n' + '═'.repeat(60));
  console.log(bold('  WEIGHT RECOMMENDATION'));
  console.log('═'.repeat(60));

  const rec = recommendWeights();

  console.log();
  console.log(`  Current weights:`);
  console.log(`    Vector:  ${rec.current_vector_weight}`);
  console.log(`    Keyword: ${rec.current_keyword_weight}`);
  console.log();
  console.log(`  Recommended weights:`);
  console.log(`    Vector:  ${rec.recommended_vector_weight}`);
  console.log(`    Keyword: ${rec.recommended_keyword_weight}`);
  console.log();
  console.log(`  Confidence: ${(rec.confidence * 100).toFixed(0)}%`);
  console.log(`  Reason: ${rec.reason}`);
  console.log();

  if (Math.abs(rec.recommended_vector_weight - rec.current_vector_weight) > 0.05) {
    console.log(yellow('  Action: Update weights in src/services/recall-service.ts'));
    console.log(`    vectorWeight: ${rec.recommended_vector_weight},`);
    console.log(`    keywordWeight: ${rec.recommended_keyword_weight},`);
  } else {
    console.log(green('  ✓ Current weights are optimal'));
  }
  console.log();
}

function showProblems() {
  console.log('\n' + '═'.repeat(60));
  console.log(bold('  PROBLEMATIC QUERIES'));
  console.log('═'.repeat(60));

  const problems = getProblematicQueries(1);

  if (problems.length === 0) {
    console.log(green('\n  ✓ No problematic queries found\n'));
    return;
  }

  console.log();
  for (const p of problems) {
    console.log(`  ${red('✗')} "${p.query}"`);
    console.log(`    Missed ${p.miss_count} times, last: ${p.last_miss}`);
  }
  console.log();

  console.log(dim('  These queries consistently fail to find expected results.'));
  console.log(dim('  Consider adding learnings or improving content for these topics.\n'));
}

// Main
const command = process.argv[2];

async function main() {
  switch (command) {
    case 'metrics':
      showMetrics();
      break;
    case 'recommend':
      showRecommendation();
      break;
    case 'problems':
      showProblems();
      break;
    default:
      await runValidation();
  }
}

main().catch(console.error);
