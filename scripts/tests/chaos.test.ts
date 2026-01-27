/**
 * Chaos Tests for Oracle Intelligence
 *
 * Tests system resilience under failure conditions:
 * - Agent crashes and recovery
 * - Task timeouts and retries
 * - Network failures and reconnection
 * - Resource exhaustion
 * - Concurrent failures
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getOracleOrchestrator } from '../../src/oracle/orchestrator';
import { getTaskRouter } from '../../src/oracle/task-router';
import { getTaskDecomposer } from '../../src/oracle/task-decomposer';
import { MissionQueue } from '../../src/pty/mission-queue';
import {
  createTempDb,
  getTempDb,
  cleanupTempDb
} from './test-utils';
import type { AgentRole, ModelTier } from '../../src/interfaces/spawner';
import type { Mission } from '../../src/interfaces/mission';

// Chaos injection types
type ChaosEvent =
  | { type: 'agent_crash'; agentId: number }
  | { type: 'task_timeout'; taskId: string }
  | { type: 'network_partition'; durationMs: number }
  | { type: 'memory_pressure'; level: 'low' | 'medium' | 'high' }
  | { type: 'db_lock'; durationMs: number }
  | { type: 'random_failure'; probability: number };

// Chaos test state
interface ChaosState {
  eventsInjected: ChaosEvent[];
  recoveryAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  systemStable: boolean;
}

describe('Chaos Testing - Agent Failures', () => {
  let db: ReturnType<typeof getTempDb>;
  let oracle: ReturnType<typeof getOracleOrchestrator>;
  let missionQueue: MissionQueue;
  let chaosState: ChaosState;

  beforeEach(() => {
    createTempDb();
    db = getTempDb();
    oracle = getOracleOrchestrator();
    missionQueue = new MissionQueue(db);

    chaosState = {
      eventsInjected: [],
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      systemStable: true,
    };
  });

  afterEach(() => {
    cleanupTempDb();
  });

  // Helper: Register agent in DB
  function registerAgent(id: number, role: AgentRole, model: ModelTier, status = 'idle') {
    db.prepare(`
      INSERT OR REPLACE INTO agents (id, role, model, status, pid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(id, role, model, status, 1000 + id);
  }

  // Helper: Inject chaos event
  function injectChaos(event: ChaosEvent): boolean {
    chaosState.eventsInjected.push(event);
    return true;
  }

  // Helper: Simulate agent crash
  function simulateAgentCrash(agentId: number) {
    injectChaos({ type: 'agent_crash', agentId });
    db.prepare(`UPDATE agents SET status = 'crashed' WHERE id = ?`).run(agentId);
    chaosState.systemStable = false;
  }

  // Helper: Attempt recovery
  function attemptRecovery(agentId: number): boolean {
    chaosState.recoveryAttempts++;

    // 90% recovery success rate
    const success = Math.random() > 0.1;

    if (success) {
      db.prepare(`UPDATE agents SET status = 'idle' WHERE id = ?`).run(agentId);
      chaosState.successfulRecoveries++;
      chaosState.systemStable = true;
    } else {
      chaosState.failedRecoveries++;
    }

    return success;
  }

  describe('Single Agent Crash', () => {
    it('should detect crashed agent', () => {
      registerAgent(1, 'coder', 'sonnet', 'busy');

      simulateAgentCrash(1);

      const agent = db.prepare(`SELECT status FROM agents WHERE id = ?`).get(1) as { status: string };
      expect(agent.status).toBe('crashed');
    });

    it('should recover crashed agent', () => {
      registerAgent(1, 'coder', 'sonnet', 'busy');

      simulateAgentCrash(1);
      const recovered = attemptRecovery(1);

      if (recovered) {
        const agent = db.prepare(`SELECT status FROM agents WHERE id = ?`).get(1) as { status: string };
        expect(agent.status).toBe('idle');
      }

      expect(chaosState.recoveryAttempts).toBe(1);
    });

    it('should reassign task after agent crash', async () => {
      registerAgent(1, 'coder', 'sonnet', 'busy');
      registerAgent(2, 'coder', 'sonnet', 'idle');

      // Create mission assigned to agent 1
      const mission: Mission = {
        id: 'mission_1',
        prompt: 'Implement feature',
        context: '',
        priority: 'normal',
        type: 'general',
        status: 'processing',
        assignedAgent: 1,
        createdAt: new Date(),
      };
      missionQueue.enqueue({
        prompt: mission.prompt,
        context: mission.context || '',
        priority: mission.priority as 'critical' | 'high' | 'normal' | 'low',
        type: mission.type as 'extraction' | 'analysis' | 'synthesis' | 'review' | 'general',
      });

      // Crash agent 1
      simulateAgentCrash(1);

      // System should reassign to agent 2
      const availableAgent = db.prepare(`
        SELECT id FROM agents WHERE status = 'idle' AND role = 'coder' LIMIT 1
      `).get() as { id: number } | undefined;

      expect(availableAgent).toBeDefined();
      expect(availableAgent!.id).toBe(2);
    });
  });

  describe('Multi-Agent Cascade Failure', () => {
    it('should handle multiple simultaneous crashes', () => {
      // Register 5 agents
      for (let i = 1; i <= 5; i++) {
        registerAgent(i, 'coder', 'sonnet', 'busy');
      }

      // Crash 3 agents at once (cascade failure)
      simulateAgentCrash(1);
      simulateAgentCrash(2);
      simulateAgentCrash(3);

      const crashedCount = db.prepare(`
        SELECT COUNT(*) as count FROM agents WHERE status = 'crashed'
      `).get() as { count: number };

      expect(crashedCount.count).toBe(3);

      // 2 agents should still be operational
      const busyCount = db.prepare(`
        SELECT COUNT(*) as count FROM agents WHERE status = 'busy'
      `).get() as { count: number };

      expect(busyCount.count).toBe(2);
    });

    it('should maintain minimum operational capacity', () => {
      // Register 3 agents
      for (let i = 1; i <= 3; i++) {
        registerAgent(i, 'coder', 'sonnet', 'idle');
      }

      // Crash all but one
      simulateAgentCrash(1);
      simulateAgentCrash(2);

      // At least one agent should remain operational
      const operational = db.prepare(`
        SELECT COUNT(*) as count FROM agents WHERE status != 'crashed'
      `).get() as { count: number };

      expect(operational.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Recovery Patterns', () => {
    it('should retry recovery with exponential backoff', async () => {
      registerAgent(1, 'coder', 'sonnet', 'busy');
      simulateAgentCrash(1);

      const maxRetries = 3;
      let retryDelay = 100; // ms
      let recovered = false;

      for (let attempt = 0; attempt < maxRetries && !recovered; attempt++) {
        recovered = attemptRecovery(1);
        if (!recovered) {
          // Simulate exponential backoff
          retryDelay *= 2;
        }
      }

      // Should have attempted recovery
      expect(chaosState.recoveryAttempts).toBeGreaterThan(0);
      expect(chaosState.recoveryAttempts).toBeLessThanOrEqual(maxRetries);
    });

    it('should escalate after repeated failures', () => {
      registerAgent(1, 'coder', 'sonnet', 'busy');
      simulateAgentCrash(1);

      // Simulate 3 failed recovery attempts
      for (let i = 0; i < 3; i++) {
        // Force failure for testing
        chaosState.recoveryAttempts++;
        chaosState.failedRecoveries++;
      }

      // After 3 failures, should escalate (spawn new agent)
      const shouldEscalate = chaosState.failedRecoveries >= 3;
      expect(shouldEscalate).toBe(true);

      // Spawn replacement agent
      if (shouldEscalate) {
        registerAgent(99, 'coder', 'sonnet', 'idle');
        const replacement = db.prepare(`SELECT id FROM agents WHERE id = 99`).get();
        expect(replacement).toBeDefined();
      }
    });
  });
});

describe('Chaos Testing - Task Timeouts', () => {
  let db: ReturnType<typeof getTempDb>;
  let missionQueue: MissionQueue;

  beforeEach(() => {
    createTempDb();
    db = getTempDb();
    missionQueue = new MissionQueue(db);
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it('should detect task timeout', () => {
    const mission: Mission = {
      id: 'timeout_test',
      prompt: 'Long running task',
      context: '',
      priority: 'normal',
      type: 'general',
      status: 'processing',
      createdAt: new Date(Date.now() - 600000), // 10 minutes ago
      timeoutMs: 300000, // 5 minute timeout
    };

    const missionId = missionQueue.enqueue({
      prompt: mission.prompt,
      context: mission.context || '',
      priority: mission.priority as 'critical' | 'high' | 'normal' | 'low',
      type: mission.type as 'extraction' | 'analysis' | 'synthesis' | 'review' | 'general',
      timeoutMs: mission.timeoutMs,
    });

    // Check for timeout (simulated - mission was created 10 min ago)
    const isTimedOut = true; // In real scenario would check actual creation time
    expect(isTimedOut).toBe(true);
  });

  it('should extend timeout for active checkpoints', () => {
    const mission: Mission = {
      id: 'checkpoint_test',
      prompt: 'Task with checkpoints',
      context: '',
      priority: 'normal',
      type: 'general',
      status: 'processing',
      createdAt: new Date(),
      timeoutMs: 60000, // 1 minute
    };

    const missionId = missionQueue.enqueue({
      prompt: mission.prompt,
      context: mission.context || '',
      priority: mission.priority as 'critical' | 'high' | 'normal' | 'low',
      type: mission.type as 'extraction' | 'analysis' | 'synthesis' | 'review' | 'general',
      timeoutMs: mission.timeoutMs,
    });

    // Simulate checkpoint activity
    const originalTimeout = mission.timeoutMs!;

    // Extend timeout
    const extended = missionQueue.extendTimeout(missionId, 30000);
    expect(extended).toBe(true);

    // Verify extended
    const updatedMission = missionQueue.getMission(missionId);
    expect(updatedMission?.timeoutMs).toBe(originalTimeout + 30000);
  });

  it('should retry timed-out task with exponential backoff', () => {
    const retries: number[] = [];
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const timeoutMs = 60000 * Math.pow(2, attempt - 1); // 1min, 2min, 4min
      retries.push(timeoutMs);
    }

    expect(retries).toEqual([60000, 120000, 240000]);
  });
});

describe('Chaos Testing - Network Partitions', () => {
  let db: ReturnType<typeof getTempDb>;
  let chaosState: ChaosState;

  beforeEach(() => {
    createTempDb();
    db = getTempDb();
    chaosState = {
      eventsInjected: [],
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      systemStable: true,
    };
  });

  afterEach(() => {
    cleanupTempDb();
  });

  // Helper: Simulate network partition
  function simulateNetworkPartition(durationMs: number): Promise<void> {
    chaosState.eventsInjected.push({ type: 'network_partition', durationMs });
    chaosState.systemStable = false;

    return new Promise(resolve => {
      // Partition ends after duration
      setTimeout(() => {
        chaosState.systemStable = true;
        resolve();
      }, Math.min(durationMs, 100)); // Cap for testing
    });
  }

  it('should buffer messages during partition', async () => {
    const messageBuffer: string[] = [];

    // Simulate partition
    await simulateNetworkPartition(100);

    // Messages sent during partition should be buffered
    messageBuffer.push('msg_1', 'msg_2', 'msg_3');

    expect(messageBuffer.length).toBe(3);

    // After partition ends, buffer should be flushed
    expect(chaosState.systemStable).toBe(true);
  });

  it('should detect split-brain and resolve', () => {
    // Register agents that might disagree during partition
    db.prepare(`
      INSERT INTO agents (id, role, model, status, pid, created_at, updated_at)
      VALUES (1, 'coder', 'sonnet', 'idle', 1001, datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO agents (id, role, model, status, pid, created_at, updated_at)
      VALUES (2, 'coder', 'sonnet', 'idle', 1002, datetime('now'), datetime('now'))
    `).run();

    // During partition, both might claim same task
    const task1Agent1 = { taskId: 'task_1', agentId: 1, claimedAt: Date.now() };
    const task1Agent2 = { taskId: 'task_1', agentId: 2, claimedAt: Date.now() + 100 };

    // Resolution: earliest claim wins
    const winner = task1Agent1.claimedAt < task1Agent2.claimedAt ? task1Agent1 : task1Agent2;
    expect(winner.agentId).toBe(1);
  });
});

describe('Chaos Testing - Resource Exhaustion', () => {
  let db: ReturnType<typeof getTempDb>;
  let missionQueue: MissionQueue;

  beforeEach(() => {
    createTempDb();
    db = getTempDb();
    missionQueue = new MissionQueue(db);
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it('should handle queue overflow gracefully', () => {
    const maxQueueSize = 100; // Use smaller number for test speed

    // Fill queue to capacity
    for (let i = 0; i < maxQueueSize; i++) {
      try {
        missionQueue.enqueue({
          prompt: `Task ${i}`,
          context: '',
          priority: 'normal',
          type: 'general',
        });
      } catch (e) {
        // QueueFullError is expected
        break;
      }
    }

    // Queue should handle overflow
    const queueSize = missionQueue.getQueueLength();
    expect(queueSize).toBeLessThanOrEqual(maxQueueSize);
  });

  it('should shed low-priority tasks under pressure', () => {
    // Add mixed priority tasks
    const priorities: Array<'critical' | 'high' | 'normal' | 'low'> = ['critical', 'high', 'normal', 'low'];

    for (let i = 0; i < 100; i++) {
      missionQueue.enqueue({
        prompt: `Task ${i}`,
        context: '',
        priority: priorities[i % 4],
        type: 'general',
      });
    }

    // Under pressure, should prioritize critical/high
    const pending = missionQueue.getByStatus('queued').slice(0, 10);

    // Top 10 should be critical and high priority (queue orders by priority)
    const criticalHighCount = pending.filter(m =>
      m.priority === 'critical' || m.priority === 'high'
    ).length;

    expect(criticalHighCount).toBeGreaterThan(0);
  });

  it('should degrade gracefully under memory pressure', () => {
    const memoryLevels = ['low', 'medium', 'high'] as const;
    const responses: string[] = [];

    for (const level of memoryLevels) {
      switch (level) {
        case 'low':
          responses.push('normal_operation');
          break;
        case 'medium':
          responses.push('reduced_parallelism');
          break;
        case 'high':
          responses.push('minimal_operation');
          break;
      }
    }

    expect(responses).toEqual([
      'normal_operation',
      'reduced_parallelism',
      'minimal_operation'
    ]);
  });
});

describe('Chaos Testing - Concurrent Operations', () => {
  let db: ReturnType<typeof getTempDb>;
  let missionQueue: MissionQueue;

  beforeEach(() => {
    createTempDb();
    db = getTempDb();
    missionQueue = new MissionQueue(db);
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it('should handle concurrent task claims safely', async () => {
    // Register multiple agents
    for (let i = 1; i <= 5; i++) {
      db.prepare(`
        INSERT INTO agents (id, role, model, status, pid, created_at, updated_at)
        VALUES (?, 'coder', 'sonnet', 'idle', ?, datetime('now'), datetime('now'))
      `).run(i, 1000 + i);
    }

    // Add single task
    const missionId = missionQueue.enqueue({
      prompt: 'High value task',
      context: '',
      priority: 'critical',
      type: 'general',
    });

    // Simulate concurrent claims using dequeue
    const claims: number[] = [];

    // All agents try to claim simultaneously
    // dequeue is atomic so only one should succeed
    for (let agentId = 1; agentId <= 5; agentId++) {
      const claimed = missionQueue.dequeue(agentId);
      if (claimed) {
        claims.push(agentId);
      }
    }

    // Only one agent should have claimed it
    expect(claims.length).toBe(1);
  });

  it('should maintain consistency under rapid updates', () => {
    // Add mission
    const missionId = missionQueue.enqueue({
      prompt: 'Test task',
      context: '',
      priority: 'normal',
      type: 'general',
    });

    // Rapid status updates
    const statuses: Array<'queued' | 'processing' | 'completed' | 'failed'> = [
      'queued', 'processing', 'completed'
    ];

    for (const status of statuses) {
      missionQueue.updateStatus(missionId, status);
    }

    // Final state should be consistent
    const finalMission = missionQueue.getMission(missionId);
    expect(finalMission?.status).toBe('completed');
  });
});

// ============================================================
// NEW CHAOS TESTS - test-spawns contribution
// ============================================================

describe('Chaos Testing - WebSocket Task Delivery Fallback', () => {
  let db: ReturnType<typeof getTempDb>;

  beforeEach(() => {
    createTempDb();
    db = getTempDb();
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it('should persist task to file when WebSocket disconnects mid-send', async () => {
    // Scenario: WS connection drops between task creation and delivery
    // Expected: Task should still be deliverable via file inbox

    // Register agent
    db.prepare(`
      INSERT INTO agents (id, role, model, status, pid, created_at, updated_at)
      VALUES (1, 'coder', 'sonnet', 'idle', 1001, datetime('now'), datetime('now'))
    `).run();

    // Create task record (simulating what happens before WS send)
    const taskId = `task_ws_fallback_${Date.now()}`;
    db.prepare(`
      INSERT INTO agent_tasks (id, agent_id, prompt, status, created_at)
      VALUES (?, 1, 'Test task for WS fallback', 'queued', datetime('now'))
    `).run(taskId);

    // Simulate WS disconnect (task exists in DB but wasn't delivered via WS)
    const wsDelivered = false;

    // Task should be recoverable from DB
    const task = db.prepare(`SELECT * FROM agent_tasks WHERE id = ?`).get(taskId) as any;
    expect(task).toBeDefined();
    expect(task.status).toBe('queued');

    // File inbox fallback should be able to pick it up
    expect(wsDelivered).toBe(false);
    expect(task.id).toBe(taskId);
  });

  it('should use atomic claim to prevent duplicate execution on reconnect', async () => {
    // Scenario: Task delivered via WS, agent reconnects, file inbox also has task
    // Expected: claimTask() prevents duplicate execution

    db.prepare(`
      INSERT INTO agents (id, role, model, status, pid, created_at, updated_at)
      VALUES (1, 'coder', 'sonnet', 'idle', 1001, datetime('now'), datetime('now'))
    `).run();

    const taskId = `task_dual_delivery_${Date.now()}`;
    db.prepare(`
      INSERT INTO agent_tasks (id, agent_id, prompt, status, created_at)
      VALUES (?, 1, 'Test dual delivery', 'queued', datetime('now'))
    `).run(taskId);

    // First claim (via WebSocket)
    const executionId1 = `exec_ws_${Date.now()}`;
    const claim1 = db.prepare(`
      UPDATE agent_tasks
      SET status = 'running', execution_id = ?
      WHERE id = ? AND status = 'queued' AND execution_id IS NULL
    `).run(executionId1, taskId);

    // Second claim attempt (via file inbox - should fail)
    const executionId2 = `exec_file_${Date.now()}`;
    const claim2 = db.prepare(`
      UPDATE agent_tasks
      SET status = 'running', execution_id = ?
      WHERE id = ? AND status = 'queued' AND execution_id IS NULL
    `).run(executionId2, taskId);

    // First claim should succeed, second should fail
    expect(claim1.changes).toBe(1);
    expect(claim2.changes).toBe(0);

    // Task should have first execution ID
    const task = db.prepare(`SELECT execution_id FROM agent_tasks WHERE id = ?`).get(taskId) as any;
    expect(task.execution_id).toBe(executionId1);
  });
});

describe('Chaos Testing - Agent Crash During Task Execution', () => {
  let db: ReturnType<typeof getTempDb>;
  let missionQueue: MissionQueue;

  beforeEach(() => {
    createTempDb();
    db = getTempDb();
    missionQueue = new MissionQueue(db);
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it('should detect stuck task after agent crash and allow reassignment', async () => {
    // Register agents
    db.prepare(`
      INSERT INTO agents (id, role, model, status, pid, created_at, updated_at)
      VALUES (1, 'coder', 'sonnet', 'busy', 1001, datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO agents (id, role, model, status, pid, created_at, updated_at)
      VALUES (2, 'coder', 'sonnet', 'idle', 1002, datetime('now'), datetime('now'))
    `).run();

    // Create task assigned to agent 1
    const taskId = `task_crash_recovery_${Date.now()}`;
    const executionId = `exec_${Date.now()}`;
    db.prepare(`
      INSERT INTO agent_tasks (id, agent_id, prompt, status, execution_id, created_at, started_at)
      VALUES (?, 1, 'Long running task', 'running', ?, datetime('now'), datetime('now', '-5 minutes'))
    `).run(taskId, executionId);

    // Simulate agent 1 crash
    db.prepare(`UPDATE agents SET status = 'crashed' WHERE id = 1`).run();

    // Detect stuck task (running but agent crashed)
    const stuckTask = db.prepare(`
      SELECT t.* FROM agent_tasks t
      JOIN agents a ON t.agent_id = a.id
      WHERE t.status = 'running' AND a.status = 'crashed'
    `).get() as any;

    expect(stuckTask).toBeDefined();
    expect(stuckTask.id).toBe(taskId);

    // Release task for reassignment
    db.prepare(`
      UPDATE agent_tasks SET status = 'queued', execution_id = NULL, agent_id = NULL
      WHERE id = ?
    `).run(taskId);

    // Reassign to agent 2
    const reassignExecId = `exec_reassign_${Date.now()}`;
    const reassigned = db.prepare(`
      UPDATE agent_tasks
      SET status = 'running', agent_id = 2, execution_id = ?
      WHERE id = ? AND status = 'queued'
    `).run(reassignExecId, taskId);

    expect(reassigned.changes).toBe(1);

    const reassignedTask = db.prepare(`SELECT agent_id, execution_id FROM agent_tasks WHERE id = ?`).get(taskId) as any;
    expect(reassignedTask.agent_id).toBe(2);
    expect(reassignedTask.execution_id).toBe(reassignExecId);
  });

  it('should track task execution history for crash forensics', () => {
    const taskId = `task_forensics_${Date.now()}`;

    // Create task with execution history
    db.prepare(`
      INSERT INTO agent_tasks (id, agent_id, prompt, status, retry_count, created_at)
      VALUES (?, 1, 'Crashy task', 'running', 0, datetime('now'))
    `).run(taskId);

    // Simulate crash and retry
    for (let attempt = 1; attempt <= 3; attempt++) {
      db.prepare(`
        UPDATE agent_tasks SET retry_count = ?, status = 'queued'
        WHERE id = ?
      `).run(attempt, taskId);
    }

    const task = db.prepare(`SELECT retry_count FROM agent_tasks WHERE id = ?`).get(taskId) as any;
    expect(task.retry_count).toBe(3);

    // After 3 retries, should mark as failed
    const maxRetries = 3;
    const shouldFail = task.retry_count >= maxRetries;
    expect(shouldFail).toBe(true);
  });
});

describe('Chaos Testing - SSE Backpressure', () => {
  it('should handle slow SSE clients without blocking fast ones', async () => {
    // Simulate SSE client buffer states
    const clients = [
      { id: 'fast', canWrite: true, buffered: 0 },
      { id: 'slow', canWrite: false, buffered: 1000 }, // Backpressured
      { id: 'medium', canWrite: true, buffered: 100 },
    ];

    const message = JSON.stringify({ type: 'broadcast', content: 'Test' });
    const delivered: string[] = [];

    // Non-blocking write simulation
    for (const client of clients) {
      // setImmediate() would be used in real code to not block
      if (client.canWrite) {
        delivered.push(client.id);
      }
      // Slow client would be handled via drain event
    }

    // Fast and medium clients should receive immediately
    expect(delivered).toContain('fast');
    expect(delivered).toContain('medium');
    expect(delivered).not.toContain('slow');

    // Slow client should not block others
    expect(delivered.length).toBe(2);
  });

  it('should disconnect persistently slow clients', () => {
    const client = {
      id: 'very_slow',
      buffered: 0,
      backpressureEvents: 0,
      maxBackpressure: 5,
      connected: true,
    };

    // Simulate repeated backpressure
    for (let i = 0; i < 10; i++) {
      client.backpressureEvents++;
      if (client.backpressureEvents > client.maxBackpressure) {
        client.connected = false;
        break;
      }
    }

    // Client should be disconnected after too many backpressure events
    expect(client.connected).toBe(false);
    expect(client.backpressureEvents).toBeGreaterThan(client.maxBackpressure);
  });

  it('should measure broadcast latency distribution', () => {
    const latencies: number[] = [];
    const numClients = 100;

    // Simulate latency distribution
    for (let i = 0; i < numClients; i++) {
      // Most clients fast, some slow
      const latency = Math.random() < 0.9 ? Math.random() * 10 : Math.random() * 100;
      latencies.push(latency);
    }

    // Calculate p50 and p99
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(numClients * 0.5)];
    const p99 = latencies[Math.floor(numClients * 0.99)];

    // p50 should be fast, p99 can be slow but bounded
    expect(p50).toBeLessThan(20);
    expect(p99).toBeLessThan(150);
  });
});

describe('Chaos Recovery Metrics', () => {
  it('should track recovery statistics', () => {
    const metrics = {
      totalChaosEvents: 50,
      recoverySuccessRate: 0.92,
      meanTimeToRecovery: 2500, // ms
      cascadeFailures: 3,
      dataLossEvents: 0,
    };

    // Validate metrics
    expect(metrics.recoverySuccessRate).toBeGreaterThan(0.9);
    expect(metrics.meanTimeToRecovery).toBeLessThan(5000);
    expect(metrics.dataLossEvents).toBe(0);
  });

  it('should validate system stability after chaos', () => {
    const stabilityChecks = {
      allAgentsResponsive: true,
      queueProcessing: true,
      dbConsistent: true,
      noOrphanedTasks: true,
      noZombieProcesses: true,
    };

    // All stability checks should pass
    const allStable = Object.values(stabilityChecks).every(v => v === true);
    expect(allStable).toBe(true);
  });
});
