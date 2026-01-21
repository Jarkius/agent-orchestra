/**
 * MCP Server Configuration
 * Central place for all constants, paths, and defaults
 */

import { join } from 'path';

// Project root for relative paths
const PROJECT_ROOT = process.cwd();

export const CONFIG = {
  // File system paths (project-local, persists across reboots)
  // Add ./data/ to .gitignore
  INBOX_BASE: join(PROJECT_ROOT, "data", "agent_inbox"),
  OUTBOX_BASE: join(PROJECT_ROOT, "data", "agent_outbox"),
  SHARED_DIR: join(PROJECT_ROOT, "data", "agent_shared"),

  // Pagination defaults
  DEFAULT_LIMIT: 20,
  MAX_RESULTS: 100,

  // Server info
  SERVER_NAME: "claude-agent-orchestrator",
  SERVER_VERSION: "3.0.0",
} as const;

export const TASK_STATUS = {
  PENDING: 'pending',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const TASK_PRIORITY = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
} as const;

export const MESSAGE_DIRECTION = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
} as const;

export type TaskStatus = typeof TASK_STATUS[keyof typeof TASK_STATUS];
export type TaskPriority = typeof TASK_PRIORITY[keyof typeof TASK_PRIORITY];
export type MessageDirection = typeof MESSAGE_DIRECTION[keyof typeof MESSAGE_DIRECTION];
