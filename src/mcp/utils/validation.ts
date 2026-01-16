/**
 * Zod Validation Schemas
 * Type-safe input validation for all MCP tools
 */

import { z } from 'zod';
import { TASK_STATUS, TASK_PRIORITY, MESSAGE_DIRECTION } from '../config';

// ============ Common Schemas ============

export const AgentIdSchema = z.number().int().positive();
export const TaskIdSchema = z.string().min(1);
export const LimitSchema = z.number().int().min(1).max(100).default(20);
export const OffsetSchema = z.number().int().min(0).default(0);

// ============ Task Tool Schemas ============

export const AssignTaskSchema = z.object({
  agent_id: AgentIdSchema,
  task: z.string().min(1, "Task prompt cannot be empty"),
  context: z.string().optional(),
  priority: z.enum([TASK_PRIORITY.LOW, TASK_PRIORITY.NORMAL, TASK_PRIORITY.HIGH]).default(TASK_PRIORITY.NORMAL),
});

export const BroadcastTaskSchema = z.object({
  task: z.string().min(1, "Task prompt cannot be empty"),
  context: z.string().optional(),
});

export const CancelTaskSchema = z.object({
  task_id: TaskIdSchema,
  agent_id: AgentIdSchema.optional(),
});

// ============ Result Tool Schemas ============

export const GetTaskResultSchema = z.object({
  task_id: TaskIdSchema,
  agent_id: AgentIdSchema,
});

export const GetAllResultsSchema = z.object({
  agent_id: AgentIdSchema,
  limit: LimitSchema.optional(),
});

// ============ Agent Tool Schemas ============

export const GetAgentWorkloadSchema = z.object({
  agent_id: AgentIdSchema,
});

export const GetAgentMetricsSchema = z.object({
  agent_id: AgentIdSchema,
});

// ============ Context Tool Schemas ============

export const UpdateSharedContextSchema = z.object({
  content: z.string().min(1, "Context content cannot be empty"),
});

// ============ Query Tool Schemas ============

export const QueryTaskHistorySchema = z.object({
  agent_id: AgentIdSchema.optional(),
  status: z.enum([
    TASK_STATUS.PENDING,
    TASK_STATUS.QUEUED,
    TASK_STATUS.PROCESSING,
    TASK_STATUS.COMPLETED,
    TASK_STATUS.FAILED,
    TASK_STATUS.CANCELLED,
  ]).optional(),
  limit: LimitSchema.optional(),
  offset: OffsetSchema.optional(),
  since: z.string().datetime().optional(),
});

export const GetTaskDetailsSchema = z.object({
  task_id: TaskIdSchema,
});

export const GetMessageHistorySchema = z.object({
  agent_id: AgentIdSchema.optional(),
  direction: z.enum([MESSAGE_DIRECTION.INBOUND, MESSAGE_DIRECTION.OUTBOUND]).optional(),
  limit: LimitSchema.optional(),
});

// ============ Vector Search Schemas (Phase 2) ============

export const SearchSimilarTasksSchema = z.object({
  query: z.string().min(1, "Search query cannot be empty"),
  limit: z.number().int().min(1).max(20).default(5),
  agent_id: AgentIdSchema.optional(),
});

export const SearchSimilarResultsSchema = z.object({
  query: z.string().min(1, "Search query cannot be empty"),
  limit: z.number().int().min(1).max(20).default(5),
});

export const SearchMessageHistorySchema = z.object({
  query: z.string().min(1, "Search query cannot be empty"),
  direction: z.enum([MESSAGE_DIRECTION.INBOUND, MESSAGE_DIRECTION.OUTBOUND]).optional(),
  agent_id: AgentIdSchema.optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

export const GetRelatedMemorySchema = z.object({
  query: z.string().min(1, "Search query cannot be empty"),
  include_tasks: z.boolean().default(true),
  include_results: z.boolean().default(true),
  include_messages: z.boolean().default(true),
  limit: z.number().int().min(1).max(20).default(5),
});

// ============ Type Exports ============

export type AssignTaskInput = z.infer<typeof AssignTaskSchema>;
export type BroadcastTaskInput = z.infer<typeof BroadcastTaskSchema>;
export type CancelTaskInput = z.infer<typeof CancelTaskSchema>;
export type GetTaskResultInput = z.infer<typeof GetTaskResultSchema>;
export type GetAllResultsInput = z.infer<typeof GetAllResultsSchema>;
export type GetAgentWorkloadInput = z.infer<typeof GetAgentWorkloadSchema>;
export type GetAgentMetricsInput = z.infer<typeof GetAgentMetricsSchema>;
export type UpdateSharedContextInput = z.infer<typeof UpdateSharedContextSchema>;
export type QueryTaskHistoryInput = z.infer<typeof QueryTaskHistorySchema>;
export type GetTaskDetailsInput = z.infer<typeof GetTaskDetailsSchema>;
export type GetMessageHistoryInput = z.infer<typeof GetMessageHistorySchema>;
export type SearchSimilarTasksInput = z.infer<typeof SearchSimilarTasksSchema>;
export type SearchSimilarResultsInput = z.infer<typeof SearchSimilarResultsSchema>;
export type SearchMessageHistoryInput = z.infer<typeof SearchMessageHistorySchema>;
export type GetRelatedMemoryInput = z.infer<typeof GetRelatedMemorySchema>;
