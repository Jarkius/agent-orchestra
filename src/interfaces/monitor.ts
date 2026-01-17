/**
 * Status Monitor Interface
 * Real-time agent monitoring with alerts and metrics
 */

import type { AgentEvent, HealthStatus } from './pty';
import type { Agent } from './spawner';
import type { Mission, MissionStatus } from './mission';

export type AlertType = 'agent_down' | 'task_timeout' | 'queue_backlog' | 'memory_high' | 'error_rate' | 'agent_idle';

export interface AlertCondition {
  type: AlertType;
  threshold: number;
  windowMs: number;
  cooldownMs?: number;
}

export interface Alert {
  id: string;
  condition: AlertCondition;
  triggeredAt: Date;
  resolvedAt?: Date;
  data: Record<string, unknown>;
}

export type AlertHandler = (alert: Alert) => void | Promise<void>;
export type Unsubscribe = () => void;

export interface AgentMetrics {
  agentId: number;
  tasksCompleted: number;
  tasksFailed: number;
  averageTaskDurationMs: number;
  successRate: number;
  uptimeMs: number;
  idleTimeMs: number;
  lastActivity: Date;
}

export interface SystemMetrics {
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
  errorAgents: number;
  queueLength: number;
  averageWaitTime: number;
  totalTasksCompleted: number;
  totalTasksFailed: number;
  systemSuccessRate: number;
  uptimeMs: number;
}

export interface SystemSnapshot {
  timestamp: Date;
  agents: Agent[];
  missions: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
  metrics: SystemMetrics;
  activeAlerts: Alert[];
}

export interface IStatusMonitor {
  // Real-time events
  subscribe(callback: (event: AgentEvent) => void): Unsubscribe;
  getSnapshot(): SystemSnapshot;
  getRecentEvents(limit?: number): AgentEvent[];

  // Health
  checkHealth(agentId: number): Promise<HealthStatus>;
  checkAllHealth(): Promise<Map<number, HealthStatus>>;

  // Alerts
  setAlert(condition: AlertCondition, handler: AlertHandler): string;
  removeAlert(alertId: string): void;
  getActiveAlerts(): Alert[];
  resolveAlert(alertId: string): void;

  // Metrics
  getAgentMetrics(agentId: number): AgentMetrics;
  getSystemMetrics(): SystemMetrics;
  getMetricsHistory(windowMs: number): SystemMetrics[];

  // Dashboard
  renderDashboard(): string;
  logEvent(event: AgentEvent): void;
}

// ANSI color codes for dashboard
export const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Status icons
export const STATUS_ICONS: Record<string, string> = {
  running: '🟢',
  idle: '⚪',
  busy: '🔵',
  working: '🔄',
  error: '🔴',
  crashed: '💀',
  stopped: '⬛',
};
