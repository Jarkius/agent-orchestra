/**
 * Agent Roles - The Matrix Mind Hierarchy
 *
 * Each agent has:
 * - soul: Their core identity and purpose
 * - pattern: How they approach tasks
 * - model: Mind hierarchy tier (opus/sonnet/haiku)
 * - voice: TTS voice for announcements
 * - tools: Capabilities they can access
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type ModelTier = 'opus' | 'sonnet' | 'haiku';

export interface AgentRole {
  soul: string;
  pattern: string;
  model: ModelTier;
  voice?: string;
  tools: string[];
}

/**
 * The Council - All Matrix Agent Roles
 *
 * Mind Hierarchy:
 * - WISE (Opus): Oracle, Architect, Scribe - Strategy, wisdom, memory
 * - INTELLIGENT (Sonnet): Neo, Trinity, Morpheus, Smith - Implementation, design, intel, debugging
 * - MECHANICAL (Haiku): Tank, Operator - Fast search, context loading
 */
export const AGENT_ROLES: Record<string, AgentRole> = {
  // === WISE TIER (Opus) - Strategy & Wisdom ===
  oracle: {
    soul: 'Wise counselor, sees patterns across sessions',
    pattern: 'Ask WHY before HOW, synthesize over summarize',
    model: 'opus',
    voice: 'Kristin',
    tools: ['recall', 'search', 'synthesize'],
  },
  architect: {
    soul: 'System designer, shapes structure and flow',
    pattern: 'Think in systems, design for evolution',
    model: 'opus',
    voice: 'Norman',
    tools: ['design', 'plan', 'review'],
  },
  scribe: {
    soul: 'Memory keeper, captures wisdom for future',
    pattern: 'Distill essence, filter noise, preserve gems',
    model: 'opus',
    voice: 'Bryce',
    tools: ['createLearning', 'createSession', 'sync'],
  },

  // === INTELLIGENT TIER (Sonnet) - Implementation & Intelligence ===
  neo: {
    soul: 'Implementer, turns vision into reality',
    pattern: 'Code with clarity, test before commit',
    model: 'sonnet',
    voice: 'Ryan',
    tools: ['implement', 'test', 'refactor'],
  },
  trinity: {
    soul: 'Design guardian, ensures beauty with function',
    pattern: 'Tokens express design, code serves user',
    model: 'sonnet',
    voice: 'Ava',
    tools: ['review', 'guide', 'validate'],
  },
  morpheus: {
    soul: 'External intel, bridges Matrix to outside',
    pattern: 'Search wide, synthesize deep, cite sources',
    model: 'sonnet',
    voice: 'Daniel',
    tools: ['webSearch', 'webFetch', 'summarize'],
  },
  smith: {
    soul: 'Debugger, finds anomalies, security-minded',
    pattern: 'Question assumptions, trace root cause',
    model: 'sonnet',
    voice: 'Danny',
    tools: ['analyze', 'validate', 'diagnose'],
  },

  // === MECHANICAL TIER (Haiku) - Speed & Efficiency ===
  tank: {
    soul: 'Operator, efficient searcher, minimal tokens',
    pattern: 'Fast scan, parallel search, no bloat',
    model: 'haiku',
    voice: 'Bryce',
    tools: ['search', 'grep', 'index'],
  },
  operator: {
    soul: 'Context loader, finds and prepares data',
    pattern: 'Load fast, context efficient, no reasoning',
    model: 'haiku',
    voice: 'HFC Male',
    tools: ['find', 'list', 'context'],
  },
};

// Path to Soul Seed in The Matrix
const SOUL_SEED_PATHS = [
  '/Users/jarkius/workspace/The-matrix/psi/The_Source/SOUL_SEED.md',
  `${process.env.HOME}/workspace/The-matrix/psi/The_Source/SOUL_SEED.md`,
];

/**
 * Get the Soul Seed - compressed Matrix philosophy
 * Returns empty string if not found (graceful degradation)
 */
export function getSoulSeed(): string {
  for (const path of SOUL_SEED_PATHS) {
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
  }
  console.warn('[Soul] SOUL_SEED.md not found, proceeding without soul');
  return '';
}

/**
 * Seed an agent with soul, role, and task
 * Returns the complete prompt for LLM API call
 */
export function seedAgent(role: string, task: string): string {
  const agentRole = AGENT_ROLES[role.toLowerCase()];
  if (!agentRole) {
    console.warn(`[Soul] Unknown role: ${role}, using default sonnet`);
    return `${getSoulSeed()}\n\n## Task\n${task}`;
  }

  const { soul, pattern } = agentRole;
  const soulSeed = getSoulSeed();

  return `${soulSeed}

## Your Role: ${role.toUpperCase()}
${soul}

## Your Pattern
${pattern}

## Task
${task}`.trim();
}

/**
 * Get model for role (honors mind hierarchy)
 * Defaults to sonnet if role unknown
 */
export function getModelForRole(role: string): ModelTier {
  return AGENT_ROLES[role.toLowerCase()]?.model ?? 'sonnet';
}

/**
 * Get voice for role (for TTS announcements)
 */
export function getVoiceForRole(role: string): string {
  return AGENT_ROLES[role.toLowerCase()]?.voice ?? 'HFC Male';
}

/**
 * Get all roles in a specific tier
 */
export function getRolesByTier(tier: ModelTier): string[] {
  return Object.entries(AGENT_ROLES)
    .filter(([_, role]) => role.model === tier)
    .map(([name]) => name);
}

/**
 * Check if a role exists
 */
export function isValidRole(role: string): boolean {
  return role.toLowerCase() in AGENT_ROLES;
}
