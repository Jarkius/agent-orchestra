/**
 * Tool Registry
 * Central export of all tools and handlers for the MCP server
 */

import { taskTools, taskHandlers } from './handlers/task';
import { resultsTools, resultsHandlers } from './handlers/results';
import { agentTools, agentHandlers } from './handlers/agents';
import { contextTools, contextHandlers } from './handlers/context';
import { queryTools, queryHandlers } from './handlers/query';
import { vectorTools, vectorHandlers } from './handlers/vector';
import { sessionTools, sessionHandlers } from './handlers/session';
import { learningTools, learningHandlers } from './handlers/learning';
import { analyticsTools, analyticsHandlers } from './handlers/analytics';
import { ptyTools, ptyHandlers } from './handlers/pty';
import { worktreeTools, worktreeHandlers } from './handlers/worktree';
import { agentQueryTools, agentQueryHandlers } from './handlers/agent-query';
import { oracleConsultTools, oracleConsultHandlers } from './handlers/oracle-consult';
import type { ToolDefinition, ToolHandler } from '../types';

// Aggregate all tools
export const allTools: ToolDefinition[] = [
  ...taskTools,
  ...resultsTools,
  ...agentTools,
  ...contextTools,
  ...queryTools,    // SQLite query tools
  ...vectorTools,   // Vector search tools
  ...sessionTools,  // Session persistence tools
  ...learningTools, // Learning management tools
  ...analyticsTools, // Analytics and export tools
  ...ptyTools,      // PTY orchestration tools
  ...worktreeTools, // Git worktree management tools
  ...agentQueryTools, // Agent-to-agent query tools
  ...oracleConsultTools, // Oracle consultation tools
];

// Aggregate all handlers
export const allHandlers: Record<string, ToolHandler> = {
  ...taskHandlers,
  ...resultsHandlers,
  ...agentHandlers,
  ...contextHandlers,
  ...queryHandlers,  // SQLite query handlers
  ...vectorHandlers, // Vector search handlers
  ...sessionHandlers, // Session persistence handlers
  ...learningHandlers, // Learning management handlers
  ...analyticsHandlers, // Analytics and export handlers
  ...ptyHandlers,    // PTY orchestration handlers
  ...worktreeHandlers, // Git worktree management handlers
  ...agentQueryHandlers, // Agent-to-agent query handlers
  ...oracleConsultHandlers, // Oracle consultation handlers
};

// Dynamic registration for Phase 1/2 tools
export function registerTools(
  tools: ToolDefinition[],
  handlers: Record<string, ToolHandler>
) {
  allTools.push(...tools);
  Object.assign(allHandlers, handlers);
}
