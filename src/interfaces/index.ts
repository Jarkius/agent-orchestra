/**
 * Core Interfaces for Expert Multi-Agent Orchestration System
 *
 * Self-Correcting | Self-Sufficient | Expert-Level
 */

// PTY Management
export type {
  IPTYManager,
  PTYHandle,
  PTYConfig,
  HealthStatus,
  AgentEvent,
  AgentStatus,
} from './pty';

// Agent Spawning
export type {
  IAgentSpawner,
  Agent,
  AgentConfig,
  Task,
} from './spawner';
export type { AgentRole, ModelTier } from './spawner';
export { selectModel, ROLE_PROMPTS, ROLE_MODELS } from './spawner';

// Mission Queue
export type {
  IMissionQueue,
  Mission,
  MissionResult,
  ErrorContext,
} from './mission';
export type { MissionStatus, Priority, ErrorCode } from './mission';
export { calculateBackoff, isRecoverable } from './mission';

// Learning Loop
export type {
  ILearningLoop,
  Learning,
  KnowledgeEntry,
  LessonEntry,
  FailureAnalysis,
  Pattern,
  AgentRecommendation,
  CompletedMission,
  FailedMission,
} from './learning';
export type { LearningCategory, Confidence } from './learning';

// Status Monitor
export type {
  IStatusMonitor,
  AlertCondition,
  Alert,
  AlertHandler,
  Unsubscribe,
  AgentMetrics,
  SystemMetrics,
  SystemSnapshot,
} from './monitor';
export type { AlertType } from './monitor';
export { COLORS, STATUS_ICONS } from './monitor';
