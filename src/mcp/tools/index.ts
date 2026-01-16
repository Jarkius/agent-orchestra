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
};

// Dynamic registration for Phase 1/2 tools
export function registerTools(
  tools: ToolDefinition[],
  handlers: Record<string, ToolHandler>
) {
  allTools.push(...tools);
  Object.assign(allHandlers, handlers);
}
