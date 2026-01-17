/**
 * PTY Module - Expert Multi-Agent Orchestration System
 *
 * Exports:
 * - PTYManager: Platform-aware pseudo-terminal management
 * - AgentSpawner: Role-based agent spawning with model tier selection
 * - MissionQueue: Self-correcting task queue with retry and dependencies
 */

// Core managers
export { PTYManager, getPTYManager } from './manager';
export { AgentSpawner, getAgentSpawner } from './spawner';
export { MissionQueue, getMissionQueue } from './mission-queue';
export { WorktreeManager, getWorktreeManager, resetWorktreeManager } from './worktree-manager';
export type { WorktreeInfo, MergeResult } from './worktree-manager';

// Re-export interfaces for convenience
export type {
  IPTYManager,
  PTYHandle,
  PTYConfig,
  HealthStatus,
  AgentEvent,
  AgentStatus,
} from '../interfaces/pty';

export type {
  IAgentSpawner,
  Agent,
  AgentConfig,
  Task,
  AgentRole,
  ModelTier,
} from '../interfaces/spawner';

export type {
  IMissionQueue,
  Mission,
  MissionResult,
  MissionStatus,
  Priority,
  ErrorContext,
} from '../interfaces/mission';

// Utility functions
export { selectModel, ROLE_PROMPTS } from '../interfaces/spawner';
export { calculateBackoff, isRecoverable } from '../interfaces/mission';
