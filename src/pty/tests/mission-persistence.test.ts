/**
 * Mission Persistence Tests
 * Tests for SQLite-based mission queue persistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { db, saveMission, loadPendingMissions, updateMissionStatus, getMissionFromDb, type MissionRecord } from '../../db';

describe('Mission Persistence', () => {
  const testMissionId = `test_mission_${Date.now()}`;

  afterEach(() => {
    // Clean up test missions
    db.run(`DELETE FROM tasks WHERE id LIKE 'test_mission_%'`);
  });

  describe('saveMission', () => {
    it('should save a new mission to SQLite', () => {
      saveMission({
        id: testMissionId,
        prompt: 'Test mission prompt',
        context: JSON.stringify({ key: 'value' }),
        priority: 'normal',
        type: 'analysis',
        status: 'pending',
        timeoutMs: 60000,
        maxRetries: 3,
        retryCount: 0,
        dependsOn: ['dep1', 'dep2'],
        createdAt: new Date(),
      });

      const saved = getMissionFromDb(testMissionId);
      expect(saved).not.toBeNull();
      expect(saved?.prompt).toBe('Test mission prompt');
      expect(saved?.priority).toBe('normal');
      expect(saved?.type).toBe('analysis');
      expect(saved?.status).toBe('pending');
      expect(saved?.timeout_ms).toBe(60000);
      expect(saved?.max_retries).toBe(3);
      expect(saved?.retry_count).toBe(0);
      expect(JSON.parse(saved?.depends_on || '[]')).toEqual(['dep1', 'dep2']);
    });

    it('should update existing mission on conflict', () => {
      // Save initial mission
      saveMission({
        id: testMissionId,
        prompt: 'Original prompt',
        priority: 'normal',
        status: 'pending',
        timeoutMs: 60000,
        maxRetries: 3,
        retryCount: 0,
        createdAt: new Date(),
      });

      // Update with same ID
      saveMission({
        id: testMissionId,
        prompt: 'Original prompt', // prompt shouldn't change on update
        priority: 'normal',
        status: 'running',
        timeoutMs: 60000,
        maxRetries: 3,
        retryCount: 1,
        assignedTo: 42,
        createdAt: new Date(),
        startedAt: new Date(),
      });

      const updated = getMissionFromDb(testMissionId);
      expect(updated?.status).toBe('running');
      expect(updated?.retry_count).toBe(1);
      expect(updated?.assigned_to).toBe(42);
    });

    it('should handle null optional fields', () => {
      saveMission({
        id: testMissionId,
        prompt: 'Minimal mission',
        priority: 'low',
        status: 'pending',
        timeoutMs: 30000,
        maxRetries: 1,
        retryCount: 0,
        createdAt: new Date(),
      });

      const saved = getMissionFromDb(testMissionId);
      expect(saved?.context).toBeNull();
      expect(saved?.type).toBeNull();
      expect(saved?.depends_on).toBeNull();
      expect(saved?.assigned_to).toBeNull();
    });
  });

  describe('loadPendingMissions', () => {
    it('should load missions with active statuses', () => {
      const statuses = ['pending', 'queued', 'running', 'retrying', 'blocked'];

      for (const status of statuses) {
        saveMission({
          id: `test_mission_${status}_${Date.now()}`,
          prompt: `Mission with status ${status}`,
          priority: 'normal',
          status,
          timeoutMs: 60000,
          maxRetries: 3,
          retryCount: 0,
          createdAt: new Date(),
        });
      }

      const pending = loadPendingMissions();
      const testMissions = pending.filter(m => m.id.startsWith('test_mission_'));

      expect(testMissions.length).toBe(5);
      for (const status of statuses) {
        expect(testMissions.some(m => m.status === status)).toBe(true);
      }
    });

    it('should NOT load completed or failed missions', () => {
      saveMission({
        id: `test_mission_completed_${Date.now()}`,
        prompt: 'Completed mission',
        priority: 'normal',
        status: 'completed',
        timeoutMs: 60000,
        maxRetries: 3,
        retryCount: 0,
        createdAt: new Date(),
      });

      saveMission({
        id: `test_mission_failed_${Date.now()}`,
        prompt: 'Failed mission',
        priority: 'normal',
        status: 'failed',
        timeoutMs: 60000,
        maxRetries: 3,
        retryCount: 0,
        createdAt: new Date(),
      });

      const pending = loadPendingMissions();
      const completed = pending.filter(m => m.status === 'completed' || m.status === 'failed');

      expect(completed.length).toBe(0);
    });

    it('should order by priority then created_at', () => {
      const now = Date.now();

      // Create in reverse order
      saveMission({
        id: `test_mission_low_${now}`,
        prompt: 'Low priority',
        priority: 'low',
        status: 'queued',
        timeoutMs: 60000,
        maxRetries: 3,
        retryCount: 0,
        createdAt: new Date(now - 1000),
      });

      saveMission({
        id: `test_mission_critical_${now}`,
        prompt: 'Critical priority',
        priority: 'critical',
        status: 'queued',
        timeoutMs: 60000,
        maxRetries: 3,
        retryCount: 0,
        createdAt: new Date(now),
      });

      saveMission({
        id: `test_mission_high_${now}`,
        prompt: 'High priority',
        priority: 'high',
        status: 'queued',
        timeoutMs: 60000,
        maxRetries: 3,
        retryCount: 0,
        createdAt: new Date(now - 500),
      });

      const pending = loadPendingMissions();
      const testMissions = pending.filter(m => m.id.includes(`_${now}`));

      expect(testMissions[0]?.priority).toBe('critical');
      expect(testMissions[1]?.priority).toBe('high');
      expect(testMissions[2]?.priority).toBe('low');
    });
  });

  describe('updateMissionStatus', () => {
    beforeEach(() => {
      saveMission({
        id: testMissionId,
        prompt: 'Mission to update',
        priority: 'normal',
        status: 'pending',
        timeoutMs: 60000,
        maxRetries: 3,
        retryCount: 0,
        createdAt: new Date(),
      });
    });

    it('should update status only', () => {
      updateMissionStatus(testMissionId, 'queued');

      const updated = getMissionFromDb(testMissionId);
      expect(updated?.status).toBe('queued');
    });

    it('should update status with extras', () => {
      const startedAt = new Date();
      updateMissionStatus(testMissionId, 'running', {
        assignedTo: 123,
        startedAt,
      });

      const updated = getMissionFromDb(testMissionId);
      expect(updated?.status).toBe('running');
      expect(updated?.assigned_to).toBe(123);
      expect(updated?.started_at).toBe(startedAt.toISOString());
    });

    it('should update retry count', () => {
      updateMissionStatus(testMissionId, 'retrying', {
        retryCount: 2,
      });

      const updated = getMissionFromDb(testMissionId);
      expect(updated?.status).toBe('retrying');
      expect(updated?.retry_count).toBe(2);
    });

    it('should store error as JSON', () => {
      const error = { code: 'timeout', message: 'Mission timed out', recoverable: true };
      updateMissionStatus(testMissionId, 'failed', {
        error,
        completedAt: new Date(),
      });

      const updated = getMissionFromDb(testMissionId);
      expect(updated?.status).toBe('failed');
      expect(JSON.parse(updated?.error || '{}')).toEqual(error);
    });

    it('should store result as JSON', () => {
      const result = { output: 'Success!', durationMs: 1500 };
      updateMissionStatus(testMissionId, 'completed', {
        result,
        completedAt: new Date(),
      });

      const updated = getMissionFromDb(testMissionId);
      expect(updated?.status).toBe('completed');
      expect(JSON.parse(updated?.result || '{}')).toEqual(result);
    });
  });

  describe('getMissionFromDb', () => {
    it('should return null for non-existent mission', () => {
      const result = getMissionFromDb('non_existent_id');
      expect(result).toBeNull();
    });

    it('should return mission record with all fields', () => {
      const createdAt = new Date();
      saveMission({
        id: testMissionId,
        prompt: 'Full mission',
        context: '{"data": true}',
        priority: 'high',
        type: 'synthesis',
        status: 'queued',
        timeoutMs: 90000,
        maxRetries: 5,
        retryCount: 1,
        dependsOn: ['dep1'],
        assignedTo: 7,
        createdAt,
      });

      const record = getMissionFromDb(testMissionId);
      expect(record).not.toBeNull();
      expect(record?.id).toBe(testMissionId);
      expect(record?.prompt).toBe('Full mission');
      expect(record?.context).toBe('{"data": true}');
      expect(record?.priority).toBe('high');
      expect(record?.type).toBe('synthesis');
      expect(record?.status).toBe('queued');
      expect(record?.timeout_ms).toBe(90000);
      expect(record?.max_retries).toBe(5);
      expect(record?.retry_count).toBe(1);
      expect(record?.assigned_to).toBe(7);
    });
  });
});
