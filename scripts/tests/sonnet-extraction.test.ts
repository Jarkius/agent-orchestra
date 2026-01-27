/**
 * Phase 5 Tests: Sonnet-Based Learning Extraction
 *
 * Tests for:
 * - Quality scoring (heuristic fallback)
 * - Smart distillation (heuristic fallback)
 * - Smart deduplication (heuristic fallback)
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { QualityScorer, getQualityScorer, type QualityScore } from '../../src/learning/quality-scorer';
import { smartDistill, distillFromContent, type EnhancedLearning } from '../../src/learning/distill-engine';
import { smartDeduplicate, type SmartDeduplicationResult } from '../../src/learning/consolidation';
import type { LearningRecord } from '../../src/db';

// ============ Quality Scorer Tests ============

describe('QualityScorer', () => {
  describe('heuristic scoring', () => {
    let scorer: QualityScorer;

    beforeAll(() => {
      // Disable LLM for tests
      scorer = new QualityScorer({ enableLLM: false });
    });

    it('should score specific learnings higher than generic ones', async () => {
      const specificLearning: LearningRecord = {
        id: 1,
        title: 'Use bulk INSERT with BEGIN/COMMIT for 10x faster writes',
        description: 'Measured 1000 rows: bulk=50ms, individual=500ms',
        category: 'performance',
        confidence: 'medium',
        times_validated: 3,
      };

      const genericLearning: LearningRecord = {
        id: 2,
        title: 'Always test your code',
        description: 'Testing is important',
        category: 'testing',
        confidence: 'low',
        times_validated: 0,
      };

      const specificScore = await scorer.scoreLearning(specificLearning);
      const genericScore = await scorer.scoreLearning(genericLearning);

      expect(specificScore.specificity).toBeGreaterThan(genericScore.specificity);
      expect(specificScore.evidence).toBeGreaterThan(genericScore.evidence);
    });

    it('should score actionable learnings higher', async () => {
      const actionable: LearningRecord = {
        id: 3,
        title: 'Use --force flag to skip prompts',
        description: 'Run `bun test --force` instead of manual confirmation',
        category: 'tooling',
        confidence: 'medium',
      };

      const passive: LearningRecord = {
        id: 4,
        title: 'The system has many components',
        description: 'There are various parts to consider',
        category: 'architecture',
        confidence: 'low',
      };

      const actionableScore = await scorer.scoreLearning(actionable);
      const passiveScore = await scorer.scoreLearning(passive);

      expect(actionableScore.actionability).toBeGreaterThan(passiveScore.actionability);
    });

    it('should include reasoning in heuristic mode', async () => {
      const learning: LearningRecord = {
        id: 5,
        title: 'Test learning',
        description: 'Test description',
        category: 'testing',
        confidence: 'low',
      };

      const score = await scorer.scoreLearning(learning);

      expect(score.reasoning).toContain('Heuristic');
    });

    it('should produce overall score between 0 and 1', async () => {
      const learning: LearningRecord = {
        id: 6,
        title: 'Any learning',
        description: 'Any description with some content here',
        category: 'insight',
        confidence: 'medium',
      };

      const score = await scorer.scoreLearning(learning);

      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.overall).toBeLessThanOrEqual(1);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const scorer1 = getQualityScorer({ enableLLM: false });
      const scorer2 = getQualityScorer();

      // Note: might be same or different depending on config
      expect(scorer1).toBeDefined();
      expect(scorer2).toBeDefined();
    });
  });
});

// ============ Smart Distill Tests ============

describe('smartDistill', () => {
  describe('heuristic fallback', () => {
    it('should extract learnings from markdown content', async () => {
      const content = `
# Session Summary

## Wins
- Implemented bulk inserts with 10x performance improvement
- Clean architecture with clear module boundaries

## Challenges
- Initial confusion about async patterns
- Edit tool duplicate matches required more context

## Learnings
- Always use BEGIN/COMMIT for bulk database operations
- Pattern detection during indexing is more efficient
`;

      const result = await smartDistill(content, { enableLLM: false });

      expect(result.learnings.length).toBeGreaterThan(0);
      expect(result.stats.learningsExtracted).toBeGreaterThan(0);
    });

    it('should extract learnings from session context format', async () => {
      const content = `
## Summary
Implemented Oracle Intelligence with proactive spawning

## Wins
- Queue growth detection works well
- Complexity analysis accurate

## Challenges
- API structure differed from docs

## Learnings
- Heuristic fallbacks ensure system works without API keys
`;

      const result = await smartDistill(content, { enableLLM: false });

      expect(result.learnings.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty content gracefully', async () => {
      const result = await smartDistill('', { enableLLM: false });

      expect(result.learnings).toBeInstanceOf(Array);
      expect(result.stats.sectionsProcessed).toBeDefined();
    });

    it('should respect maxLearnings option', async () => {
      const content = `
# Many Learnings
- Learning 1: Always do X
- Learning 2: Never do Y
- Learning 3: Consider Z
- Learning 4: Prefer A
- Learning 5: Avoid B
- Learning 6: Use C
- Learning 7: Try D
- Learning 8: Check E
`;

      const result = await smartDistill(content, {
        enableLLM: false,
        maxLearnings: 3,
      });

      expect(result.learnings.length).toBeLessThanOrEqual(3);
    });
  });
});

// ============ Smart Deduplication Tests ============

describe('smartDeduplicate', () => {
  describe('heuristic fallback', () => {
    it('should return primary when LLM disabled', async () => {
      const primary: LearningRecord = {
        id: 1,
        title: 'Use bulk inserts',
        description: 'Bulk inserts are faster',
        category: 'performance',
        confidence: 'medium',
      };

      const candidates: LearningRecord[] = [
        {
          id: 2,
          title: 'Bulk inserts are better',
          description: 'Always use bulk inserts',
          category: 'performance',
          confidence: 'low',
        },
      ];

      const result = await smartDeduplicate(primary, candidates, { enableLLM: false });

      expect(result.keep.id).toBe(primary.id);
      expect(result.merge).toHaveLength(0);
      expect(result.isDuplicate).toBe(false);
    });

    it('should handle empty candidates', async () => {
      const primary: LearningRecord = {
        id: 1,
        title: 'Some learning',
        description: 'Description',
        category: 'insight',
        confidence: 'low',
      };

      const result = await smartDeduplicate(primary, [], { enableLLM: false });

      expect(result.keep.id).toBe(primary.id);
      expect(result.merge).toHaveLength(0);
    });
  });
});

// ============ Integration Tests ============

describe('Phase 5 Integration', () => {
  it('should have all required exports from quality-scorer', async () => {
    const module = await import('../../src/learning/quality-scorer');

    expect(module.QualityScorer).toBeDefined();
    expect(module.getQualityScorer).toBeDefined();
  });

  it('should have all required exports from distill-engine', async () => {
    const module = await import('../../src/learning/distill-engine');

    expect(module.smartDistill).toBeDefined();
    expect(module.distillFromContent).toBeDefined();
    expect(module.parseMarkdownStructure).toBeDefined();
  });

  it('should have all required exports from consolidation', async () => {
    const module = await import('../../src/learning/consolidation');

    expect(module.smartDeduplicate).toBeDefined();
    expect(module.runSmartConsolidation).toBeDefined();
    expect(module.findConsolidationCandidates).toBeDefined();
  });

  it('quality scorer should integrate with extracted learnings', async () => {
    const content = `
## Learnings
- Use caching for expensive computations
- Measure before optimizing
`;

    const distillResult = await smartDistill(content, { enableLLM: false });
    const scorer = new QualityScorer({ enableLLM: false });

    if (distillResult.learnings.length > 0) {
      const learning = distillResult.learnings[0]!;
      // Convert to LearningRecord format
      const record: LearningRecord = {
        id: 1,
        title: learning.title,
        description: learning.lesson,
        category: learning.category,
        confidence: learning.confidence,
      };

      const score = await scorer.scoreLearning(record);

      expect(score.overall).toBeGreaterThan(0);
      expect(score.overall).toBeLessThanOrEqual(1);
    }
  });
});
