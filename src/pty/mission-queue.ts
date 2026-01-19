/**
 * Mission Queue - Self-correcting task queue with retry, timeout, and dependencies
 * Implements IMissionQueue interface for Expert Multi-Agent Orchestration
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

    return id;
  }

  dequeue(agentId: number): Mission | null {
    // Find first ready mission
    for (const missionId of this.queue) {
      const mission = this.missions.get(missionId);
      if (!mission) continue;

      if (mission.status === 'queued' && this.isReady(missionId)) {
        mission.status = 'running';
        mission.startedAt = new Date();
        mission.assignedTo = agentId;

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

    // Re-queue after delay
    setTimeout(() => {
      if (mission.status === 'retrying') {
        mission.status = 'queued';
        mission.assignedTo = undefined;
        mission.startedAt = undefined;
        this.insertByPriority(missionId, mission.priority);
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

  // Start background timeout enforcement
  startTimeoutEnforcement(checkIntervalMs: number = 5000): void {
    if (this.timeoutChecker) return; // Already running

    this.timeoutChecker = setInterval(() => {
      const now = Date.now();

      for (const mission of this.missions.values()) {
        if (mission.status === 'running' && mission.startedAt) {
          const elapsed = now - mission.startedAt.getTime();
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
}

// Singleton instance
let instance: MissionQueue | null = null;

export function getMissionQueue(): MissionQueue {
  if (!instance) {
    instance = new MissionQueue();
    instance.startTimeoutEnforcement(); // Auto-start timeout enforcement
  }
  return instance;
}

export default MissionQueue;
