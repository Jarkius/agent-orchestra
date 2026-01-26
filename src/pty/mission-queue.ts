/**
 * Mission Queue - Self-correcting task queue with retry, timeout, and dependencies
 * Implements IMissionQueue interface for Expert Multi-Agent Orchestration
 *
 * Persistence: Missions are persisted to SQLite and survive restarts.
 */

import type {
  IMissionQueue,
  Mission,
  MissionResult,
  MissionStatus,
  Priority,
  ErrorContext,
} from '../interfaces/mission';
import { calculateBackoff, isRecoverable } from '../interfaces/mission';
import { randomUUID } from 'crypto';
import { saveMission, loadPendingMissions, updateMissionStatus, atomicDequeueWithExecutionId, type MissionRecord } from '../db';
import { missionLogger as log } from '../utils/logger';
import { hasRecentCheckpoint } from '../ws-server';

// Queue backpressure configuration
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || '1000');

export class QueueFullError extends Error {
  constructor(queueSize: number, maxSize: number) {
    super(`Queue full: ${queueSize}/${maxSize} missions. Apply backpressure.`);
    this.name = 'QueueFullError';
  }
}

export class MissionQueue implements IMissionQueue {
  private missions: Map<string, Mission> = new Map();
  private queue: string[] = []; // Mission IDs in priority order
  private waitTimes: Map<string, number> = new Map();
  private timeoutChecker: Timer | null = null;

  private priorityOrder: Record<Priority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };

  enqueue(mission: Omit<Mission, 'id' | 'status' | 'createdAt' | 'retryCount'>): string {
    // Backpressure: reject if queue is full
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      log.error(`Queue full, rejecting mission`, { queueSize: this.queue.length, maxSize: MAX_QUEUE_SIZE, priority: mission.priority });
      throw new QueueFullError(this.queue.length, MAX_QUEUE_SIZE);
    }

    const id = `mission_${randomUUID().slice(0, 8)}`;
    const now = new Date();

    const fullMission: Mission = {
      ...mission,
      id,
      status: 'pending',
      createdAt: now,
      retryCount: 0,
    };

    this.missions.set(id, fullMission);
    this.waitTimes.set(id, Date.now());

    // Insert in priority order
    this.insertByPriority(id, mission.priority);

    // Check if blocked by dependencies
    if (mission.dependsOn && mission.dependsOn.length > 0) {
      if (!this.areDependenciesMet(mission.dependsOn)) {
        fullMission.status = 'blocked';
      }
    }

    if (fullMission.status !== 'blocked') {
      fullMission.status = 'queued';
    }

    // Persist to SQLite
    this.persistMission(fullMission);

    return id;
  }

  dequeue(agentId: number): Mission | null {
    // Find first ready mission
    for (const missionId of this.queue) {
      const mission = this.missions.get(missionId);
      if (!mission) continue;

      if (mission.status === 'queued' && this.isReady(missionId)) {
        // Generate unique execution ID for idempotency
        const executionId = `exec_${randomUUID().slice(0, 12)}`;

        // Atomic dequeue with execution ID - prevents duplicate execution on crash recovery
        const result = atomicDequeueWithExecutionId(missionId, agentId, executionId);

        if (!result.success) {
          // Mission was already dequeued by another process or has existing execution
          log.warn(`Atomic dequeue failed`, { missionId, error: result.error });
          continue;
        }

        // Update in-memory state
        mission.status = 'running';
        mission.startedAt = new Date();
        mission.assignedTo = agentId;
        (mission as any).executionId = result.executionId;

        // Remove from queue
        this.queue = this.queue.filter(id => id !== missionId);

        // Calculate wait time
        const startWait = this.waitTimes.get(missionId);
        if (startWait) {
          this.waitTimes.set(missionId, Date.now() - startWait);
        }

        return mission;
      }
    }

    return null;
  }

  peek(): Mission | null {
    for (const missionId of this.queue) {
      const mission = this.missions.get(missionId);
      if (mission && mission.status === 'queued' && this.isReady(missionId)) {
        return mission;
      }
    }
    return null;
  }

  setPriority(missionId: string, priority: Priority): void {
    const mission = this.missions.get(missionId);
    if (!mission) return;

    const oldPriority = mission.priority;
    mission.priority = priority;

    // Re-sort queue if needed
    if (this.priorityOrder[priority] !== this.priorityOrder[oldPriority]) {
      this.queue = this.queue.filter(id => id !== missionId);
      this.insertByPriority(missionId, priority);
    }
  }

  getByPriority(priority: Priority): Mission[] {
    return Array.from(this.missions.values())
      .filter(m => m.priority === priority);
  }

  retry(missionId: string, reason: string): void {
    const mission = this.missions.get(missionId);
    if (!mission) return;

    if (mission.retryCount >= mission.maxRetries) {
      // Max retries exceeded
      this.fail(missionId, {
        code: 'unknown',
        message: `Max retries (${mission.maxRetries}) exceeded: ${reason}`,
        recoverable: false,
        timestamp: new Date(),
      });
      return;
    }

    mission.retryCount++;
    mission.status = 'retrying';

    // Calculate backoff delay
    const delay = mission.retryDelayMs || calculateBackoff(mission.retryCount);
    mission.retryDelayMs = delay;

    // Persist retry status
    updateMissionStatus(missionId, 'retrying', {
      retryCount: mission.retryCount,
    });

    // Re-queue after delay
    setTimeout(() => {
      if (mission.status === 'retrying') {
        mission.status = 'queued';
        mission.assignedTo = undefined;
        mission.startedAt = undefined;
        this.insertByPriority(missionId, mission.priority);

        // Persist queued status
        updateMissionStatus(missionId, 'queued');
      }
    }, delay);
  }

  getRetryCount(missionId: string): number {
    return this.missions.get(missionId)?.retryCount || 0;
  }

  setRetryDelay(missionId: string, delayMs: number): void {
    const mission = this.missions.get(missionId);
    if (mission) {
      mission.retryDelayMs = delayMs;
    }
  }

  addDependency(missionId: string, dependsOn: string): void {
    const mission = this.missions.get(missionId);
    if (!mission) return;

    if (!mission.dependsOn) {
      mission.dependsOn = [];
    }
    if (!mission.dependsOn.includes(dependsOn)) {
      mission.dependsOn.push(dependsOn);
    }

    // Update status if now blocked
    if (!this.areDependenciesMet(mission.dependsOn) && mission.status === 'queued') {
      mission.status = 'blocked';
    }
  }

  removeDependency(missionId: string, dependsOn: string): void {
    const mission = this.missions.get(missionId);
    if (!mission || !mission.dependsOn) return;

    mission.dependsOn = mission.dependsOn.filter(d => d !== dependsOn);

    // Check if can unblock
    if (mission.status === 'blocked' && this.areDependenciesMet(mission.dependsOn)) {
      mission.status = 'queued';
    }
  }

  isReady(missionId: string): boolean {
    const mission = this.missions.get(missionId);
    if (!mission) return false;

    if (!mission.dependsOn || mission.dependsOn.length === 0) {
      return true;
    }

    return this.areDependenciesMet(mission.dependsOn);
  }

  getBlocked(): Mission[] {
    return Array.from(this.missions.values())
      .filter(m => m.status === 'blocked');
  }

  getMission(missionId: string): Mission | null {
    return this.missions.get(missionId) || null;
  }

  getByStatus(status: MissionStatus): Mission[] {
    return Array.from(this.missions.values())
      .filter(m => m.status === status);
  }

  updateStatus(missionId: string, status: MissionStatus, error?: ErrorContext): void {
    const mission = this.missions.get(missionId);
    if (!mission) return;

    mission.status = status;
    if (error) {
      mission.error = error;
    }
  }

  complete(missionId: string, result: MissionResult): void {
    const mission = this.missions.get(missionId);
    if (!mission) return;

    mission.status = 'completed';
    mission.result = result;
    mission.completedAt = new Date();

    // Persist completion
    updateMissionStatus(missionId, 'completed', {
      result,
      completedAt: mission.completedAt,
    });

    // Unblock dependent missions
    this.unblockDependents(missionId);
  }

  fail(missionId: string, error: ErrorContext): void {
    const mission = this.missions.get(missionId);
    if (!mission) return;

    // Check if recoverable and can retry
    if (error.recoverable && mission.retryCount < mission.maxRetries) {
      this.retry(missionId, error.message);
      return;
    }

    mission.status = 'failed';
    mission.error = error;
    mission.completedAt = new Date();

    // Persist failure
    updateMissionStatus(missionId, 'failed', {
      error,
      completedAt: mission.completedAt,
    });
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getAverageWaitTime(): number {
    const completedWaits = Array.from(this.waitTimes.values())
      .filter(w => w > 0);

    if (completedWaits.length === 0) return 0;

    const total = completedWaits.reduce((a, b) => a + b, 0);
    return total / completedWaits.length;
  }

  // Private helpers

  private insertByPriority(missionId: string, priority: Priority): void {
    const order = this.priorityOrder[priority];

    // Find insertion point
    let insertIndex = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      const existingMission = this.missions.get(this.queue[i]!);
      if (existingMission) {
        const existingOrder = this.priorityOrder[existingMission.priority];
        if (order < existingOrder) {
          insertIndex = i;
          break;
        }
      }
    }

    this.queue.splice(insertIndex, 0, missionId);
  }

  private areDependenciesMet(dependsOn: string[]): boolean {
    for (const depId of dependsOn) {
      const dep = this.missions.get(depId);
      if (!dep || dep.status !== 'completed') {
        return false;
      }
    }
    return true;
  }

  private unblockDependents(completedId: string): void {
    for (const mission of this.missions.values()) {
      if (mission.status === 'blocked' && mission.dependsOn?.includes(completedId)) {
        if (this.areDependenciesMet(mission.dependsOn)) {
          mission.status = 'queued';
        }
      }
    }
  }

  // Extend timeout for a mission (adaptive timeout based on checkpoints)
  extendTimeout(missionId: string, additionalMs: number): boolean {
    const mission = this.missions.get(missionId);
    if (!mission) return false;

    mission.timeoutMs += additionalMs;
    log.info(`Extended timeout`, { missionId, additionalMs, newTimeout: mission.timeoutMs });
    return true;
  }

  // Start background timeout enforcement
  startTimeoutEnforcement(checkIntervalMs: number = 5000): void {
    if (this.timeoutChecker) return; // Already running

    this.timeoutChecker = setInterval(() => {
      const now = Date.now();

      for (const mission of this.missions.values()) {
        if (mission.status === 'running' && mission.startedAt) {
          const elapsed = now - mission.startedAt.getTime();

          // Adaptive timeout: Check if agent has recent checkpoint activity
          // If agent is making progress (checkpoint within last 60s), extend timeout
          if (hasRecentCheckpoint(mission.id, 60000)) {
            // Agent is actively working - don't timeout yet
            if (elapsed > mission.timeoutMs - 30000) {
              // Getting close to timeout, but agent is active - extend
              this.extendTimeout(mission.id, 60000);
              log.info(`Auto-extended timeout due to checkpoint activity`, { missionId: mission.id });
            }
            continue;
          }

          if (elapsed > mission.timeoutMs) {
            this.fail(mission.id, {
              code: 'timeout',
              message: `Mission timed out after ${mission.timeoutMs}ms (elapsed: ${elapsed}ms)`,
              recoverable: true,
              timestamp: new Date(),
            });
          }
        }
      }
    }, checkIntervalMs);
  }

  // Stop timeout enforcement
  stopTimeoutEnforcement(): void {
    if (this.timeoutChecker) {
      clearInterval(this.timeoutChecker);
      this.timeoutChecker = null;
    }
  }

  // Clear completed/failed missions older than given age
  cleanup(olderThanMs: number = 3600000): void {
    const now = Date.now();

    for (const [id, mission] of this.missions) {
      if (mission.status === 'completed' || mission.status === 'failed') {
        if (mission.completedAt && now - mission.completedAt.getTime() > olderThanMs) {
          this.missions.delete(id);
          this.waitTimes.delete(id);
        }
      }
    }
  }

  // Get all missions (for debugging/monitoring)
  getAllMissions(): Mission[] {
    return Array.from(this.missions.values());
  }

  // Get queue metrics for monitoring/observability
  getMetrics(): {
    queueDepth: number;
    maxQueueSize: number;
    utilization: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    averageWaitTimeMs: number;
  } {
    const missions = Array.from(this.missions.values());
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const m of missions) {
      byStatus[m.status] = (byStatus[m.status] || 0) + 1;
      byPriority[m.priority] = (byPriority[m.priority] || 0) + 1;
    }

    return {
      queueDepth: this.queue.length,
      maxQueueSize: MAX_QUEUE_SIZE,
      utilization: this.queue.length / MAX_QUEUE_SIZE,
      byStatus,
      byPriority,
      averageWaitTimeMs: this.getAverageWaitTime(),
    };
  }

  // Persist mission to SQLite
  private persistMission(mission: Mission): void {
    saveMission({
      id: mission.id,
      prompt: mission.prompt,
      context: mission.context,
      priority: mission.priority,
      type: mission.type,
      status: mission.status,
      timeoutMs: mission.timeoutMs,
      maxRetries: mission.maxRetries,
      retryCount: mission.retryCount,
      dependsOn: mission.dependsOn,
      assignedTo: mission.assignedTo,
      error: mission.error,
      result: mission.result,
      createdAt: mission.createdAt,
      startedAt: mission.startedAt,
      completedAt: mission.completedAt,
      unified_task_id: mission.unified_task_id,
    });
  }

  // Load missions from SQLite (for startup recovery)
  loadFromDb(): number {
    const records = loadPendingMissions();
    let loaded = 0;

    for (const record of records) {
      // Skip if already in memory
      if (this.missions.has(record.id)) continue;

      const mission: Mission = {
        id: record.id,
        prompt: record.prompt,
        context: record.context || undefined,
        priority: record.priority as Priority,
        type: record.type as Mission['type'],
        status: record.status as MissionStatus,
        timeoutMs: record.timeout_ms,
        maxRetries: record.max_retries,
        retryCount: record.retry_count,
        dependsOn: record.depends_on ? JSON.parse(record.depends_on) : undefined,
        assignedTo: record.assigned_to || undefined,
        error: record.error ? JSON.parse(record.error) : undefined,
        result: record.result ? JSON.parse(record.result) : undefined,
        createdAt: new Date(record.created_at),
        startedAt: record.started_at ? new Date(record.started_at) : undefined,
        completedAt: record.completed_at ? new Date(record.completed_at) : undefined,
      };

      this.missions.set(mission.id, mission);

      // Add to queue if queued or blocked
      if (mission.status === 'queued' || mission.status === 'blocked') {
        this.insertByPriority(mission.id, mission.priority);
      }

      // Running missions that were interrupted should be retried
      // Clear execution_id so it gets a fresh one on next dequeue
      if (mission.status === 'running') {
        log.info(`Recovering interrupted mission`, { missionId: mission.id, previousExecutionId: record.execution_id || 'none' });
        mission.status = 'queued';
        mission.assignedTo = undefined;
        mission.startedAt = undefined;
        (mission as any).executionId = undefined;
        this.insertByPriority(mission.id, mission.priority);
        // Pass null to clear execution_id so the mission gets a fresh one on next dequeue
        updateMissionStatus(mission.id, 'queued', { executionId: null });
      }

      loaded++;
    }

    return loaded;
  }
}

// Singleton instance
let instance: MissionQueue | null = null;

export function getMissionQueue(): MissionQueue {
  if (!instance) {
    instance = new MissionQueue();
    // Load any pending missions from previous session
    const loaded = instance.loadFromDb();
    if (loaded > 0) {
      log.info(`Recovered missions from database`, { count: loaded });
    }
    instance.startTimeoutEnforcement(); // Auto-start timeout enforcement
  }
  return instance;
}

export default MissionQueue;
