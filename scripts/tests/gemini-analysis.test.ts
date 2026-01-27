/**
 * Phase 7 Tests: Gemini-Based Codebase Analysis
 *
 * Tests for:
 * - Cross-session pattern detection (heuristic fallback)
 * - Code-learning correlation (heuristic fallback)
 * - Codebase insights (heuristic fallback)
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import {
  CrossSessionAnalyzer,
  getCrossSessionAnalyzer,
  analyzeRecentSessions,
  type CrossSessionPattern,
} from '../../src/learning/cross-session';
import {
  CodeCorrelator,
  getCodeCorrelator,
  getCorrelationSummary,
  type CorrelationMatch,
} from '../../src/learning/code-correlation';
import {
  analyzeCodebaseWithGemini,
  analyzeRepository,
  type CodebaseInsight,
} from '../../src/learning/code-analyzer';
import { ExternalLLM } from '../../src/services/external-llm';

// ============ Cross-Session Tests ============

describe('CrossSessionAnalyzer', () => {
  describe('heuristic analysis', () => {
    let analyzer: CrossSessionAnalyzer;

    beforeAll(() => {
      analyzer = new CrossSessionAnalyzer({ enableLLM: false });
    });

    it('should return empty patterns for insufficient sessions', async () => {
      const result = await analyzer.analyzePatterns({ sessionIds: [] });

      expect(result.patterns).toEqual([]);
      expect(result.stats.sessionsAnalyzed).toBe(0);
      expect(result.stats.usedLLM).toBe(false);
    });

    it('should analyze available sessions', async () => {
      const result = await analyzer.analyzePatterns({ sinceDays: 30 });

      expect(result.patterns).toBeInstanceOf(Array);
      expect(result.summary).toBeTruthy();
      expect(result.stats.usedLLM).toBe(false);
    });

    it('should detect patterns from tags', async () => {
      // This depends on actual session data, so we just verify structure
      const result = await analyzer.analyzePatterns({});

      for (const pattern of result.patterns) {
        expect(pattern.pattern).toBeTruthy();
        expect(pattern.sessions).toBeInstanceOf(Array);
        expect(pattern.frequency).toBeGreaterThan(0);
        expect(['increasing', 'stable', 'decreasing']).toContain(pattern.trend);
        expect(['workflow', 'challenge', 'success', 'anti-pattern', 'insight']).toContain(pattern.category);
      }
    });
  });

  describe('singleton', () => {
    it('should return analyzer instance', () => {
      const analyzer1 = getCrossSessionAnalyzer({ enableLLM: false });
      const analyzer2 = getCrossSessionAnalyzer();

      expect(analyzer1).toBeDefined();
      expect(analyzer2).toBeDefined();
    });
  });
});

// ============ Code Correlation Tests ============

describe('CodeCorrelator', () => {
  describe('heuristic correlation', () => {
    let correlator: CodeCorrelator;

    beforeAll(() => {
      correlator = new CodeCorrelator({
        enableLLM: false,
        persistLinks: false, // Don't modify DB during tests
      });
    });

    it('should handle correlation without code files', async () => {
      const result = await correlator.correlateAll({
        learnings: [],
        codeFiles: [],
      });

      expect(result.matches).toEqual([]);
      expect(result.stats.learningsAnalyzed).toBe(0);
      expect(result.stats.usedLLM).toBe(false);
    });

    it('should provide correlation summary', () => {
      const summary = getCorrelationSummary();

      expect(summary).toHaveProperty('totalLinks');
      expect(summary).toHaveProperty('linkedLearnings');
      expect(summary).toHaveProperty('linkedFiles');
      expect(summary).toHaveProperty('byType');
    });
  });

  describe('singleton', () => {
    it('should return correlator instance', () => {
      const correlator1 = getCodeCorrelator({ enableLLM: false });
      const correlator2 = getCodeCorrelator();

      expect(correlator1).toBeDefined();
      expect(correlator2).toBeDefined();
    });
  });
});

// ============ Codebase Insights Tests ============

describe('CodebaseInsights', () => {
  describe('heuristic analysis', () => {
    it('should analyze repository with heuristics', async () => {
      const insight = await analyzeCodebaseWithGemini('.', {
        enableLLM: false,
        maxFiles: 10,
      });

      expect(insight.patterns).toBeInstanceOf(Array);
      expect(insight.antiPatterns).toBeInstanceOf(Array);
      expect(insight.architectureNotes).toBeInstanceOf(Array);
      expect(insight.suggestions).toBeInstanceOf(Array);
      expect(insight.summary).toBeTruthy();
    });

    it('should detect patterns in codebase', async () => {
      const result = analyzeRepository('.', { maxFiles: 20 });

      expect(result.learnings.length).toBeGreaterThan(0);
      expect(result.stats.filesAnalyzed).toBeGreaterThan(0);
    });

    it('should validate pattern structure', async () => {
      const insight = await analyzeCodebaseWithGemini('.', {
        enableLLM: false,
        maxFiles: 10,
      });

      for (const pattern of insight.patterns) {
        expect(pattern.name).toBeTruthy();
        expect(typeof pattern.frequency).toBe('number');
        expect(pattern.files).toBeInstanceOf(Array);
      }
    });

    it('should validate suggestion structure', async () => {
      const insight = await analyzeCodebaseWithGemini('.', {
        enableLLM: false,
        maxFiles: 5,
      });

      for (const suggestion of insight.suggestions) {
        expect(suggestion.title).toBeTruthy();
        expect(['low', 'medium', 'high']).toContain(suggestion.priority);
        expect(['low', 'medium', 'high']).toContain(suggestion.effort);
      }
    });
  });
});

// ============ ExternalLLM Tests ============

describe('ExternalLLM', () => {
  it('should have complete method', () => {
    // Just verify the method exists without calling it (requires API key)
    expect(ExternalLLM.prototype.complete).toBeDefined();
    expect(ExternalLLM.prototype.query).toBeDefined();
  });

  it('should list available providers', () => {
    const providers = ExternalLLM.getAvailableProviders();

    expect(providers).toBeInstanceOf(Array);
    // May be empty if no API keys configured
  });
});

// ============ Integration Tests ============

describe('Phase 7 Integration', () => {
  it('should have all required exports from cross-session', async () => {
    const module = await import('../../src/learning/cross-session');

    expect(module.CrossSessionAnalyzer).toBeDefined();
    expect(module.getCrossSessionAnalyzer).toBeDefined();
    expect(module.analyzeRecentSessions).toBeDefined();
    expect(module.analyzeSessionsByTag).toBeDefined();
  });

  it('should have all required exports from code-correlation', async () => {
    const module = await import('../../src/learning/code-correlation');

    expect(module.CodeCorrelator).toBeDefined();
    expect(module.getCodeCorrelator).toBeDefined();
    expect(module.correlateAllLearnings).toBeDefined();
    expect(module.getCorrelationSummary).toBeDefined();
    expect(module.findLearningsForCode).toBeDefined();
    expect(module.findCodeForLearning).toBeDefined();
  });

  it('should have Gemini analysis exports from code-analyzer', async () => {
    const module = await import('../../src/learning/code-analyzer');

    expect(module.analyzeCodebaseWithGemini).toBeDefined();
    expect(module.analyzeRepository).toBeDefined();
  });

  it('should have complete method in ExternalLLM', async () => {
    const module = await import('../../src/services/external-llm');

    expect(module.ExternalLLM.prototype.complete).toBeDefined();
  });

  it('cross-session and code-correlation should work together', async () => {
    const crossSession = getCrossSessionAnalyzer({ enableLLM: false });
    const codeCorrelator = getCodeCorrelator({ enableLLM: false, persistLinks: false });

    // Both should be able to analyze without errors
    const sessionResult = await crossSession.analyzePatterns({ sinceDays: 7 });
    const correlationResult = await codeCorrelator.correlateAll({
      learnings: [],
      codeFiles: [],
    });

    expect(sessionResult.stats).toBeDefined();
    expect(correlationResult.stats).toBeDefined();
  });
});
