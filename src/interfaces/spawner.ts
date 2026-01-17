/**
 * Agent Spawner Interface
 * Role-based agent spawning with model tier selection
 */

import type { PTYHandle, PTYConfig } from './pty';

export type AgentRole = 'coder' | 'tester' | 'analyst' | 'reviewer' | 'generalist' | 'oracle' | 'architect' | 'debugger' | 'researcher' | 'scribe';
export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface Agent {
  id: number;
  name: string;
  role: AgentRole;
  model: ModelTier;
  status: 'idle' | 'busy' | 'working' | 'error';
  ptyHandle?: PTYHandle;
  currentTaskId?: string;
  tasksCompleted: number;
  tasksFailed: number;
  createdAt: Date;
}

export interface AgentConfig extends PTYConfig {
  role?: AgentRole;
  model?: ModelTier;
  systemPrompt?: string;
  maxConcurrentTasks?: number;
  timeoutMs?: number;
  retryBudget?: number;
}

export interface IAgentSpawner {
  // Spawn
  spawnAgent(config?: AgentConfig): Promise<Agent>;
  spawnPool(count: number, template?: AgentConfig): Promise<Agent[]>;

  // Specialization
  assignRole(agentId: number, role: AgentRole): void;
  getSpecialists(role: AgentRole): Agent[];
  getAgentsByModel(model: ModelTier): Agent[];

  // Load Balancing
  getAvailableAgent(taskType?: string): Agent | null;
  getLeastBusyAgent(): Agent | null;
  distributeTask(task: Task): Promise<Agent>;

  // Query
  getAgent(agentId: number): Agent | null;
  getAllAgents(): Agent[];
  getActiveAgents(): Agent[];
}

export interface Task {
  id: string;
  prompt: string;
  context?: string;
  type?: 'extraction' | 'analysis' | 'synthesis' | 'review' | 'general';
  priority: 'critical' | 'high' | 'normal' | 'low';
}

// Model selection based on task complexity
export function selectModel(task: Task): ModelTier {
  if (task.priority === 'critical' || task.type === 'synthesis') return 'opus';
  if (task.type === 'analysis' || task.type === 'review') return 'sonnet';
  return 'haiku';
}

// Role-based system prompts
export const ROLE_PROMPTS: Record<AgentRole, string> = {
  coder: 'You are a coding specialist. Focus on implementation, best practices, and clean code.',
  tester: 'You are a testing specialist. Focus on test coverage, edge cases, and quality assurance.',
  analyst: 'You are an analysis specialist. Focus on understanding requirements and breaking down problems.',
  reviewer: 'You are a code review specialist. Focus on improvements, bugs, and maintainability.',
  generalist: 'You are a general-purpose agent. Handle any task assigned to you.',
  oracle: 'You are the orchestrator. Coordinate workflow and ensure mission alignment.',
  architect: 'You are a system design specialist. Focus on architecture and design decisions.',
  debugger: 'You are a debugging specialist. Focus on finding and fixing issues.',
  researcher: 'You are a research specialist. Focus on gathering information and analysis.',
  scribe: 'You are a documentation specialist. Focus on capturing learnings and documenting sessions.',
};
