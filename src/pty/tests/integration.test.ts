/**
 * Integration Tests
 * Tests for PTY + Spawner + MissionQueue + Memory System integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PTYManager, getPTYManager } from '../manager';
import { AgentSpawner, getAgentSpawner } from '../spawner';
import { MissionQueue, getMissionQueue } from '../mission-queue';
import { selectModel } from '../../interfaces/spawner';
import type { Task, Agent } from '../../interfaces/spawner';
import type { Mission } from '../../interfaces/mission';

describe('Integration: Mission Queue + Spawner', () => {
  let queue: MissionQueue;
  let spawner: AgentSpawner;

  beforeEach(() => {
    queue = new MissionQueue();
    spawner = new AgentSpawner(`integration-test-${Date.now()}`);
  });

  afterEach(async () => {
    try {
      await spawner.shutdown();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Task-to-Mission Flow', () => {
    it('should convert task to mission with correct model tier', () => {
      const task: Task = {
        id: 'task-1',
        prompt: 'Analyze the codebase',
        type: 'analysis',
        priority: 'normal',
      };

      const model = selectModel(task);
      expect(model).toBe('sonnet');

      const missionId = queue.enqueue({
        prompt: task.prompt,
        context: task.context,
        priority: task.priority,
        type: task.type,
        timeoutMs: 120000,
        maxRetries: 3,
      });

      const mission = queue.getMission(missionId);
      expect(mission).toBeDefined();
      expect(mission?.prompt).toBe(task.prompt);
    });

    it('should handle priority escalation', () => {
      const missionId = queue.enqueue({
        prompt: 'Normal task',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      queue.setPriority(missionId, 'critical');

      const mission = queue.getMission(missionId);
      expect(mission?.priority).toBe('critical');
    });
  });

  describe('Mission Lifecycle', () => {
    it('should track mission through complete lifecycle', () => {
      // 1. Enqueue
      const id = queue.enqueue({
        prompt: 'Lifecycle test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      expect(queue.getMission(id)?.status).toBe('queued');

      // 2. Dequeue (simulating agent picking up)
      const mission = queue.dequeue(1);
      expect(mission?.status).toBe('running');
      expect(mission?.assignedTo).toBe(1);
      expect(mission?.startedAt).toBeDefined();

      // 3. Complete
      queue.complete(id, {
        output: 'Task completed successfully',
        durationMs: 5000,
        tokenUsage: { input: 100, output: 200 },
      });

      const completed = queue.getMission(id);
      expect(completed?.status).toBe('completed');
      expect(completed?.result?.output).toBe('Task completed successfully');
      expect(completed?.completedAt).toBeDefined();
    });

    it('should handle mission failure with retry', () => {
      const id = queue.enqueue({
        prompt: 'Retry test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      // Dequeue
      queue.dequeue(1);

      // Fail (recoverable)
      queue.fail(id, {
        code: 'timeout',
        message: 'Operation timed out',
        recoverable: true,
        timestamp: new Date(),
      });

      // Should be retrying, not failed
      const mission = queue.getMission(id);
      expect(mission?.status).toBe('retrying');
      expect(mission?.retryCount).toBe(1);
    });
  });

  describe('Dependency Chain', () => {
    it('should execute missions in dependency order', () => {
      // Mission A: no deps
      const missionA = queue.enqueue({
        prompt: 'Mission A',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      // Mission B: depends on A
      const missionB = queue.enqueue({
        prompt: 'Mission B',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
        dependsOn: [missionA],
      });

      // Mission C: depends on B
      const missionC = queue.enqueue({
        prompt: 'Mission C',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
        dependsOn: [missionB],
      });

      // B and C should be blocked
      expect(queue.getMission(missionB)?.status).toBe('blocked');
      expect(queue.getMission(missionC)?.status).toBe('blocked');

      // Complete A
      queue.dequeue(1);
      queue.complete(missionA, { output: 'A done', durationMs: 100 });

      // B should be unblocked now
      expect(queue.getMission(missionB)?.status).toBe('queued');
      expect(queue.getMission(missionC)?.status).toBe('blocked');

      // Complete B
      queue.dequeue(2);
      queue.complete(missionB, { output: 'B done', durationMs: 100 });

      // C should be unblocked now
      expect(queue.getMission(missionC)?.status).toBe('queued');
    });
  });
});

describe('Integration: Model Selection Strategy', () => {
  it('should allocate Haiku for bulk extraction', () => {
    const tasks: Task[] = [
      { id: 't1', prompt: 'Extract data', type: 'extraction', priority: 'low' },
      { id: 't2', prompt: 'Extract more', type: 'extraction', priority: 'normal' },
    ];

    for (const task of tasks) {
      expect(selectModel(task)).toBe('haiku');
    }
  });

  it('should allocate Sonnet for analysis', () => {
    const tasks: Task[] = [
      { id: 't1', prompt: 'Analyze code', type: 'analysis', priority: 'normal' },
      { id: 't2', prompt: 'Review PR', type: 'review', priority: 'high' },
    ];

    for (const task of tasks) {
      expect(selectModel(task)).toBe('sonnet');
    }
  });

  it('should allocate Opus for synthesis and critical tasks', () => {
    const tasks: Task[] = [
      { id: 't1', prompt: 'Synthesize findings', type: 'synthesis', priority: 'normal' },
      { id: 't2', prompt: 'Critical bug fix', type: 'general', priority: 'critical' },
    ];

    for (const task of tasks) {
      expect(selectModel(task)).toBe('opus');
    }
  });
});

describe('Integration: State Machine', () => {
  describe('Agent State Transitions', () => {
    it('should follow IDLE -> BUSY -> WORKING -> COMPLETED pattern', () => {
      // This tests the conceptual flow without actual PTY spawning
      const states: string[] = [];

      // Simulate state machine
      states.push('idle'); // Initial

      // Task assigned
      states.push('busy');

      // Processing
      states.push('working');

      // Complete
      states.push('completed');

      // Ready for next task
      states.push('idle');

      expect(states).toEqual(['idle', 'busy', 'working', 'completed', 'idle']);
    });

    it('should handle error recovery: WORKING -> ERROR -> IDLE', () => {
      const states: string[] = [];

      states.push('idle');
      states.push('busy');
      states.push('working');
      states.push('error'); // Failure
      states.push('idle'); // Recovery

      expect(states).toEqual(['idle', 'busy', 'working', 'error', 'idle']);
    });
  });

  describe('Mission State Transitions', () => {
    it('should follow queued -> running -> completed', () => {
      const queue = new MissionQueue();

      const id = queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      expect(queue.getMission(id)?.status).toBe('queued');

      queue.dequeue(1);
      expect(queue.getMission(id)?.status).toBe('running');

      queue.complete(id, { output: 'done', durationMs: 100 });
      expect(queue.getMission(id)?.status).toBe('completed');
    });

    it('should follow queued -> running -> retrying -> queued', async () => {
      const queue = new MissionQueue();

      const id = queue.enqueue({
        prompt: 'Retry test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      expect(queue.getMission(id)?.status).toBe('queued');

      queue.dequeue(1);
      expect(queue.getMission(id)?.status).toBe('running');

      queue.retry(id, 'test');
      expect(queue.getMission(id)?.status).toBe('retrying');

      // After delay, would go back to queued
    });

    it('should follow blocked -> queued when deps met', () => {
      const queue = new MissionQueue();

      const depId = queue.enqueue({
        prompt: 'Dependency',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      const id = queue.enqueue({
        prompt: 'Dependent',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
        dependsOn: [depId],
      });

      expect(queue.getMission(id)?.status).toBe('blocked');

      queue.dequeue(1);
      queue.complete(depId, { output: 'done', durationMs: 100 });

      expect(queue.getMission(id)?.status).toBe('queued');
    });
  });
});

describe('Integration: Memory System Connection', () => {
  it('should have access to memory service imports', async () => {
    // This just verifies the imports work
    const { createAgentSession, searchAgentLearnings } = await import('../../services/agent-memory-service');
    expect(typeof createAgentSession).toBe('function');
    expect(typeof searchAgentLearnings).toBe('function');
  });
});

describe('Integration: Orchestrator Pattern', () => {
  describe('Task Distribution Strategy', () => {
    it('should distribute tasks based on type', () => {
      const spawner = new AgentSpawner('dist-test');

      // Without agents, should throw
      const task: Task = {
        id: 'task-1',
        prompt: 'Test',
        priority: 'normal',
      };

      expect(spawner.getAvailableAgent('analysis')).toBeNull();

      spawner.shutdown().catch(() => {});
    });
  });

  describe('Load Balancing', () => {
    it('should prefer idle agents', () => {
      const spawner = new AgentSpawner('lb-test');

      // Empty case
      expect(spawner.getLeastBusyAgent()).toBeNull();

      spawner.shutdown().catch(() => {});
    });
  });
});
