/**
 * Shared TypeScript types for MCP Server
 */

import type { TaskStatus, TaskPriority, MessageDirection } from './config';

// ============ MCP Response Types ============

export interface MCPTextContent {
  type: "text";
  text: string;
}

export interface MCPResponse {
  content: MCPTextContent[];
  isError?: boolean;
  [key: string]: unknown;  // Allow additional properties for MCP SDK compatibility
}

// ============ Tool Types ============

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (args: unknown) => Promise<MCPResponse>;

export interface ToolModule {
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}

// ============ Task Types ============

export interface TaskData {
  id: string;
  prompt: string;
  context?: string;
  priority?: TaskPriority;
  assigned_at?: string;
  working_dir?: string;
}

export interface TaskResult {
  task_id: string;
  agent_id: number;
  status: 'completed' | 'error';
  output: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

// ============ Agent Types ============

export interface AgentRecord {
  id: number;
  name: string;
  pane_id: string;
  pid: number;
  status: string;
  current_task_id: string | null;
  tasks_completed: number;
  tasks_failed: number;
  total_duration_ms: number;
  created_at: string;
  updated_at: string;
}

// ============ Message Types ============

export interface MessageRecord {
  id: number;
  agent_id: number;
  direction: MessageDirection;
  message_type: string;
  content: string;
  source: string | null;
  created_at: string;
}

// ============ Query Types ============

export interface TaskQueryParams {
  agent_id?: number;
  status?: TaskStatus;
  limit?: number;
  offset?: number;
  since?: string;
}

export interface MessageQueryParams {
  agent_id?: number;
  direction?: MessageDirection;
  limit?: number;
}
