#!/usr/bin/env bun
/**
 * Search Evaluation Script
 * Compares vector-only, FTS-only, and hybrid search approaches
 *
 * Usage: bun scripts/memory/evaluate-search.ts
 */

import { searchLearnings, initVectorDB } from '../../src/vector-db';
import { searchLearningsFTS, getLearningById } from '../../src/db';
import { hybridSearchLearnings } from '../../src/services/recall-service';

// Test cases: query -> expected learning IDs that should be in top results
const TEST_CASES: Array<{
  query: string;
  expectedIds: number[];
  description: string;
}> = [
  {
    query: 'typography guidelines',
    expectedIds: [1551],
    description: 'Exact keyword match in frontend-design SKILL',
  },
  {
    query: 'frontend design',
    expectedIds: [1551],
    description: 'Topic match for frontend-design learning',
  },
  {
    query: 'bold aesthetic direction',
    expectedIds: [1551],
    description: 'Phrase from frontend-design content',
  },
  {
    query: 'git worktree isolation',
    expectedIds: [346],
    description: 'Git worktree pattern',
  },
  {
    query: 'vector database embedding',
    expectedIds: [], // General concept - check if results are relevant
    description: 'Semantic concept search',
  },
  {
    query: 'ChromaDB compaction error',
    expectedIds: [], // Should find debugging learnings
    description: 'Error-related search',
  },
  {
    query: 'session persistence',
    expectedIds: [],
    description: 'Architecture concept',
  },
  {
    query: 'MCP server restart',
    expectedIds: [1545],
    description: 'Specific insight about MCP',
  },
];

interface SearchResult {
  id: number;
  score: number;
  title?: string;
}

// ANSI colors
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function vectorSearch(query: string, limit: number): Promise<SearchResult[]> {
  const results = await searchLearnings(query, { limit });
  const ids = results.ids[0] || [];
  const distances = results.distances?.[0] || [];

  return ids.map((id, i) => {
    const numId = parseInt(String(id).split('_chunk_')[0]);
    return {
      id: numId,
      score: 1 - (distances[i] || 0),
    };
  }).filter((r, i, arr) => arr.findIndex(x => x.id === r.id) === i); // Dedupe
}

function ftsSearch(query: string, limit: number): SearchResult[] {
  const results = searchLearningsFTS(query, limit);
  return results.map((r, i) => ({
    id: r.id!,
    score: 1 - (i / Math.max(results.length, 1)), // Rank-based score
    title: r.title,
  }));
}

async function runHybridSearch(query: string, limit: number): Promise<SearchResult[]> {
  const results = await hybridSearchLearnings(query, { limit });
  return results.map(r => ({
    id: r.id,
    score: r.score,
  }));
}

function calculateMetrics(
  results: SearchResult[],
  expectedIds: number[],
  k: number = 5
): { found: boolean; rank: number | null; precision: number; reciprocalRank: number } {
  const topK = results.slice(0, k);
  const topKIds = topK.map(r => r.id);

  // Check if any expected ID is in top K
  const foundId = expectedIds.find(id => topKIds.includes(id));
  const found = foundId !== undefined;

  // Rank of first expected ID (1-indexed)
  const rank = found ? topKIds.indexOf(foundId!) + 1 : null;

  // Precision@K (how many expected IDs in top K / expected count)
  const relevantInTopK = expectedIds.filter(id => topKIds.includes(id)).length;
  const precision = expectedIds.length > 0 ? relevantInTopK / expectedIds.length : 0;

  // Mean Reciprocal Rank
  const reciprocalRank = rank ? 1 / rank : 0;

  return { found, rank, precision, reciprocalRank };
}

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log(bold('  SEARCH EVALUATION'));
  console.log('═'.repeat(70));

  // Initialize
  await initVectorDB();
  console.log(green('  ✓ Vector DB initialized\n'));

  const K = 5; // Top K results to consider

  // Aggregate metrics
  const metrics = {
    vector: { found: 0, totalRR: 0, count: 0 },
    fts: { found: 0, totalRR: 0, count: 0 },
    hybrid: { found: 0, totalRR: 0, count: 0 },
  };

  // Track timing
  const timing = {
    vector: 0,
    fts: 0,
    hybrid: 0,
  };

  for (const testCase of TEST_CASES) {
    console.log(dim('─'.repeat(70)));
    console.log(cyan(`Query: "${testCase.query}"`));
    console.log(dim(testCase.description));
    if (testCase.expectedIds.length > 0) {
      console.log(dim(`Expected: #${testCase.expectedIds.join(', #')}`));
    }
    console.log();

    // Vector search
    const vecStart = performance.now();
    const vectorResults = await vectorSearch(testCase.query, K * 2);
    timing.vector += performance.now() - vecStart;

    // FTS search
    const ftsStart = performance.now();
    const ftsResults = ftsSearch(testCase.query, K * 2);
    timing.fts += performance.now() - ftsStart;

    // Hybrid search
    const hybridStart = performance.now();
    const hybridResults = await runHybridSearch(testCase.query, K * 2);
    timing.hybrid += performance.now() - hybridStart;

    // Calculate metrics (only for cases with expected IDs)
    if (testCase.expectedIds.length > 0) {
      const vecMetrics = calculateMetrics(vectorResults, testCase.expectedIds, K);
      const ftsMetrics = calculateMetrics(ftsResults, testCase.expectedIds, K);
      const hybridMetrics = calculateMetrics(hybridResults, testCase.expectedIds, K);

      metrics.vector.found += vecMetrics.found ? 1 : 0;
      metrics.vector.totalRR += vecMetrics.reciprocalRank;
      metrics.vector.count++;

      metrics.fts.found += ftsMetrics.found ? 1 : 0;
      metrics.fts.totalRR += ftsMetrics.reciprocalRank;
      metrics.fts.count++;

      metrics.hybrid.found += hybridMetrics.found ? 1 : 0;
      metrics.hybrid.totalRR += hybridMetrics.reciprocalRank;
      metrics.hybrid.count++;

      // Display comparison
      console.log('  ' + bold('Vector-Only:'));
      console.log(`    ${vecMetrics.found ? green('✓ Found') : red('✗ Not found')} at rank ${vecMetrics.rank || '-'}  (RR: ${vecMetrics.reciprocalRank.toFixed(2)})`);
      console.log(`    Top: ${vectorResults.slice(0, 3).map(r => `#${r.id} (${r.score.toFixed(2)})`).join(', ')}`);

      console.log('  ' + bold('FTS-Only:'));
      console.log(`    ${ftsMetrics.found ? green('✓ Found') : red('✗ Not found')} at rank ${ftsMetrics.rank || '-'}  (RR: ${ftsMetrics.reciprocalRank.toFixed(2)})`);
      console.log(`    Top: ${ftsResults.slice(0, 3).map(r => `#${r.id} (${r.score.toFixed(2)})`).join(', ') || '(no results)'}`);

      console.log('  ' + bold('Hybrid:'));
      console.log(`    ${hybridMetrics.found ? green('✓ Found') : red('✗ Not found')} at rank ${hybridMetrics.rank || '-'}  (RR: ${hybridMetrics.reciprocalRank.toFixed(2)})`);
      console.log(`    Top: ${hybridResults.slice(0, 3).map(r => `#${r.id} (${r.score.toFixed(2)})`).join(', ')}`);
    } else {
      // Show results for exploratory queries
      console.log('  ' + bold('Vector-Only:'));
      console.log(`    Top: ${vectorResults.slice(0, 3).map(r => `#${r.id} (${r.score.toFixed(2)})`).join(', ')}`);

      console.log('  ' + bold('FTS-Only:'));
      console.log(`    Top: ${ftsResults.slice(0, 3).map(r => `#${r.id} (${r.score.toFixed(2)})`).join(', ') || '(no results)'}`);

      console.log('  ' + bold('Hybrid:'));
      console.log(`    Top: ${hybridResults.slice(0, 3).map(r => `#${r.id} (${r.score.toFixed(2)})`).join(', ')}`);
    }
    console.log();
  }

  // Summary
  console.log('═'.repeat(70));
  console.log(bold('  SUMMARY (queries with expected results)'));
  console.log('═'.repeat(70));
  console.log();

  const testCount = metrics.vector.count;

  console.log('  ' + bold('Recall@5 (found expected in top 5):'));
  console.log(`    Vector: ${metrics.vector.found}/${testCount} (${((metrics.vector.found/testCount)*100).toFixed(0)}%)`);
  console.log(`    FTS:    ${metrics.fts.found}/${testCount} (${((metrics.fts.found/testCount)*100).toFixed(0)}%)`);
  console.log(`    Hybrid: ${metrics.hybrid.found}/${testCount} (${((metrics.hybrid.found/testCount)*100).toFixed(0)}%)`);
  console.log();

  console.log('  ' + bold('Mean Reciprocal Rank (higher = finds expected earlier):'));
  console.log(`    Vector: ${(metrics.vector.totalRR / testCount).toFixed(3)}`);
  console.log(`    FTS:    ${(metrics.fts.totalRR / testCount).toFixed(3)}`);
  console.log(`    Hybrid: ${(metrics.hybrid.totalRR / testCount).toFixed(3)}`);
  console.log();

  console.log('  ' + bold('Average Latency:'));
  console.log(`    Vector: ${(timing.vector / TEST_CASES.length).toFixed(0)}ms`);
  console.log(`    FTS:    ${(timing.fts / TEST_CASES.length).toFixed(0)}ms`);
  console.log(`    Hybrid: ${(timing.hybrid / TEST_CASES.length).toFixed(0)}ms`);
  console.log();

  // Verdict
  const bestRecall = Math.max(metrics.vector.found, metrics.fts.found, metrics.hybrid.found);
  const bestMRR = Math.max(
    metrics.vector.totalRR / testCount,
    metrics.fts.totalRR / testCount,
    metrics.hybrid.totalRR / testCount
  );

  console.log('  ' + bold('Verdict:'));
  if (metrics.hybrid.found === bestRecall && (metrics.hybrid.totalRR / testCount) >= bestMRR * 0.95) {
    console.log(green('    ✓ Hybrid search provides best overall performance'));
  } else if (metrics.fts.found > metrics.vector.found) {
    console.log(yellow('    ⚠ FTS outperforms vector - consider increasing keyword weight'));
  } else {
    console.log(yellow('    ⚠ Results mixed - may need tuning'));
  }
  console.log();
}

main().catch(console.error);
