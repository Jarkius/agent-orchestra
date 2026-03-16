/**
 * Council-to-Router Bridge (Sprint 3.1)
 *
 * Maps The Matrix Council agents (Oracle, Neo, Trinity, etc.) to the
 * task-router's generic roles and Mind Hierarchy model tiers (ADR-003).
 *
 * This is the bridge between the Matrix personality layer and the
 * matrix-memory-agents routing engine.
 */

import type { AgentRole, ModelTier } from '../interfaces/spawner';
import type { RoutingDecision } from './task-router';
import { getTaskRouter } from './task-router';

// ============ Council Agent Types ============

export type CouncilAgent =
  | 'Oracle'
  | 'Neo'
  | 'Trinity'
  | 'Morpheus'
  | 'Architect'
  | 'Smith'
  | 'Tank'
  | 'Scribe';

export interface CouncilMapping {
  agent: CouncilAgent;
  role: AgentRole;
  tier: ModelTier;
  skills: string[];
  description: string;
}

// ============ Mind Hierarchy (ADR-003) ============

/**
 * Wise tier: Opus — decisions, code, synthesis, deep analysis
 * Intelligent tier: Sonnet — learning, routine reasoning, judgment
 * Mechanical tier: Haiku — search, gather, list, mechanical ops
 */
export const MIND_HIERARCHY: Record<'wise' | 'intelligent' | 'mechanical', ModelTier> = {
  wise: 'opus',
  intelligent: 'sonnet',
  mechanical: 'haiku',
};

// ============ Council → Router Mapping ============

export const COUNCIL_MAP: Record<CouncilAgent, CouncilMapping> = {
  Oracle: {
    agent: 'Oracle',
    role: 'oracle',
    tier: 'opus',
    skills: ['/oracle', '/wisdom', '/distill', '/health', '/unplug', '/recap'],
    description: 'Orchestrator — align, dispatch, prophecy',
  },
  Neo: {
    agent: 'Neo',
    role: 'coder',
    tier: 'opus',
    skills: ['/neo', '/story', '/fix', '/yolo', '/gogogo', '/commit', '/review'],
    description: 'Developer — write ALL code, implement',
  },
  Trinity: {
    agent: 'Trinity',
    role: 'reviewer',
    tier: 'opus',
    skills: ['/trinity', '/tokens', '/component-spec', '/design-review', '/handoff'],
    description: 'Design Lead — design tokens, review, guide',
  },
  Morpheus: {
    agent: 'Morpheus',
    role: 'researcher',
    tier: 'sonnet',
    skills: ['/morpheus', '/learn', '/snapshot', '/wisdom'],
    description: 'External Intel — Gemini, Google AI, browser automation, web search',
  },
  Architect: {
    agent: 'Architect',
    role: 'architect',
    tier: 'opus',
    skills: ['/architect', '/tech-spec', '/nnn', '/ready', '/review', '/adr'],
    description: 'System Design — ADRs, architecture, structure',
  },
  Smith: {
    agent: 'Smith',
    role: 'debugger',
    tier: 'opus',
    skills: ['/smith', '/review', '/patrol', '/cause', '/correct', '/fix'],
    description: 'Debugger — bugs, security, anomalies',
  },
  Tank: {
    agent: 'Tank',
    role: 'researcher',
    tier: 'haiku',
    skills: ['/operator', '/context-finder', '/access', '/snapshot'],
    description: 'Internal Intel — code search, git, dependencies',
  },
  Scribe: {
    agent: 'Scribe',
    role: 'scribe',
    tier: 'opus',
    skills: ['/rrr', '/recap', '/distill', '/wisdom', '/snapshot'],
    description: 'Memory — retrospectives, documentation',
  },
};

// ============ Reverse Lookups ============

/** Map a generic router role back to the best Council agent */
export const ROLE_TO_COUNCIL: Record<AgentRole, CouncilAgent> = {
  oracle: 'Oracle',
  coder: 'Neo',
  reviewer: 'Trinity',
  researcher: 'Morpheus',
  architect: 'Architect',
  debugger: 'Smith',
  analyst: 'Smith',
  tester: 'Neo',
  scribe: 'Scribe',
  generalist: 'Neo',
};

/** Map a skill command to its owning agent */
export function getAgentForSkill(skill: string): CouncilAgent | null {
  for (const [agent, mapping] of Object.entries(COUNCIL_MAP)) {
    if (mapping.skills.includes(skill)) {
      return agent as CouncilAgent;
    }
  }
  return null;
}

// ============ Council-Aware Routing ============

/**
 * Route a task through the Council lens.
 * Uses the task-router's intelligence, then maps back to Council agents.
 */
export async function routeToCouncil(
  task: string,
  context?: string,
): Promise<{
  agent: CouncilAgent;
  mapping: CouncilMapping;
  decision: RoutingDecision;
}> {
  const router = getTaskRouter();
  const decision = await router.routeTask(task, context);

  // Map the router's recommended role to a Council agent
  const agent = ROLE_TO_COUNCIL[decision.recommendedRole] || 'Neo';
  const mapping = COUNCIL_MAP[agent];

  // Override model tier with Mind Hierarchy if the Council mapping differs
  // The Council's tier takes precedence (ADR-003)
  if (mapping.tier !== decision.recommendedModel) {
    decision.recommendedModel = mapping.tier;
    decision.reasoning += ` (Mind Hierarchy override: ${agent} uses ${mapping.tier})`;
  }

  return { agent, mapping, decision };
}

/**
 * Get the recommended Council agent for a given skill command.
 * Includes escalation logic — if the task is too complex for the
 * skill's owner, recommend escalation.
 */
export function recommendAgent(skill: string): {
  primary: CouncilAgent;
  escalateTo?: CouncilAgent;
  tier: ModelTier;
} {
  const primary = getAgentForSkill(skill);
  if (!primary) {
    return { primary: 'Oracle', tier: 'opus' };
  }

  const mapping = COUNCIL_MAP[primary];

  // Tank (Haiku) can escalate to Morpheus (Sonnet) for understanding
  // Morpheus (Sonnet) can escalate to Oracle (Opus) for synthesis
  let escalateTo: CouncilAgent | undefined;
  if (mapping.tier === 'haiku') {
    escalateTo = 'Morpheus'; // Haiku → Sonnet
  } else if (mapping.tier === 'sonnet') {
    escalateTo = 'Oracle'; // Sonnet → Opus
  }

  return { primary, escalateTo, tier: mapping.tier };
}

/**
 * Get all Council agents at a given Mind Hierarchy tier.
 */
export function getAgentsByTier(tier: 'wise' | 'intelligent' | 'mechanical'): CouncilAgent[] {
  const modelTier = MIND_HIERARCHY[tier];
  return Object.entries(COUNCIL_MAP)
    .filter(([_, mapping]) => mapping.tier === modelTier)
    .map(([agent]) => agent as CouncilAgent);
}

/**
 * Format a Council routing decision for display.
 */
export function formatRoutingDecision(
  agent: CouncilAgent,
  decision: RoutingDecision,
): string {
  const mapping = COUNCIL_MAP[agent];
  const confidence = Math.round(decision.confidence * 100);
  return `${agent} (${mapping.tier}) — ${mapping.description} [${confidence}% confidence]`;
}
