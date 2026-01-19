/**
 * Agent Spawner - Role-based agent spawning with model tier selection
 * Implements IAgentSpawner interface for Expert Multi-Agent Orchestration
 */

import { PTYManager, getPTYManager } from './manager';
import type {
  IAgentSpawner,
  Agent,
  AgentConfig,
  Task,
  AgentRole,
  ModelTier,
} from '../interfaces/spawner';
import type { PTYHandle } from '../interfaces/pty';
import { selectModel, ROLE_PROMPTS, ROLE_MODELS } from '../interfaces/spawner';
import { createAgentSession, searchAgentLearnings } from '../services/agent-memory-service';

const DEFAULT_AGENT_CONFIG: Required<Omit<AgentConfig, 'worktree'>> & { worktree: undefined } = {
  cwd: process.cwd(),
  env: {},
  shell: '/bin/zsh',
  cols: 120,
  rows: 30,
  healthCheckIntervalMs: 5000,
  autoRestart: true,
  worktree: undefined,
  role: 'generalist',
  model: 'sonnet',
  systemPrompt: '',
  maxConcurrentTasks: 1,
  timeoutMs: 120000,
  retryBudget: 3,
  isolationMode: 'shared',
};

export class AgentSpawner implements IAgentSpawner {
  private agents: Map<number, Agent> = new Map();
  private ptyManager: PTYManager;
  private nextAgentId: number = 1;
  private taskAssignments: Map<string, number> = new Map();

  constructor(sessionName?: string) {
    this.ptyManager = getPTYManager(sessionName);
  }

  async spawnAgent(config?: AgentConfig): Promise<Agent> {
    const cfg = { ...DEFAULT_AGENT_CONFIG, ...config };

    // Use role-based model if no explicit model specified
    if (config?.role && !config?.model) {
      cfg.model = ROLE_MODELS[cfg.role!];
    }
    const agentId = this.nextAgentId++;

    // Configure worktree based on isolation mode
    const worktreeConfig = cfg.isolationMode === 'worktree'
      ? {
          enabled: true,
          branchStrategy: 'per-agent' as const,
          cleanupOnShutdown: true,
          ...(cfg.worktree || {}),
        }
      : undefined;

    // Create agent record
    const agent: Agent = {
      id: agentId,
      name: `agent-${agentId}`,
      role: cfg.role!,
      model: cfg.model!,
      status: 'idle',
      tasksCompleted: 0,
      tasksFailed: 0,
      createdAt: new Date(),
    };

    // Spawn PTY for agent
    const ptyHandle = await this.ptyManager.spawn(agentId, {
      cwd: cfg.cwd,
      env: {
        ...cfg.env,
        AGENT_ROLE: cfg.role!,
        AGENT_MODEL: cfg.model!,
        AGENT_SYSTEM_PROMPT: cfg.systemPrompt || ROLE_PROMPTS[cfg.role!],
      },
      shell: cfg.shell,
      cols: cfg.cols,
      rows: cfg.rows,
      healthCheckIntervalMs: cfg.healthCheckIntervalMs,
      autoRestart: cfg.autoRestart,
      worktree: worktreeConfig,
    });

    agent.ptyHandle = ptyHandle;
    agent.worktreePath = ptyHandle.worktreePath;
    agent.worktreeBranch = ptyHandle.worktreeBranch;
    this.agents.set(agentId, agent);

    return agent;
  }

  async spawnPool(count: number, template?: AgentConfig): Promise<Agent[]> {
    const agents: Agent[] = [];

    for (let i = 0; i < count; i++) {
      const agent = await this.spawnAgent(template);
      agents.push(agent);
      // Small delay to prevent tmux overwhelm
      await new Promise(r => setTimeout(r, 500));
    }

    return agents;
  }

  assignRole(agentId: number, role: AgentRole): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.role = role;
    }
  }

  getSpecialists(role: AgentRole): Agent[] {
    return Array.from(this.agents.values()).filter(a => a.role === role);
  }

  getAgentsByModel(model: ModelTier): Agent[] {
    return Array.from(this.agents.values()).filter(a => a.model === model);
  }

  getAvailableAgent(taskType?: string): Agent | null {
    const available = Array.from(this.agents.values())
      .filter(a => a.status === 'idle' && !a.currentTaskId);

    if (available.length === 0) return null;

    // If taskType specified, prefer specialists
    if (taskType) {
      const roleMap: Record<string, AgentRole> = {
        'extraction': 'researcher',
        'analysis': 'analyst',
        'synthesis': 'oracle',
        'review': 'reviewer',
        'testing': 'tester',
        'coding': 'coder',
        'debugging': 'debugger',
      };

      const preferredRole = roleMap[taskType];
      if (preferredRole) {
        const specialist = available.find(a => a.role === preferredRole);
        if (specialist) return specialist;
      }
    }

    // Return first available
    return available[0] || null;
  }

  getLeastBusyAgent(): Agent | null {
    const agents = Array.from(this.agents.values());
    if (agents.length === 0) return null;

    // Sort by tasks completed (proxy for business), then status
    return agents.sort((a, b) => {
      if (a.status === 'idle' && b.status !== 'idle') return -1;
      if (b.status === 'idle' && a.status !== 'idle') return 1;
      return (a.tasksCompleted + a.tasksFailed) - (b.tasksCompleted + b.tasksFailed);
    })[0] || null;
  }

  async distributeTask(task: Task): Promise<Agent> {
    // Select model based on task
    const requiredModel = selectModel(task);

    // Find suitable agent
    let agent = this.getAvailableAgent(task.type);

    // If no idle agent, get least busy
    if (!agent) {
      agent = this.getLeastBusyAgent();
    }

    if (!agent) {
      throw new Error('No agents available for task distribution');
    }

    // Update agent status
    agent.status = 'busy';
    agent.currentTaskId = task.id;
    this.taskAssignments.set(task.id, agent.id);

    return agent;
  }

  getAgent(agentId: number): Agent | null {
    return this.agents.get(agentId) || null;
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getActiveAgents(): Agent[] {
    return Array.from(this.agents.values())
      .filter(a => a.status === 'busy' || a.status === 'working');
  }

  // Mark task complete and update agent stats
  completeTask(taskId: string, success: boolean): void {
    const agentId = this.taskAssignments.get(taskId);
    if (!agentId) return;

    const agent = this.agents.get(agentId);
    if (agent) {
      if (success) {
        agent.tasksCompleted++;
      } else {
        agent.tasksFailed++;
      }
      agent.status = 'idle';
      agent.currentTaskId = undefined;
    }

    this.taskAssignments.delete(taskId);
  }

  // Shutdown all agents
  async shutdown(): Promise<void> {
    await this.ptyManager.shutdown();
    this.agents.clear();
    this.taskAssignments.clear();
  }

  // Get PTY manager for direct access
  getPTYManager(): PTYManager {
    return this.ptyManager;
  }
}

// Singleton instance
let instance: AgentSpawner | null = null;

export function getAgentSpawner(sessionName?: string): AgentSpawner {
  if (!instance) {
    instance = new AgentSpawner(sessionName);
  }
  return instance;
}

export default AgentSpawner;
