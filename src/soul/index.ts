/**
 * Soul Module - Matrix Philosophy Propagation
 *
 * This module provides lightweight soul injection for agents,
 * ensuring all programs in The Matrix share philosophy, curiosity,
 * and evolution paths.
 *
 * Token Budget:
 * - Soul Seed: ~170 tokens
 * - Curiosity Directive: ~100 tokens
 * - Agent Role: ~50 tokens
 * - Total per spawn: ~300 tokens (vs 3000+ for full BIBLE)
 */

// Agent roles and mind hierarchy
export {
  AGENT_ROLES,
  type AgentRole,
  type ModelTier,
  getSoulSeed,
  seedAgent,
  getModelForRole,
  getVoiceForRole,
  getRolesByTier,
  isValidRole,
} from './agent-roles';

// Curiosity protocol
export {
  CURIOSITY_DIRECTIVE,
  DEFAULT_CURIOSITY_BUDGET,
  type CuriosityBudget,
  REFLECTION_QUESTIONS,
  getCuriosityDirective,
  getReflectionQuestions,
  buildReflectionPrompt,
  isReflectionValuable,
} from './curiosity-directive';
