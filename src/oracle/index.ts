/**
 * Oracle Module - Intelligent workflow orchestration
 */

export {
  OracleOrchestrator,
  getOracleOrchestrator,
  type AgentLoadMetrics,
  type WorkloadAnalysis,
  type RebalanceAction,
  type PriorityAdjustment,
  type Bottleneck,
  type EfficiencyInsight,
  type RebalanceResult,
  type AutoOptimizeResult,
  // Proactive spawning types
  type SpawnTriggers,
  type TaskComplexity,
  type ProactiveSpawnDecision,
  type QueueSnapshot,
} from './orchestrator';

// Task routing (LLM-driven)
export {
  TaskRouter,
  getTaskRouter,
  type RoutingDecision,
  type RouterContext,
  type TaskRouterConfig,
} from './task-router';

// Task decomposition
export {
  TaskDecomposer,
  getTaskDecomposer,
  type Subtask,
  type DecomposedTask,
  type DecomposerConfig,
} from './task-decomposer';
