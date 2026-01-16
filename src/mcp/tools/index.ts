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
import type { ToolDefinition, ToolHandler } from '../types';

// Aggregate all tools
export const allTools: ToolDefinition[] = [
  ...taskTools,
  ...resultsTools,
  ...agentTools,
  ...contextTools,
  ...queryTools,    // Phase 1: SQLite query tools
  ...vectorTools,   // Phase 2: Vector search tools
];

// Aggregate all handlers
export const allHandlers: Record<string, ToolHandler> = {
  ...taskHandlers,
  ...resultsHandlers,
  ...agentHandlers,
  ...contextHandlers,
  ...queryHandlers,  // Phase 1: SQLite query handlers
  ...vectorHandlers, // Phase 2: Vector search handlers
};

// Dynamic registration for Phase 1/2 tools
export function registerTools(
  tools: ToolDefinition[],
  handlers: Record<string, ToolHandler>
) {
  allTools.push(...tools);
  Object.assign(allHandlers, handlers);
}
