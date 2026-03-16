/**
 * Agent Router — Phase C (ADR-013 / ADR-018)
 *
 * Parses user intent from Telegram messages and routes to the appropriate
 * Oracle Construct agent. Provider-agnostic — works with Gemini, GPT, or Claude.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AGENT_ROUTES, type AgentRoute, type GatewayConfig } from './types';
import { selectProvider, getModelForTier, type LLMProvider } from './providers';
import { loadContext, formatContextForPrompt } from './conversation-store';

export interface RoutingResult {
  agent: AgentRoute;
  userMessage: string;
  systemPrompt: string;
  modelId: string;
  provider: LLMProvider;
}

// ============ Intent Parsing ============

/**
 * Parse agent prefix from message.
 * Patterns: "/neo ...", "@smith ...", "Neo, ...", "smith ..."
 */
export function parseAgentIntent(text: string): { agent: string | null; message: string } {
  const trimmed = text.trim();

  // /command style: /neo do something
  const slashMatch = trimmed.match(/^\/(\w+)\s*(.*)/s);
  if (slashMatch) {
    const cmd = slashMatch[1]!.toLowerCase();
    if (cmd in AGENT_ROUTES) {
      return { agent: cmd, message: slashMatch[2] || '' };
    }
    // Special commands
    if (cmd === 'status') return { agent: 'oracle', message: 'What is the current status? Show tasks, focus, and recent events.' };
    if (cmd === 'tasks') return { agent: 'oracle', message: 'List all active tasks with their status.' };
    if (cmd === 'health') return { agent: 'oracle', message: 'Run a system health check.' };
    if (cmd === 'events') return { agent: 'oracle', message: 'Show the last 20 system events.' };
  }

  // @agent style: @smith investigate
  const atMatch = trimmed.match(/^@(\w+)\s*(.*)/s);
  if (atMatch) {
    const agent = atMatch[1]!.toLowerCase();
    if (agent in AGENT_ROUTES) {
      return { agent, message: atMatch[2] || '' };
    }
  }

  // "Agent, ..." style: "Neo, fix the tests"
  const commaMatch = trimmed.match(/^(\w+),\s*(.*)/s);
  if (commaMatch) {
    const agent = commaMatch[1]!.toLowerCase();
    if (agent in AGENT_ROUTES) {
      return { agent, message: commaMatch[2] || '' };
    }
  }

  // No agent prefix → default to Oracle
  return { agent: null, message: trimmed };
}

// ============ System Prompt Builder ============

export function buildSystemPrompt(agent: AgentRoute, projectRoot: string, userId?: string): string {
  const parts: string[] = [];

  // 1. Agent personality
  const personalityPath = join(projectRoot, '.claude', 'agents', agent.personality_file);
  if (existsSync(personalityPath)) {
    parts.push(readFileSync(personalityPath, 'utf8'));
  }

  // 2. Current focus
  const focusPath = join(projectRoot, 'psi', 'inbox', 'focus.md');
  if (existsSync(focusPath)) {
    const focus = readFileSync(focusPath, 'utf8');
    // Just the first 20 lines for context
    parts.push('## Current Focus\n' + focus.split('\n').slice(0, 20).join('\n'));
  }

  // 3. Active tasks
  const tasksPath = join(projectRoot, 'psi', 'memory', 'tasks', 'active.json');
  if (existsSync(tasksPath)) {
    try {
      const tasks = JSON.parse(readFileSync(tasksPath, 'utf8'));
      const taskList = (tasks.tasks || [])
        .filter((t: { status: string }) => t.status !== 'completed')
        .map((t: { status: string; task: string; assignee: string }) =>
          `- [${t.status}] ${t.task} (${t.assignee})`)
        .join('\n');
      if (taskList) {
        parts.push('## Active Tasks\n' + taskList);
      }
    } catch { /* ignore */ }
  }

  // 4. Conversation history (Phase I)
  if (userId) {
    try {
      const context = loadContext(projectRoot, userId);
      const contextStr = formatContextForPrompt(context);
      if (contextStr) {
        parts.push(contextStr);
      }
    } catch { /* skip if conversation store unavailable */ }
  }

  // 5. Gateway-specific instructions
  parts.push(`## Gateway Mode
You are responding via Telegram. Keep responses concise (under 4000 chars).
Use Telegram MarkdownV2 sparingly — prefer plain text.
You have access to tools for: shell commands (sandboxed), file reading, memory search, git status, and event reading.
The Operator is on mobile — respect their time.`);

  return parts.join('\n\n---\n\n');
}

// ============ Full Routing ============

export function routeMessage(
  text: string,
  projectRoot: string,
  config: GatewayConfig,
  userId?: string
): RoutingResult {
  const { agent: agentKey, message } = parseAgentIntent(text);
  const agent = AGENT_ROUTES[agentKey || 'oracle'] || AGENT_ROUTES['oracle']!;
  const systemPrompt = buildSystemPrompt(agent, projectRoot, userId);

  // Select provider based on config
  const provider = selectProvider(config.llm?.provider);
  const modelId = getModelForTier(agent.model, provider, config.llm);

  return {
    agent,
    userMessage: message || text,
    systemPrompt,
    modelId,
    provider,
  };
}
