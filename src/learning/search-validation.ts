/**
 * Search Validation & Feedback Loop
 *
 * Like a negative feedback loop in electronics:
 * - Measure: Track search queries and which results were useful
 * - Compare: Evaluate against expected/ideal results
 * - Adjust: Tune weights and parameters to minimize error
 *
 * This enables continuous improvement of search quality.
 */

import { db } from '../db';

// ============ Schema ============

const SEARCH_FEEDBACK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS search_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    search_type TEXT NOT NULL,  -- 'vector', 'fts', 'hybrid'
    results_shown TEXT,         -- JSON array of IDs shown
    result_selected INTEGER,    -- ID that user selected (null if none)
    result_expected INTEGER,    -- ID that should have been top (for validation)
    position_shown INTEGER,     -- Position of selected result (1-indexed)
    position_expected INTEGER,  -- Position where expected result appeared
    latency_ms INTEGER,
    feedback TEXT,              -- 'relevant', 'irrelevant', 'miss'
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_search_feedback_query ON search_feedback(query);
  CREATE INDEX IF NOT EXISTS idx_search_feedback_type ON search_feedback(search_type);
  CREATE INDEX IF NOT EXISTS idx_search_feedback_feedback ON search_feedback(feedback);
`;

// Initialize schema
try {
  db.run(SEARCH_FEEDBACK_SCHEMA);
} catch (e) {
  // Table may already exist
}

// ============ Types ============

export interface SearchFeedback {
  id?: number;
  query: string;
  search_type: 'vector' | 'fts' | 'hybrid';
  results_shown: number[];
  result_selected?: number;
  result_expected?: number;
  position_shown?: number;
  position_expected?: number;
  latency_ms?: number;
  feedback: 'relevant' | 'irrelevant' | 'miss' | 'unknown';
  created_at?: string;
}

export interface SearchMetrics {
  total_searches: number;
  relevant_count: number;
  irrelevant_count: number;
  miss_count: number;
  precision: number;           // relevant / (relevant + irrelevant)
  recall_estimate: number;     // relevant / (relevant + miss)
  mrr: number;                 // Mean Reciprocal Rank
  avg_latency_ms: number;
  by_type: {
    vector: { count: number; precision: number; mrr: number };
    fts: { count: number; precision: number; mrr: number };
    hybrid: { count: number; precision: number; mrr: number };
  };
}

export interface WeightRecommendation {
  current_vector_weight: number;
  current_keyword_weight: number;
  recommended_vector_weight: number;
  recommended_keyword_weight: number;
  confidence: number;
  reason: string;
}

// ============ Feedback Collection ============

/**
 * Record search feedback for continuous improvement
 */
export function recordSearchFeedback(feedback: Omit<SearchFeedback, 'id' | 'created_at'>): number {
  const result = db.run(`
    INSERT INTO search_feedback (
      query, search_type, results_shown, result_selected, result_expected,
      position_shown, position_expected, latency_ms, feedback
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    feedback.query,
    feedback.search_type,
    JSON.stringify(feedback.results_shown),
    feedback.result_selected ?? null,
    feedback.result_expected ?? null,
    feedback.position_shown ?? null,
    feedback.position_expected ?? null,
    feedback.latency_ms ?? null,
    feedback.feedback
  );

  return result.lastInsertRowid as number;
}

/**
 * Record when a search result was selected (implicit positive feedback)
 */
export function recordResultSelected(
  query: string,
  searchType: 'vector' | 'fts' | 'hybrid',
  resultsShown: number[],
  selectedId: number,
  latencyMs?: number
): void {
  const position = resultsShown.indexOf(selectedId) + 1;

  recordSearchFeedback({
    query,
    search_type: searchType,
    results_shown: resultsShown,
    result_selected: selectedId,
    position_shown: position > 0 ? position : undefined,
    latency_ms: latencyMs,
    feedback: 'relevant',
  });
}

/**
 * Record when expected result wasn't in top results (validation test)
 */
export function recordValidationResult(
  query: string,
  searchType: 'vector' | 'fts' | 'hybrid',
  resultsShown: number[],
  expectedId: number,
  latencyMs?: number
): void {
  const position = resultsShown.indexOf(expectedId) + 1;

  recordSearchFeedback({
    query,
    search_type: searchType,
    results_shown: resultsShown,
    result_expected: expectedId,
    position_expected: position > 0 ? position : undefined,
    latency_ms: latencyMs,
    feedback: position > 0 ? 'relevant' : 'miss',
  });
}

/**
 * Record explicit negative feedback (user said result was irrelevant)
 */
export function recordIrrelevantResult(
  query: string,
  searchType: 'vector' | 'fts' | 'hybrid',
  resultsShown: number[],
  irrelevantId: number
): void {
  recordSearchFeedback({
    query,
    search_type: searchType,
    results_shown: resultsShown,
    result_selected: irrelevantId,
    feedback: 'irrelevant',
  });
}

// ============ Metrics Calculation ============

/**
 * Calculate search quality metrics from feedback data
 */
export function calculateSearchMetrics(since?: string): SearchMetrics {
  const whereClause = since ? `WHERE created_at >= ?` : '';
  const params = since ? [since] : [];

  // Overall counts
  const totals = db.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN feedback = 'relevant' THEN 1 ELSE 0 END) as relevant,
      SUM(CASE WHEN feedback = 'irrelevant' THEN 1 ELSE 0 END) as irrelevant,
      SUM(CASE WHEN feedback = 'miss' THEN 1 ELSE 0 END) as miss,
      AVG(latency_ms) as avg_latency,
      AVG(CASE WHEN position_shown > 0 THEN 1.0 / position_shown ELSE 0 END) as mrr
    FROM search_feedback
    ${whereClause}
  `).get(...params) as any;

  // By type
  const byType = db.query(`
    SELECT
      search_type,
      COUNT(*) as count,
      SUM(CASE WHEN feedback = 'relevant' THEN 1 ELSE 0 END) as relevant,
      SUM(CASE WHEN feedback IN ('relevant', 'irrelevant') THEN 1 ELSE 0 END) as judged,
      AVG(CASE WHEN position_shown > 0 THEN 1.0 / position_shown ELSE 0 END) as mrr
    FROM search_feedback
    ${whereClause}
    GROUP BY search_type
  `).all(...params) as any[];

  const typeMetrics: SearchMetrics['by_type'] = {
    vector: { count: 0, precision: 0, mrr: 0 },
    fts: { count: 0, precision: 0, mrr: 0 },
    hybrid: { count: 0, precision: 0, mrr: 0 },
  };

  for (const row of byType) {
    const type = row.search_type as 'vector' | 'fts' | 'hybrid';
    typeMetrics[type] = {
      count: row.count,
      precision: row.judged > 0 ? row.relevant / row.judged : 0,
      mrr: row.mrr || 0,
    };
  }

  const relevant = totals.relevant || 0;
  const irrelevant = totals.irrelevant || 0;
  const miss = totals.miss || 0;

  return {
    total_searches: totals.total || 0,
    relevant_count: relevant,
    irrelevant_count: irrelevant,
    miss_count: miss,
    precision: (relevant + irrelevant) > 0 ? relevant / (relevant + irrelevant) : 0,
    recall_estimate: (relevant + miss) > 0 ? relevant / (relevant + miss) : 0,
    mrr: totals.mrr || 0,
    avg_latency_ms: totals.avg_latency || 0,
    by_type: typeMetrics,
  };
}

// ============ Weight Tuning ============

/**
 * Analyze feedback to recommend weight adjustments
 *
 * The feedback loop:
 * 1. Collect validation results for known query->expected pairs
 * 2. Compare performance of vector vs FTS for each
 * 3. Recommend weights that would have maximized correct results
 */
export function recommendWeights(): WeightRecommendation {
  // Get queries where we have validation data
  const validations = db.query(`
    SELECT
      query,
      result_expected,
      search_type,
      position_expected,
      feedback
    FROM search_feedback
    WHERE result_expected IS NOT NULL
    ORDER BY query, search_type
  `).all() as any[];

  // Group by query
  const byQuery = new Map<string, Map<string, { position: number | null; found: boolean }>>();

  for (const row of validations) {
    if (!byQuery.has(row.query)) {
      byQuery.set(row.query, new Map());
    }
    byQuery.get(row.query)!.set(row.search_type, {
      position: row.position_expected,
      found: row.feedback === 'relevant',
    });
  }

  // Score each approach
  let vectorWins = 0;
  let ftsWins = 0;
  let ties = 0;
  let total = 0;

  for (const [query, results] of byQuery) {
    const vector = results.get('vector');
    const fts = results.get('fts');

    if (!vector || !fts) continue;
    total++;

    // Compare: lower position is better, found beats not found
    const vectorScore = vector.found ? (6 - Math.min(vector.position || 6, 5)) : 0;
    const ftsScore = fts.found ? (6 - Math.min(fts.position || 6, 5)) : 0;

    if (vectorScore > ftsScore) vectorWins++;
    else if (ftsScore > vectorScore) ftsWins++;
    else ties++;
  }

  // Current default weights
  const currentVector = 0.5;
  const currentKeyword = 0.5;

  // Calculate recommended weights based on wins
  if (total === 0) {
    return {
      current_vector_weight: currentVector,
      current_keyword_weight: currentKeyword,
      recommended_vector_weight: currentVector,
      recommended_keyword_weight: currentKeyword,
      confidence: 0,
      reason: 'Insufficient validation data. Run more validation tests.',
    };
  }

  const vectorRatio = vectorWins / total;
  const ftsRatio = ftsWins / total;

  // Blend based on win ratio, with smoothing
  const smoothing = 0.3; // Don't swing too dramatically
  const recommendedVector = currentVector + (vectorRatio - ftsRatio) * smoothing;
  const recommendedKeyword = 1 - recommendedVector;

  // Clamp to reasonable range
  const clampedVector = Math.max(0.2, Math.min(0.8, recommendedVector));
  const clampedKeyword = 1 - clampedVector;

  let reason: string;
  if (Math.abs(clampedVector - currentVector) < 0.05) {
    reason = `Current weights are optimal. Vector won ${vectorWins}/${total}, FTS won ${ftsWins}/${total}.`;
  } else if (clampedVector > currentVector) {
    reason = `Vector search outperformed FTS (${vectorWins} vs ${ftsWins} wins). Increase vector weight.`;
  } else {
    reason = `FTS outperformed vector search (${ftsWins} vs ${vectorWins} wins). Increase keyword weight.`;
  }

  return {
    current_vector_weight: currentVector,
    current_keyword_weight: currentKeyword,
    recommended_vector_weight: Math.round(clampedVector * 100) / 100,
    recommended_keyword_weight: Math.round(clampedKeyword * 100) / 100,
    confidence: Math.min(total / 20, 1), // Confidence scales with sample size
    reason,
  };
}

// ============ Validation Test Runner ============

/**
 * Run validation tests and record results
 */
export async function runValidationTests(
  testCases: Array<{ query: string; expectedId: number }>,
  searchFn: (query: string, type: 'vector' | 'fts' | 'hybrid') => Promise<number[]>
): Promise<{
  vector: { passed: number; failed: number; mrr: number };
  fts: { passed: number; failed: number; mrr: number };
  hybrid: { passed: number; failed: number; mrr: number };
}> {
  const results = {
    vector: { passed: 0, failed: 0, totalRR: 0 },
    fts: { passed: 0, failed: 0, totalRR: 0 },
    hybrid: { passed: 0, failed: 0, totalRR: 0 },
  };

  for (const { query, expectedId } of testCases) {
    for (const type of ['vector', 'fts', 'hybrid'] as const) {
      const start = performance.now();
      const resultIds = await searchFn(query, type);
      const latency = performance.now() - start;

      const position = resultIds.indexOf(expectedId) + 1;
      const found = position > 0 && position <= 5;

      // Record for feedback loop
      recordValidationResult(query, type, resultIds.slice(0, 10), expectedId, latency);

      if (found) {
        results[type].passed++;
        results[type].totalRR += 1 / position;
      } else {
        results[type].failed++;
      }
    }
  }

  const total = testCases.length;
  return {
    vector: {
      passed: results.vector.passed,
      failed: results.vector.failed,
      mrr: total > 0 ? results.vector.totalRR / total : 0,
    },
    fts: {
      passed: results.fts.passed,
      failed: results.fts.failed,
      mrr: total > 0 ? results.fts.totalRR / total : 0,
    },
    hybrid: {
      passed: results.hybrid.passed,
      failed: results.hybrid.failed,
      mrr: total > 0 ? results.hybrid.totalRR / total : 0,
    },
  };
}

// ============ Feedback Summary ============

/**
 * Get recent feedback for review
 */
export function getRecentFeedback(limit: number = 20): SearchFeedback[] {
  const rows = db.query(`
    SELECT * FROM search_feedback
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(row => ({
    ...row,
    results_shown: JSON.parse(row.results_shown || '[]'),
  }));
}

/**
 * Get queries that frequently miss expected results
 */
export function getProblematicQueries(minMisses: number = 2): Array<{
  query: string;
  miss_count: number;
  last_miss: string;
}> {
  return db.query(`
    SELECT
      query,
      COUNT(*) as miss_count,
      MAX(created_at) as last_miss
    FROM search_feedback
    WHERE feedback = 'miss'
    GROUP BY query
    HAVING COUNT(*) >= ?
    ORDER BY miss_count DESC
  `).all(minMisses) as any[];
}

/**
 * Clear old feedback data
 */
export function purgeFeedback(olderThan: string): number {
  const result = db.run(`
    DELETE FROM search_feedback
    WHERE created_at < ?
  `, olderThan);

  return result.changes;
}
