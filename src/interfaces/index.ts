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
export { AgentRole, ModelTier, selectModel, ROLE_PROMPTS } from './spawner';

// Mission Queue
export type {
  IMissionQueue,
  Mission,
  MissionResult,
  ErrorContext,
} from './mission';
export {
  MissionStatus,
  Priority,
  ErrorCode,
  calculateBackoff,
  isRecoverable,
} from './mission';

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
export { LearningCategory, Confidence } from './learning';

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
export { AlertType, COLORS, STATUS_ICONS } from './monitor';
