/**
 * PTY Manager Interface
 * Platform-aware pseudo-terminal management for agent spawning
 */

export type AgentStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed' | 'idle' | 'busy' | 'working' | 'error';

export interface PTYHandle {
  agentId: number;
  pid: number;
  paneId: string;
  status: AgentStatus;
  startedAt: Date;
  lastHeartbeat?: Date;
}

export interface HealthStatus {
  alive: boolean;
  responsive: boolean;
  lastHeartbeat: Date;
  memoryUsage?: number;
  cpuUsage?: number;
  idleTimeMs?: number;
}

export interface AgentEvent {
  type: 'spawn' | 'crash' | 'restart' | 'task_start' | 'task_complete' | 'task_fail' | 'health' | 'idle' | 'busy';
  agentId: number;
  timestamp: Date;
  data?: Record<string, unknown>;
}

export interface IPTYManager {
  // Lifecycle
  spawn(agentId: number, config?: PTYConfig): Promise<PTYHandle>;
  kill(agentId: number, signal?: 'SIGTERM' | 'SIGKILL'): Promise<void>;
  restart(agentId: number): Promise<PTYHandle>;

  // Health
  healthCheck(agentId: number): Promise<HealthStatus>;
  watchAll(): AsyncGenerator<AgentEvent>;

  // Query
  getHandle(agentId: number): PTYHandle | null;
  getAllHandles(): PTYHandle[];

  // Platform
  getPlatform(): 'darwin' | 'linux' | 'win32';
  isSupported(): boolean;
}

export interface PTYConfig {
  cwd?: string;
  env?: Record<string, string>;
  shell?: string;
  cols?: number;
  rows?: number;
  healthCheckIntervalMs?: number;
  autoRestart?: boolean;
}
