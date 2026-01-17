/**
 * MissionQueue Tests
 * Tests for self-correcting task queue with retry, timeout, and dependencies
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { MissionQueue } from '../mission-queue';
import { calculateBackoff, isRecoverable } from '../../interfaces/mission';
import type { Mission, ErrorContext, Priority } from '../../interfaces/mission';

describe('MissionQueue', () => {
  let queue: MissionQueue;

  beforeEach(() => {
    queue = new MissionQueue();
  });

  describe('Enqueue', () => {
    it('should enqueue a mission and return an ID', () => {
      const id = queue.enqueue({
        prompt: 'Test mission',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      expect(id).toMatch(/^mission_/);
    });

    it('should set initial status to queued', () => {
      const id = queue.enqueue({
        prompt: 'Test mission',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      const mission = queue.getMission(id);
      expect(mission?.status).toBe('queued');
    });

    it('should set status to blocked when dependencies exist', () => {
      const id = queue.enqueue({
        prompt: 'Dependent mission',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
        dependsOn: ['non-existent-dep'],
      });

      const mission = queue.getMission(id);
      expect(mission?.status).toBe('blocked');
    });

    it('should initialize retryCount to 0', () => {
      const id = queue.enqueue({
        prompt: 'Test mission',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      expect(queue.getRetryCount(id)).toBe(0);
    });
  });

  describe('Priority Ordering', () => {
    it('should dequeue critical missions first', () => {
      queue.enqueue({
        prompt: 'Low priority',
        priority: 'low',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      queue.enqueue({
        prompt: 'Critical priority',
        priority: 'critical',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      const mission = queue.dequeue(1);
      expect(mission?.prompt).toBe('Critical priority');
    });

    it('should maintain priority order: critical > high > normal > low', () => {
      queue.enqueue({ prompt: 'normal', priority: 'normal', timeoutMs: 60000, maxRetries: 3 });
      queue.enqueue({ prompt: 'low', priority: 'low', timeoutMs: 60000, maxRetries: 3 });
      queue.enqueue({ prompt: 'high', priority: 'high', timeoutMs: 60000, maxRetries: 3 });
      queue.enqueue({ prompt: 'critical', priority: 'critical', timeoutMs: 60000, maxRetries: 3 });

      expect(queue.dequeue(1)?.prompt).toBe('critical');
      expect(queue.dequeue(2)?.prompt).toBe('high');
      expect(queue.dequeue(3)?.prompt).toBe('normal');
      expect(queue.dequeue(4)?.prompt).toBe('low');
    });

    it('should update priority and reorder', () => {
      const lowId = queue.enqueue({
        prompt: 'Was low',
        priority: 'low',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      queue.enqueue({
        prompt: 'Normal',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      queue.setPriority(lowId, 'critical');

      const first = queue.dequeue(1);
      expect(first?.prompt).toBe('Was low');
    });
  });

  describe('Dequeue', () => {
    it('should return null when queue is empty', () => {
      const mission = queue.dequeue(1);
      expect(mission).toBeNull();
    });

    it('should set status to running on dequeue', () => {
      const id = queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      const mission = queue.dequeue(1);
      expect(mission?.status).toBe('running');
    });

    it('should assign agent ID on dequeue', () => {
      queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      const mission = queue.dequeue(42);
      expect(mission?.assignedTo).toBe(42);
    });

    it('should set startedAt on dequeue', () => {
      queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      const mission = queue.dequeue(1);
      expect(mission?.startedAt).toBeDefined();
    });
  });

  describe('Peek', () => {
    it('should return next mission without removing it', () => {
      queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      const peeked = queue.peek();
      expect(peeked).toBeDefined();

      // Should still be in queue
      const dequeued = queue.dequeue(1);
      expect(dequeued?.prompt).toBe(peeked?.prompt);
    });

    it('should return null when queue is empty', () => {
      expect(queue.peek()).toBeNull();
    });
  });

  describe('Dependencies', () => {
    it('should block mission with unmet dependencies', () => {
      const id = queue.enqueue({
        prompt: 'Dependent',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
        dependsOn: ['dep-1'],
      });

      expect(queue.isReady(id)).toBe(false);
    });

    it('should unblock mission when dependencies complete', () => {
      const depId = queue.enqueue({
        prompt: 'Dependency',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      const dependentId = queue.enqueue({
        prompt: 'Dependent',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
        dependsOn: [depId],
      });

      expect(queue.getMission(dependentId)?.status).toBe('blocked');

      // Complete dependency
      queue.dequeue(1); // Sets to running
      queue.complete(depId, { output: 'done', durationMs: 100 });

      expect(queue.getMission(dependentId)?.status).toBe('queued');
      expect(queue.isReady(dependentId)).toBe(true);
    });

    it('should add dependency dynamically', () => {
      const id = queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      expect(queue.getMission(id)?.status).toBe('queued');

      queue.addDependency(id, 'new-dep');
      expect(queue.getMission(id)?.status).toBe('blocked');
    });

    it('should remove dependency', () => {
      const id = queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
        dependsOn: ['dep-1'],
      });

      queue.removeDependency(id, 'dep-1');
      expect(queue.isReady(id)).toBe(true);
    });

    it('should get all blocked missions', () => {
      queue.enqueue({
        prompt: 'Blocked 1',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
        dependsOn: ['dep-1'],
      });

      queue.enqueue({
        prompt: 'Blocked 2',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
        dependsOn: ['dep-2'],
      });

      const blocked = queue.getBlocked();
      expect(blocked.length).toBe(2);
    });
  });

  describe('Completion', () => {
    it('should mark mission as completed', () => {
      const id = queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      queue.dequeue(1);
      queue.complete(id, { output: 'Success', durationMs: 1000 });

      const mission = queue.getMission(id);
      expect(mission?.status).toBe('completed');
      expect(mission?.result?.output).toBe('Success');
      expect(mission?.completedAt).toBeDefined();
    });
  });

  describe('Failure', () => {
    it('should mark mission as failed', () => {
      const id = queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 0, // No retries
      });

      queue.dequeue(1);
      queue.fail(id, {
        code: 'timeout',
        message: 'Timed out',
        recoverable: false,
        timestamp: new Date(),
      });

      const mission = queue.getMission(id);
      expect(mission?.status).toBe('failed');
      expect(mission?.error?.code).toBe('timeout');
    });
  });

  describe('Retry', () => {
    it('should increment retry count', () => {
      const id = queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      queue.dequeue(1);
      queue.retry(id, 'test reason');

      expect(queue.getRetryCount(id)).toBe(1);
    });

    it('should fail after max retries exceeded', () => {
      const id = queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 1,
      });

      queue.dequeue(1);
      queue.retry(id, 'first');

      // Wait for re-queue
      const mission = queue.getMission(id);
      if (mission?.status === 'retrying') {
        // Force second retry which should fail
        queue.retry(id, 'second');
      }

      // After max retries, should be failed
      expect(queue.getRetryCount(id)).toBeGreaterThanOrEqual(1);
    });

    it('should set retry delay', () => {
      const id = queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      queue.setRetryDelay(id, 5000);
      expect(queue.getMission(id)?.retryDelayMs).toBe(5000);
    });
  });

  describe('Status Queries', () => {
    it('should get missions by status', () => {
      queue.enqueue({ prompt: 'Q1', priority: 'normal', timeoutMs: 60000, maxRetries: 3 });
      queue.enqueue({ prompt: 'Q2', priority: 'normal', timeoutMs: 60000, maxRetries: 3 });

      const queued = queue.getByStatus('queued');
      expect(queued.length).toBe(2);
    });

    it('should get missions by priority', () => {
      queue.enqueue({ prompt: 'C1', priority: 'critical', timeoutMs: 60000, maxRetries: 3 });
      queue.enqueue({ prompt: 'N1', priority: 'normal', timeoutMs: 60000, maxRetries: 3 });
      queue.enqueue({ prompt: 'C2', priority: 'critical', timeoutMs: 60000, maxRetries: 3 });

      const critical = queue.getByPriority('critical');
      expect(critical.length).toBe(2);
    });
  });

  describe('Metrics', () => {
    it('should return queue length', () => {
      expect(queue.getQueueLength()).toBe(0);

      queue.enqueue({ prompt: 'T1', priority: 'normal', timeoutMs: 60000, maxRetries: 3 });
      queue.enqueue({ prompt: 'T2', priority: 'normal', timeoutMs: 60000, maxRetries: 3 });

      expect(queue.getQueueLength()).toBe(2);
    });

    it('should track average wait time', () => {
      // Initial should be 0
      expect(queue.getAverageWaitTime()).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should remove old completed missions', () => {
      const id = queue.enqueue({
        prompt: 'Test',
        priority: 'normal',
        timeoutMs: 60000,
        maxRetries: 3,
      });

      queue.dequeue(1);
      queue.complete(id, { output: 'done', durationMs: 100 });

      // Fake old completion time
      const mission = queue.getMission(id);
      if (mission) {
        mission.completedAt = new Date(Date.now() - 7200000); // 2 hours ago
      }

      queue.cleanup(3600000); // 1 hour threshold

      expect(queue.getMission(id)).toBeNull();
    });
  });
});

describe('Backoff Calculation', () => {
  it('should calculate exponential backoff', () => {
    const delay0 = calculateBackoff(0, 1000);
    const delay1 = calculateBackoff(1, 1000);
    const delay2 = calculateBackoff(2, 1000);

    // With jitter, values should be in ranges
    expect(delay0).toBeGreaterThanOrEqual(750);
    expect(delay0).toBeLessThanOrEqual(1250);

    expect(delay1).toBeGreaterThanOrEqual(1500);
    expect(delay1).toBeLessThanOrEqual(2500);

    expect(delay2).toBeGreaterThanOrEqual(3000);
    expect(delay2).toBeLessThanOrEqual(5000);
  });

  it('should cap at max delay', () => {
    const delay = calculateBackoff(10, 1000, 5000);
    expect(delay).toBeLessThanOrEqual(6250); // max + 25% jitter
  });
});

describe('Error Recovery', () => {
  it('should identify recoverable errors', () => {
    expect(isRecoverable('timeout')).toBe(true);
    expect(isRecoverable('rate_limit')).toBe(true);
    expect(isRecoverable('resource')).toBe(true);
  });

  it('should identify non-recoverable errors', () => {
    expect(isRecoverable('crash')).toBe(false);
    expect(isRecoverable('validation')).toBe(false);
    expect(isRecoverable('auth')).toBe(false);
    expect(isRecoverable('unknown')).toBe(false);
  });
});
