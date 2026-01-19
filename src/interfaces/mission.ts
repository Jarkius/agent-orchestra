/**
 * Mission Queue Interface
 * Self-correcting task queue with retry, timeout, and dependencies
 */

export type MissionStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'retrying' | 'blocked' | 'cancelled';
export type Priority = 'critical' | 'high' | 'normal' | 'low';
export type ErrorCode = 'timeout' | 'crash' | 'validation' | 'resource' | 'auth' | 'rate_limit' | 'unknown';

export interface ErrorContext {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  timestamp: Date;
  retryAfterMs?: number;
  stackTrace?: string;
}

export interface Mission {
  id: string;
  prompt: string;
  context?: string;
  priority: Priority;
  type?: 'extraction' | 'analysis' | 'synthesis' | 'review' | 'general';
  timeoutMs: number;
  maxRetries: number;
  retryCount: number;
  retryDelayMs?: number;
  dependsOn?: string[];
  assignedTo?: number;
  status: MissionStatus;
  error?: ErrorContext;
  result?: MissionResult;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface MissionResult {
  output: string;
  durationMs: number;
  tokenUsage?: {
    input: number;
    output: number;
  };
  artifacts?: string[];
}

export interface IMissionQueue {
  // Queue operations
  enqueue(mission: Omit<Mission, 'id' | 'status' | 'createdAt' | 'retryCount'>): string;
  dequeue(agentId: number): Mission | null;
  peek(): Mission | null;

  // Priority
  setPriority(missionId: string, priority: Priority): void;
  getByPriority(priority: Priority): Mission[];

  // Retry
  retry(missionId: string, reason: string): void;
  getRetryCount(missionId: string): number;
  setRetryDelay(missionId: string, delayMs: number): void;

  // Dependencies
  addDependency(missionId: string, dependsOn: string): void;
  removeDependency(missionId: string, dependsOn: string): void;
  isReady(missionId: string): boolean;
  getBlocked(): Mission[];

  // Status
  getMission(missionId: string): Mission | null;
  getByStatus(status: MissionStatus): Mission[];
  updateStatus(missionId: string, status: MissionStatus, error?: ErrorContext): void;
  complete(missionId: string, result: MissionResult): void;
  fail(missionId: string, error: ErrorContext): void;

  // Metrics
  getQueueLength(): number;
  getAverageWaitTime(): number;
}

// Exponential backoff calculation
export function calculateBackoff(retryCount: number, baseDelayMs: number = 1000, maxDelayMs: number = 60000): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, retryCount), maxDelayMs);
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

// Check if error is recoverable
export function isRecoverable(code: ErrorCode): boolean {
  return ['timeout', 'rate_limit', 'resource'].includes(code);
}
