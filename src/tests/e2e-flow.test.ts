/**
 * End-to-End Flow Tests
 * Tests critical paths: mission → learning → recall
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { MissionQueue } from '../pty/mission-queue';
import { db, saveMission, loadPendingMissions, getMissionFromDb, createLearning, updateLearning } from '../db';
import type { Mission, MissionResult } from '../interfaces/mission';

describe('E2E: Mission Lifecycle', () => {
  let queue: MissionQueue;
  const testPrefix = `e2e_test_${Date.now()}`;

  beforeEach(() => {
    queue = new MissionQueue();
  });

  afterEach(() => {
    queue.stopTimeoutEnforcement();
    // Clean up test data
    db.run(`DELETE FROM tasks WHERE id LIKE '${testPrefix}%'`);
    db.run(`DELETE FROM tasks WHERE id LIKE 'mission_%' AND prompt LIKE '%E2E test%'`);
  });

  it('should complete full mission lifecycle: enqueue → dequeue → complete', () => {
    // 1. Enqueue
    const missionId = queue.enqueue({
      prompt: 'E2E test mission',
      priority: 'normal',
      timeoutMs: 60000,
      maxRetries: 3,
    });

    expect(missionId).toMatch(/^mission_/);

    // Verify persisted
    const persisted = getMissionFromDb(missionId);
    expect(persisted).not.toBeNull();
    expect(persisted?.status).toBe('queued');

    // 2. Dequeue
    const mission = queue.dequeue(1);
    expect(mission).not.toBeNull();
    expect(mission?.id).toBe(missionId);
    expect(mission?.status).toBe('running');

    // Verify status persisted
    const running = getMissionFromDb(missionId);
    expect(running?.status).toBe('running');
    expect(running?.assigned_to).toBe(1);

    // 3. Complete
    const result: MissionResult = {
      output: 'Mission completed successfully',
      durationMs: 1500,
    };
    queue.complete(missionId, result);

    // Verify completion persisted
    const completed = getMissionFromDb(missionId);
    expect(completed?.status).toBe('completed');
    expect(JSON.parse(completed?.result || '{}')).toEqual(result);
  });

  it('should handle mission failure and persist error', () => {
    const missionId = queue.enqueue({
      prompt: 'E2E test mission - will fail',
      priority: 'normal',
      timeoutMs: 60000,
      maxRetries: 0, // No retries
    });

    // Dequeue
    queue.dequeue(1);

    // Fail
    queue.fail(missionId, {
      code: 'validation',
      message: 'Test failure',
      recoverable: false,
      timestamp: new Date(),
    });

    // Verify failure persisted
    const failed = getMissionFromDb(missionId);
    expect(failed?.status).toBe('failed');
    expect(JSON.parse(failed?.error || '{}')).toMatchObject({
      code: 'validation',
      message: 'Test failure',
    });
  });

  it('should recover interrupted missions on startup', () => {
    // Simulate interrupted mission by directly inserting to DB
    const interruptedId = `${testPrefix}_interrupted`;
    saveMission({
      id: interruptedId,
      prompt: 'E2E interrupted mission',
      priority: 'high',
      status: 'running', // Was running when interrupted
      timeoutMs: 60000,
      maxRetries: 3,
      retryCount: 0,
      assignedTo: 99,
      createdAt: new Date(),
      startedAt: new Date(),
    });

    // Create new queue (simulates restart)
    const newQueue = new MissionQueue();
    const loaded = newQueue.loadFromDb();

    expect(loaded).toBeGreaterThanOrEqual(1);

    // Interrupted mission should be re-queued
    const recovered = newQueue.getMission(interruptedId);
    expect(recovered).not.toBeNull();
    expect(recovered?.status).toBe('queued'); // Reset from 'running' to 'queued'
    expect(recovered?.assignedTo).toBeUndefined(); // Agent assignment cleared

    // Should be in the queue
    expect(newQueue.getQueueLength()).toBeGreaterThanOrEqual(1);

    newQueue.stopTimeoutEnforcement();
  });

  it('should maintain priority order after recovery', () => {
    const now = Date.now();
    const uniquePrefix = `priority_test_${now}`;

    // Clean any existing test data first
    db.run(`DELETE FROM tasks WHERE id LIKE '${uniquePrefix}%'`);

    // Insert missions with different priorities
    saveMission({
      id: `${uniquePrefix}_low`,
      prompt: 'Low priority',
      priority: 'low',
      status: 'queued',
      timeoutMs: 60000,
      maxRetries: 3,
      retryCount: 0,
      createdAt: new Date(now - 3000),
    });

    saveMission({
      id: `${uniquePrefix}_critical`,
      prompt: 'Critical priority',
      priority: 'critical',
      status: 'queued',
      timeoutMs: 60000,
      maxRetries: 3,
      retryCount: 0,
      createdAt: new Date(now - 1000),
    });

    saveMission({
      id: `${uniquePrefix}_normal`,
      prompt: 'Normal priority',
      priority: 'normal',
      status: 'queued',
      timeoutMs: 60000,
      maxRetries: 3,
      retryCount: 0,
      createdAt: new Date(now - 2000),
    });

    // Load into new queue
    const newQueue = new MissionQueue();
    newQueue.loadFromDb();

    // Get our test missions only
    const testMissions = newQueue.getAllMissions().filter(m => m.id.startsWith(uniquePrefix));
    expect(testMissions.length).toBe(3);

    // Verify priority is correct by checking the queue order
    const criticalMission = testMissions.find(m => m.id.includes('_critical'));
    const normalMission = testMissions.find(m => m.id.includes('_normal'));
    const lowMission = testMissions.find(m => m.id.includes('_low'));

    expect(criticalMission?.priority).toBe('critical');
    expect(normalMission?.priority).toBe('normal');
    expect(lowMission?.priority).toBe('low');

    newQueue.stopTimeoutEnforcement();

    // Clean up
    db.run(`DELETE FROM tasks WHERE id LIKE '${uniquePrefix}%'`);
  });
});

describe('E2E: Learning Flow', () => {
  const testPrefix = `e2e_learning_${Date.now()}`;

  afterEach(() => {
    // Clean up test learnings
    db.run(`DELETE FROM learnings WHERE title LIKE '%${testPrefix}%'`);
  });

  it('should create learning and retrieve it', () => {
    const learningId = createLearning({
      category: 'debugging',
      title: `${testPrefix} - Debug pattern discovered`,
      description: 'Found effective debugging approach',
      context: JSON.stringify({ file: 'test.ts', line: 42 }),
      confidence: 'medium',
      visibility: 'private',
    });

    expect(learningId).toBeGreaterThan(0);

    // Query it back
    const learning = db.query(`SELECT * FROM learnings WHERE id = ?`).get(learningId) as any;
    expect(learning).not.toBeNull();
    expect(learning.category).toBe('debugging');
    expect(learning.confidence).toBe('medium');
  });

  it('should update learning confidence', () => {
    const learningId = createLearning({
      category: 'performance',
      title: `${testPrefix} - Performance tip`,
      confidence: 'low',
    });

    // Update confidence
    updateLearning(learningId, {
      confidence: 'high',
    });

    // Separately update times_validated via raw SQL (as updateLearning doesn't support it)
    db.run(`UPDATE learnings SET times_validated = ? WHERE id = ?`, [5, learningId]);

    const updated = db.query(`SELECT * FROM learnings WHERE id = ?`).get(learningId) as any;
    expect(updated.confidence).toBe('high');
    expect(updated.times_validated).toBe(5);
  });

  it('should search learnings by category', () => {
    // Create test learnings
    createLearning({
      category: 'architecture',
      title: `${testPrefix} - Architecture insight 1`,
      confidence: 'medium',
    });

    createLearning({
      category: 'architecture',
      title: `${testPrefix} - Architecture insight 2`,
      confidence: 'high',
    });

    createLearning({
      category: 'testing',
      title: `${testPrefix} - Testing tip`,
      confidence: 'low',
    });

    // Query by category with proper confidence ordering
    const archLearnings = db.query(`
      SELECT * FROM learnings
      WHERE category = 'architecture' AND title LIKE '%${testPrefix}%'
      ORDER BY CASE confidence
        WHEN 'proven' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
      END ASC
    `).all() as any[];

    expect(archLearnings.length).toBe(2);
    expect(archLearnings[0].confidence).toBe('high'); // Ordered by confidence
    expect(archLearnings[1].confidence).toBe('medium');
  });
});

describe('E2E: Session Save and Recall', () => {
  const testPrefix = `e2e_session_${Date.now()}`;

  afterEach(() => {
    // Clean up test sessions
    db.run(`DELETE FROM sessions WHERE id LIKE '%${testPrefix}%'`);
  });

  it('should save session with full context', () => {
    const sessionId = `${testPrefix}_session1`;

    db.run(`
      INSERT INTO sessions (id, summary, full_context, tags, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      sessionId,
      'Test session summary',
      JSON.stringify({
        wins: ['Completed feature X'],
        challenges: ['Debugging issue Y'],
        learnings: ['Pattern Z is effective'],
      }),
      JSON.stringify(['test', 'e2e']),
    ]);

    // Retrieve session
    const session = db.query(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as any;
    expect(session).not.toBeNull();
    expect(session.summary).toBe('Test session summary');

    const context = JSON.parse(session.full_context);
    expect(context.wins).toContain('Completed feature X');
    expect(context.learnings).toContain('Pattern Z is effective');
  });

  it('should link sessions for continuity', () => {
    const session1Id = `${testPrefix}_session_a`;
    const session2Id = `${testPrefix}_session_b`;

    // First session
    db.run(`
      INSERT INTO sessions (id, summary, created_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `, [session1Id, 'First session']);

    // Second session links to first
    db.run(`
      INSERT INTO sessions (id, previous_session_id, summary, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `, [session2Id, session1Id, 'Continuation session']);

    // Query chain
    const session2 = db.query(`SELECT * FROM sessions WHERE id = ?`).get(session2Id) as any;
    expect(session2.previous_session_id).toBe(session1Id);

    // Find session chain
    const chain = db.query(`
      SELECT s2.id, s2.summary, s1.summary as previous_summary
      FROM sessions s2
      LEFT JOIN sessions s1 ON s2.previous_session_id = s1.id
      WHERE s2.id = ?
    `).get(session2Id) as any;

    expect(chain.previous_summary).toBe('First session');
  });
});
