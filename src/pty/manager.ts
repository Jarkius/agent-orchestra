/**
 * PTY Manager - Platform-aware pseudo-terminal management
 * Handles agent spawning, health checks, and auto-restart in tmux
 */

import { $ } from 'bun';
import type { IPTYManager, PTYHandle, PTYConfig, HealthStatus, AgentEvent, AgentStatus } from '../interfaces/pty';
import { getWorktreeManager } from './worktree-manager';

const DEFAULT_CONFIG: Required<Omit<PTYConfig, 'worktree'>> & { worktree: undefined } = {
  cwd: process.cwd(),
  env: {},
  shell: '/bin/zsh',
  cols: 120,
  rows: 30,
  healthCheckIntervalMs: 5000,
  autoRestart: true,
  worktree: undefined,
};

export class PTYManager implements IPTYManager {
  private handles: Map<number, PTYHandle> = new Map();
  private sessionName: string;
  private healthCheckTimers: Map<number, Timer> = new Map();
  private eventListeners: Set<(event: AgentEvent) => void> = new Set();
  private config: PTYConfig;

  constructor(sessionName?: string, config?: Partial<PTYConfig>) {
    this.sessionName = sessionName || `agents-${process.pid}`;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getPlatform(): 'darwin' | 'linux' | 'win32' {
    return process.platform as 'darwin' | 'linux' | 'win32';
  }

  isSupported(): boolean {
    return ['darwin', 'linux'].includes(this.getPlatform());
  }

  async spawn(agentId: number, config?: PTYConfig): Promise<PTYHandle> {
    const cfg = { ...this.config, ...config };

    // Provision worktree if enabled
    let worktreePath: string | undefined;
    let worktreeBranch: string | undefined;

    if (cfg.worktree?.enabled) {
      const worktreeManager = getWorktreeManager(cfg.cwd || process.cwd(), cfg.worktree);
      const info = await worktreeManager.provision(agentId);
      worktreePath = info.path;
      worktreeBranch = info.branch;
      // Override cwd to use worktree
      cfg.cwd = worktreePath;
    }

    // Ensure tmux session exists
    await this.ensureSession();

    // Create new pane for agent
    const paneId = await this.createPane(agentId);

    // Start agent watcher in the pane with worktree cwd
    const cmd = cfg.cwd && cfg.cwd !== process.cwd()
      ? `cd ${cfg.cwd} && bun run src/agent-watcher.ts ${agentId}`
      : `bun run src/agent-watcher.ts ${agentId}`;
    await $`tmux send-keys -t ${this.sessionName}:${paneId} ${cmd} Enter`.quiet();

    // Get PID of the process
    const pid = await this.getPanePid(paneId);

    const handle: PTYHandle = {
      agentId,
      pid,
      paneId,
      status: 'starting',
      startedAt: new Date(),
      lastHeartbeat: new Date(),
      worktreePath,
      worktreeBranch,
    };

    this.handles.set(agentId, handle);
    this.emitEvent({ type: 'spawn', agentId, timestamp: new Date(), data: { paneId, pid, worktreePath, worktreeBranch } });

    // Start health check
    if ((cfg.healthCheckIntervalMs ?? 0) > 0) {
      this.startHealthCheck(agentId, cfg.healthCheckIntervalMs!);
    }

    // Update status after brief delay
    setTimeout(() => this.updateStatus(agentId, 'idle'), 2000);

    return handle;
  }

  async kill(agentId: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): Promise<void> {
    const handle = this.handles.get(agentId);
    if (!handle) return;

    this.stopHealthCheck(agentId);
    this.updateStatus(agentId, 'stopping');

    try {
      // Send signal to process
      if (handle.pid > 0) {
        await $`kill -${signal === 'SIGTERM' ? '15' : '9'} ${handle.pid}`.quiet().nothrow();
      }

      // Kill tmux pane
      await $`tmux kill-pane -t ${this.sessionName}:${handle.paneId}`.quiet().nothrow();
    } catch {
      // Ignore errors
    }

    // Cleanup worktree if it was provisioned
    if (handle.worktreePath) {
      try {
        const worktreeManager = getWorktreeManager();
        await worktreeManager.cleanup(agentId);
      } catch {
        // Ignore worktree cleanup errors
      }
    }

    this.updateStatus(agentId, 'stopped');
    this.handles.delete(agentId);
  }

  async restart(agentId: number): Promise<PTYHandle> {
    const oldHandle = this.handles.get(agentId);
    const config = oldHandle ? undefined : this.config;

    await this.kill(agentId, 'SIGTERM');
    await new Promise(r => setTimeout(r, 1000)); // Wait for cleanup

    this.emitEvent({ type: 'restart', agentId, timestamp: new Date() });
    return this.spawn(agentId, config);
  }

  async healthCheck(agentId: number): Promise<HealthStatus> {
    const handle = this.handles.get(agentId);
    if (!handle) {
      return { alive: false, responsive: false, lastHeartbeat: new Date(0) };
    }

    const alive = await this.isProcessAlive(handle.pid);
    const responsive = alive && await this.isPaneResponsive(handle.paneId);

    // Get resource usage on macOS
    let memoryUsage: number | undefined;
    let cpuUsage: number | undefined;

    if (alive && this.getPlatform() === 'darwin') {
      try {
        const ps = await $`ps -o rss=,pcpu= -p ${handle.pid}`.text();
        const [rss, cpu] = ps.trim().split(/\s+/);
        memoryUsage = parseInt(rss ?? "0") * 1024; // Convert KB to bytes
        cpuUsage = parseFloat(cpu ?? "0");
      } catch {
        // Ignore
      }
    }

    const status: HealthStatus = {
      alive,
      responsive,
      lastHeartbeat: handle.lastHeartbeat || new Date(),
      memoryUsage,
      cpuUsage,
      idleTimeMs: Date.now() - (handle.lastHeartbeat?.getTime() || Date.now()),
    };

    // Update handle
    if (alive) {
      handle.lastHeartbeat = new Date();
    }

    // Emit health event
    this.emitEvent({ type: 'health', agentId, timestamp: new Date(), data: status as unknown as Record<string, unknown> });

    // Auto-restart if crashed
    if (!alive && this.config.autoRestart && handle.status !== 'stopping') {
      this.updateStatus(agentId, 'crashed');
      this.emitEvent({ type: 'crash', agentId, timestamp: new Date() });
      setTimeout(() => this.restart(agentId), 2000);
    }

    return status;
  }

  async *watchAll(): AsyncGenerator<AgentEvent> {
    const queue: AgentEvent[] = [];
    let resolve: (() => void) | null = null;

    const listener = (event: AgentEvent) => {
      queue.push(event);
      resolve?.();
    };

    this.eventListeners.add(listener);

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>(r => { resolve = r; });
        }
      }
    } finally {
      this.eventListeners.delete(listener);
    }
  }

  getHandle(agentId: number): PTYHandle | null {
    return this.handles.get(agentId) || null;
  }

  getAllHandles(): PTYHandle[] {
    return Array.from(this.handles.values());
  }

  // Private methods

  private async ensureSession(): Promise<void> {
    const exists = await $`tmux has-session -t ${this.sessionName}`.quiet().nothrow();
    if (exists.exitCode !== 0) {
      await $`tmux new-session -d -s ${this.sessionName} -x ${this.config.cols} -y ${this.config.rows}`.quiet();
    }
  }

  private async createPane(agentId: number): Promise<string> {
    // Split window to create new pane
    const result = await $`tmux split-window -t ${this.sessionName} -P -F '#{pane_id}'`.text();
    const paneId = result.trim();

    // Rebalance panes
    await $`tmux select-layout -t ${this.sessionName} tiled`.quiet().nothrow();

    return paneId;
  }

  private async getPanePid(paneId: string): Promise<number> {
    try {
      const result = await $`tmux list-panes -t ${this.sessionName} -F '#{pane_id} #{pane_pid}' | grep ${paneId}`.text();
      const pid = parseInt(result.split(' ')[1] ?? "0");
      return isNaN(pid) ? 0 : pid;
    } catch {
      return 0;
    }
  }

  private async isProcessAlive(pid: number): Promise<boolean> {
    if (pid <= 0) return false;
    const result = await $`kill -0 ${pid}`.quiet().nothrow();
    return result.exitCode === 0;
  }

  private async isPaneResponsive(paneId: string): Promise<boolean> {
    try {
      await $`tmux capture-pane -t ${paneId} -p`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  private startHealthCheck(agentId: number, intervalMs: number): void {
    this.stopHealthCheck(agentId);
    const timer = setInterval(() => this.healthCheck(agentId), intervalMs);
    this.healthCheckTimers.set(agentId, timer);
  }

  private stopHealthCheck(agentId: number): void {
    const timer = this.healthCheckTimers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.healthCheckTimers.delete(agentId);
    }
  }

  private updateStatus(agentId: number, status: AgentStatus): void {
    const handle = this.handles.get(agentId);
    if (handle) {
      handle.status = status;
    }
  }

  private emitEvent(event: AgentEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  // Cleanup
  async shutdown(): Promise<void> {
    // Stop all health checks
    for (const agentId of this.handles.keys()) {
      this.stopHealthCheck(agentId);
    }

    // Kill all agents
    for (const agentId of this.handles.keys()) {
      await this.kill(agentId, 'SIGTERM');
    }

    // Kill tmux session
    await $`tmux kill-session -t ${this.sessionName}`.quiet().nothrow();
  }
}

// Singleton instance
let instance: PTYManager | null = null;

export function getPTYManager(sessionName?: string, config?: PTYConfig): PTYManager {
  if (!instance) {
    instance = new PTYManager(sessionName, config);
  }
  return instance;
}

export default PTYManager;
