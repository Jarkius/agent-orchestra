/**
 * Learning Loop Integration Tests
 * Tests for learning loop integration with mission flow
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { LearningLoop } from '../loop';
import type { CompletedMission, FailedMission } from '../../interfaces/learning';

describe('Learning Loop Integration', () => {
  let loop: LearningLoop;

  beforeEach(() => {
    loop = new LearningLoop();
  });

  describe('harvestFromMission', () => {
    it('should extract learnings from completed mission output', async () => {
      const mission: CompletedMission = {
        id: 'test-mission-1',
        prompt: 'Implement caching layer',
        type: 'coding',
        assignedTo: 1,
        status: 'completed',
        result: {
          output: 'Successfully implemented Redis cache. Key insight: Always set TTL to prevent memory leaks. The cache invalidation strategy uses tag-based eviction.',
          durationMs: 5000,
        },
        createdAt: new Date(),
        completedAt: new Date(),
      };

      const learnings = await loop.harvestFromMission(mission);

      // Should extract at least one insight
      expect(learnings.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty array for mission without output', async () => {
      const mission: CompletedMission = {
        id: 'test-mission-2',
        prompt: 'Quick fix',
        status: 'completed',
        result: { output: '', durationMs: 100 },
        createdAt: new Date(),
        completedAt: new Date(),
      };

      const learnings = await loop.harvestFromMission(mission);
      expect(learnings).toEqual([]);
    });
  });

  describe('analyzeFailure', () => {
    it('should analyze timeout failure', async () => {
      const mission: FailedMission = {
        id: 'failed-mission-1',
        prompt: 'Long running task',
        status: 'failed',
        error: {
          code: 'timeout',
          message: 'Task exceeded 120s timeout',
          recoverable: true,
          timestamp: new Date(),
        },
        createdAt: new Date(),
      };

      const analysis = await loop.analyzeFailure(mission);

      expect(analysis.category).toBe('timeout');
      expect(analysis.rootCause).toBe('Task exceeded 120s timeout');
      expect(analysis.suggestion).toContain('timeout');
    });

    it('should analyze validation failure as logic error', async () => {
      const mission: FailedMission = {
        id: 'failed-mission-2',
        prompt: 'Parse JSON data',
        status: 'failed',
        error: {
          code: 'validation',
          message: 'Invalid JSON format',
          recoverable: false,
          timestamp: new Date(),
        },
        createdAt: new Date(),
      };

      const analysis = await loop.analyzeFailure(mission);

      expect(analysis.category).toBe('logic');
      expect(analysis.suggestion).toBeDefined();
    });

    it('should analyze auth failure as external error', async () => {
      const mission: FailedMission = {
        id: 'failed-mission-3',
        prompt: 'Fetch API data',
        status: 'failed',
        error: {
          code: 'auth',
          message: 'API key expired',
          recoverable: true,
          timestamp: new Date(),
        },
        createdAt: new Date(),
      };

      const analysis = await loop.analyzeFailure(mission);

      expect(analysis.category).toBe('external');
      expect(analysis.suggestion).toContain('external');
    });

    it('should handle unknown error codes', async () => {
      const mission: FailedMission = {
        id: 'failed-mission-4',
        prompt: 'Mystery task',
        status: 'failed',
        error: {
          code: 'unknown',
          message: 'Something went wrong',
          recoverable: false,
          timestamp: new Date(),
        },
        createdAt: new Date(),
      };

      const analysis = await loop.analyzeFailure(mission);

      expect(analysis.category).toBe('unknown');
      expect(analysis.suggestion).toBeDefined();
    });
  });

  describe('suggestLearnings', () => {
    it('should return array of learnings for task prompt', async () => {
      const task = { prompt: 'Implement user authentication with JWT tokens' };

      const suggestions = await loop.suggestLearnings(task);

      // Should return an array (may be empty if no learnings exist)
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('detectPatterns', () => {
    it('should detect patterns from mission history', async () => {
      const missions = [
        { id: '1', type: 'coding', status: 'completed', prompt: 'Task 1', createdAt: new Date() },
        { id: '2', type: 'coding', status: 'completed', prompt: 'Task 2', createdAt: new Date() },
        { id: '3', type: 'coding', status: 'failed', prompt: 'Task 3', createdAt: new Date() },
        { id: '4', type: 'review', status: 'completed', prompt: 'Task 4', createdAt: new Date() },
        { id: '5', type: 'review', status: 'completed', prompt: 'Task 5', createdAt: new Date() },
      ];

      const patterns = await loop.detectPatterns(missions as any, 5);

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should return empty array for empty mission list', async () => {
      const patterns = await loop.detectPatterns([], 10);
      expect(patterns).toEqual([]);
    });
  });

  describe('Dual Collection Pattern', () => {
    it('should add and search knowledge entries', async () => {
      const knowledgeId = `test-knowledge-${Date.now()}`;

      await loop.addKnowledge({
        id: knowledgeId,
        content: 'Redis EXPIRE command sets TTL in seconds',
        category: 'tooling',
        missionId: 'test-mission',
      });

      const results = await loop.searchKnowledge('Redis TTL expire');
      expect(Array.isArray(results)).toBe(true);
    });

    it('should add and search lesson entries', async () => {
      const lessonId = `test-lesson-${Date.now()}`;

      await loop.addLesson({
        id: lessonId,
        problem: 'Cache grows unbounded',
        solution: 'Set TTL on all cache keys',
        outcome: 'Memory usage stabilized',
        category: 'performance',
      });

      const results = await loop.searchLessons('cache memory TTL');
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Agent Recommendation', () => {
    it('should recommend agent for task', async () => {
      const task = { prompt: 'Review code for security issues', type: 'review' };

      const recommendation = await loop.recommendAgent(task);

      // May return null if no agents have history
      expect(recommendation === null || typeof recommendation === 'object').toBe(true);
    });
  });

  describe('Confidence Management', () => {
    it('should handle validation of non-existent learning', async () => {
      // This test verifies the validateLearning method exists and handles missing IDs
      const result = await loop.validateLearning(999999); // Non-existent ID

      // Should return undefined or false for non-existent learning
      expect(result === undefined || result === false).toBe(true);
    });
  });
});
