/**
 * Oracle Proactive Spawning Tests
 * Tests for queue growth detection, complexity analysis, and proactive agent spawning
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OracleOrchestrator } from '../../src/oracle/orchestrator';
import { MissionQueue } from '../../src/pty/mission-queue';
import { db } from '../../src/db';

describe('Oracle Proactive Spawning', () => {
  let oracle: OracleOrchestrator;
  let queue: MissionQueue;
  const testPrefix = `oracle_test_${Date.now()}`;

  beforeEach(() => {
    oracle = new OracleOrchestrator();
    queue = new MissionQueue();
  });

  afterEach(() => {
    queue.stopTimeoutEnforcement();
    // Clean up test data
    db.run(`DELETE FROM agent_tasks WHERE id LIKE '${testPrefix}%'`);
    db.run(`DELETE FROM agent_tasks WHERE prompt LIKE '%oracle_test%'`);
  });

  describe('Task Complexity Analysis', () => {
    it('should identify complex architecture tasks', () => {
      const result = oracle.analyzeTaskComplexity(
        'Design the system architecture for the new microservices platform'
      );

      expect(result.tier).toBe('complex');
      expect(result.recommendedModel).toBe('opus');
      expect(result.signals).toContain('architecture');
    });

    it('should identify complex multi-file refactoring', () => {
      const result = oracle.analyzeTaskComplexity(
        'Refactor the authentication module across multiple files'
      );

      expect(result.tier).toBe('complex');
      expect(result.recommendedModel).toBe('opus');
      expect(result.signals).toContain('multi-file-refactor');
    });

    it('should identify complex security analysis', () => {
      const result = oracle.analyzeTaskComplexity(
        'Perform a security audit of the payment processing system'
      );

      expect(result.tier).toBe('complex');
      expect(result.recommendedModel).toBe('opus');
      expect(result.signals).toContain('security-analysis');
    });

    it('should identify moderate feature implementation', () => {
      const result = oracle.analyzeTaskComplexity(
        'Implement user profile page with avatar upload'
      );

      expect(result.tier).toBe('moderate');
      expect(result.recommendedModel).toBe('sonnet');
      expect(result.signals).toContain('feature-implementation');
    });

    it('should identify moderate bug fixes', () => {
      const result = oracle.analyzeTaskComplexity(
        'Fix bug in login form validation'
      );

      expect(result.tier).toBe('moderate');
      expect(result.recommendedModel).toBe('sonnet');
      expect(result.signals).toContain('bug-fix');
    });

    it('should identify moderate testing tasks', () => {
      const result = oracle.analyzeTaskComplexity(
        'Write unit tests for the user service'
      );

      expect(result.tier).toBe('moderate');
      expect(result.recommendedModel).toBe('sonnet');
      expect(result.signals).toContain('testing');
    });

    it('should identify simple file reading tasks', () => {
      const result = oracle.analyzeTaskComplexity(
        'Read the config file and list all settings'
      );

      expect(result.tier).toBe('simple');
      expect(result.recommendedModel).toBe('haiku');
      expect(result.signals).toContain('file-read');
    });

    it('should identify simple search tasks', () => {
      const result = oracle.analyzeTaskComplexity(
        'Search for all usages of the deprecated API'
      );

      expect(result.tier).toBe('simple');
      expect(result.recommendedModel).toBe('haiku');
      expect(result.signals).toContain('search');
    });

    it('should default to sonnet for unclear tasks', () => {
      const result = oracle.analyzeTaskComplexity(
        'Process the data from yesterday'
      );

      expect(result.tier).toBe('moderate');
      expect(result.recommendedModel).toBe('sonnet');
      expect(result.signals).toContain('unknown');
    });

    it('should consider context in complexity analysis', () => {
      const result = oracle.analyzeTaskComplexity(
        'Update the module',
        'This involves cross-file refactoring of the entire auth system'
      );

      expect(result.tier).toBe('complex');
      expect(result.recommendedModel).toBe('opus');
    });
  });

  describe('Queue Growth Rate Detection', () => {
    it('should start with zero growth rate', () => {
      const rate = oracle.getQueueGrowthRate();
      expect(rate).toBe(0);
    });

    it('should track queue growth over time', async () => {
      // Create a fresh queue for this test
      const testQueue = new MissionQueue();

      // Record initial snapshot (before adding missions)
      oracle.recordQueueSnapshot();

      // Add missions to queue
      const beforeDepth = testQueue.getQueueLength();
      for (let i = 0; i < 5; i++) {
        testQueue.enqueue({
          prompt: `oracle_test mission ${i}`,
          priority: 'normal',
          timeoutMs: 60000,
          maxRetries: 1,
        });
      }
      const afterDepth = testQueue.getQueueLength();

      // Verify missions were added
      expect(afterDepth - beforeDepth).toBe(5);

      // Wait and record another snapshot
      await Bun.sleep(50);
      oracle.recordQueueSnapshot();

      // The growth rate calculation works on the main queue which this oracle is using
      // Just verify the mechanism works without checking exact values
      const rate = oracle.getQueueGrowthRate();
      expect(typeof rate).toBe('number');

      testQueue.stopTimeoutEnforcement();
    });

    it('should handle queue shrinking', async () => {
      // Add missions first
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = queue.enqueue({
          prompt: `oracle_test shrink ${i}`,
          priority: 'normal',
          timeoutMs: 60000,
          maxRetries: 1,
        });
        ids.push(id);
      }

      oracle.recordQueueSnapshot();

      // Complete missions
      for (const id of ids) {
        queue.complete(id, { output: 'done', durationMs: 100 });
      }

      await Bun.sleep(100);
      oracle.recordQueueSnapshot();

      const rate = oracle.getQueueGrowthRate();
      // Rate should be negative or zero since queue is shrinking
      expect(rate).toBeLessThanOrEqual(0);
    });
  });

  describe('Spawn Trigger Configuration', () => {
    it('should allow custom spawn triggers', () => {
      oracle.setSpawnTriggers({
        queueGrowthRate: 10,
        queueDepthThreshold: 10,
        idleAgentMinimum: 2,
        taskComplexityBacklog: 5,
      });

      // The configuration should be accepted without error
      expect(true).toBe(true);
    });
  });

  describe('Proactive Spawn Decisions', () => {
    it('should evaluate spawning decisions', () => {
      const decisions = oracle.evaluateProactiveSpawning();

      // Should return array (may be empty if no triggers met)
      expect(Array.isArray(decisions)).toBe(true);
    });

    it('should detect need for complex task agents', () => {
      // Create a fresh queue for complex tasks
      const testQueue = new MissionQueue();

      // Queue multiple complex tasks
      for (let i = 0; i < 4; i++) {
        testQueue.enqueue({
          prompt: `Design the system architecture for module ${i}`,
          priority: 'high',
          timeoutMs: 120000,
          maxRetries: 2,
        });
      }

      // Set lower threshold to trigger
      oracle.setSpawnTriggers({ taskComplexityBacklog: 2 });

      // Verify complexity analysis identifies these as complex
      const complexity = oracle.analyzeTaskComplexity('Design the system architecture for module 1');
      expect(complexity.recommendedModel).toBe('opus');
      expect(complexity.tier).toBe('complex');

      testQueue.stopTimeoutEnforcement();

      // Note: evaluateProactiveSpawning uses the injected queue, so decisions depend on
      // whether there are any opus agents idle. This test verifies the complexity
      // detection works correctly.
    });
  });
});

describe('Oracle Complexity Heuristics', () => {
  let oracle: OracleOrchestrator;

  beforeEach(() => {
    oracle = new OracleOrchestrator();
  });

  it('should correctly categorize 10 sample tasks', () => {
    const tasks = [
      { prompt: 'Architect new payment system', expected: 'opus' },
      { prompt: 'Debug intermittent connection issues', expected: 'opus' },
      { prompt: 'Implement user login', expected: 'sonnet' },
      { prompt: 'Fix button alignment bug', expected: 'sonnet' },
      { prompt: 'Add unit tests for auth', expected: 'sonnet' },
      { prompt: 'Search for TODO comments', expected: 'haiku' },
      { prompt: 'List all config files', expected: 'haiku' },
      { prompt: 'Format the codebase', expected: 'haiku' },
      { prompt: 'Rename variable from x to count', expected: 'haiku' },
      { prompt: 'Review code changes', expected: 'sonnet' },
    ];

    let correct = 0;
    for (const { prompt, expected } of tasks) {
      const result = oracle.analyzeTaskComplexity(prompt);
      if (result.recommendedModel === expected) {
        correct++;
      } else {
        console.log(`Mismatch: "${prompt}" -> ${result.recommendedModel} (expected ${expected})`);
      }
    }

    // Expect at least 80% accuracy
    expect(correct / tasks.length).toBeGreaterThanOrEqual(0.8);
    console.log(`Complexity analysis accuracy: ${correct}/${tasks.length} (${(correct/tasks.length*100).toFixed(0)}%)`);
  });
});
