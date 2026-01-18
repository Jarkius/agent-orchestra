/**
 * Worktree Management Tools
 * MCP tools for git worktree lifecycle management
 *
 * Provides:
 * - provision_worktree: Create isolated worktree for an agent
 * - merge_worktree: Merge agent's work back to base branch
 * - sync_worktree: Sync worktree with base branch (rebase/merge)
 * - cleanup_worktree: Remove worktree and optionally delete branch
 * - get_worktree_status: Get status of agent's worktree
 * - list_worktrees: List all active worktrees
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler, MCPResponse } from '../../types';
import { jsonResponse, errorResponse } from '../../utils/response';
import { getWorktreeManager } from '../../../pty/worktree-manager';
import type { WorktreeInfo, MergeResult } from '../../../pty/worktree-manager';

// ============ Schemas ============

const ProvisionWorktreeSchema = z.object({
  agent_id: z.number(),
  task_id: z.string().optional(),
  base_branch: z.string().optional(),
  conflict_strategy: z.enum(['abort', 'stash', 'theirs', 'ours']).optional(),
});

const AgentIdSchema = z.object({
  agent_id: z.number(),
});

const SyncWorktreeSchema = z.object({
  agent_id: z.number(),
  strategy: z.enum(['rebase', 'merge']).optional(),
});

// ============ Tool Definitions ============

export const worktreeTools: ToolDefinition[] = [
  {
    name: 'provision_worktree',
    description: 'Create worktree',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'number' },
        task_id: { type: 'string' },
        base_branch: { type: 'string' },
        conflict_strategy: { type: 'string', enum: ['abort', 'stash', 'theirs', 'ours'] },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'merge_worktree',
    description: 'Merge worktree',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'number' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'sync_worktree',
    description: 'Sync worktree',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'number' },
        strategy: { type: 'string', enum: ['rebase', 'merge'] },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'cleanup_worktree',
    description: 'Cleanup worktree',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'number' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_worktree_status',
    description: 'Worktree status',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'number' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'list_worktrees',
    description: 'List worktrees',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ============ Handlers ============

async function handleProvisionWorktree(args: unknown): Promise<MCPResponse> {
  const parsed = ProvisionWorktreeSchema.parse(args);

  try {
    const manager = getWorktreeManager(process.cwd(), {
      baseBranch: parsed.base_branch,
      conflictStrategy: parsed.conflict_strategy,
    });

    const info = await manager.provision(parsed.agent_id, parsed.task_id);

    return jsonResponse({
      success: true,
      agent_id: info.agentId,
      path: info.path,
      branch: info.branch,
      base_branch: info.baseBranch,
      created_at: info.createdAt.toISOString(),
      status: info.status,
    });
  } catch (error) {
    return errorResponse(`Failed to provision worktree: ${error}`);
  }
}

async function handleMergeWorktree(args: unknown): Promise<MCPResponse> {
  const parsed = AgentIdSchema.parse(args);

  try {
    const manager = getWorktreeManager();
    const info = manager.getWorktree(parsed.agent_id);

    if (!info) {
      return errorResponse(`No worktree found for agent ${parsed.agent_id}`);
    }

    const result = await manager.merge(parsed.agent_id);

    return jsonResponse({
      success: result.success,
      agent_id: parsed.agent_id,
      branch: info.branch,
      base_branch: info.baseBranch,
      commit_hash: result.commitHash,
      conflict_files: result.conflictFiles,
      error: result.error,
    });
  } catch (error) {
    return errorResponse(`Failed to merge worktree: ${error}`);
  }
}

async function handleSyncWorktree(args: unknown): Promise<MCPResponse> {
  const parsed = SyncWorktreeSchema.parse(args);

  try {
    const manager = getWorktreeManager();
    const info = manager.getWorktree(parsed.agent_id);

    if (!info) {
      return errorResponse(`No worktree found for agent ${parsed.agent_id}`);
    }

    const strategy = parsed.strategy || 'rebase';
    const success = await manager.syncWithBase(parsed.agent_id, strategy);

    return jsonResponse({
      success,
      agent_id: parsed.agent_id,
      strategy,
      branch: info.branch,
      base_branch: info.baseBranch,
    });
  } catch (error) {
    return errorResponse(`Failed to sync worktree: ${error}`);
  }
}

async function handleCleanupWorktree(args: unknown): Promise<MCPResponse> {
  const parsed = AgentIdSchema.parse(args);

  try {
    const manager = getWorktreeManager();
    const info = manager.getWorktree(parsed.agent_id);

    if (!info) {
      return jsonResponse({
        success: true,
        agent_id: parsed.agent_id,
        message: 'No worktree found (already cleaned up)',
      });
    }

    const branch = info.branch;
    const path = info.path;

    await manager.cleanup(parsed.agent_id);

    return jsonResponse({
      success: true,
      agent_id: parsed.agent_id,
      cleaned_path: path,
      cleaned_branch: branch,
    });
  } catch (error) {
    return errorResponse(`Failed to cleanup worktree: ${error}`);
  }
}

async function handleGetWorktreeStatus(args: unknown): Promise<MCPResponse> {
  const parsed = AgentIdSchema.parse(args);

  try {
    const manager = getWorktreeManager();
    const info = manager.getWorktree(parsed.agent_id);

    if (!info) {
      return jsonResponse({
        agent_id: parsed.agent_id,
        has_worktree: false,
      });
    }

    const status = await manager.getWorktreeStatus(parsed.agent_id);

    return jsonResponse({
      agent_id: parsed.agent_id,
      has_worktree: true,
      path: info.path,
      branch: info.branch,
      base_branch: info.baseBranch,
      status: info.status,
      created_at: info.createdAt.toISOString(),
      clean: status.clean,
      changes: status.changes,
    });
  } catch (error) {
    return errorResponse(`Failed to get worktree status: ${error}`);
  }
}

async function handleListWorktrees(): Promise<MCPResponse> {
  try {
    const manager = getWorktreeManager();
    const worktrees = manager.getAllWorktrees();
    const gitWorktrees = await manager.listAllGitWorktrees();

    return jsonResponse({
      managed_worktrees: worktrees.map(w => ({
        agent_id: w.agentId,
        path: w.path,
        branch: w.branch,
        base_branch: w.baseBranch,
        status: w.status,
        created_at: w.createdAt.toISOString(),
      })),
      managed_count: worktrees.length,
      git_worktrees: gitWorktrees,
      git_worktree_count: gitWorktrees.length,
    });
  } catch (error) {
    return errorResponse(`Failed to list worktrees: ${error}`);
  }
}

// ============ Export ============

export const worktreeHandlers: Record<string, ToolHandler> = {
  provision_worktree: handleProvisionWorktree,
  merge_worktree: handleMergeWorktree,
  sync_worktree: handleSyncWorktree,
  cleanup_worktree: handleCleanupWorktree,
  get_worktree_status: handleGetWorktreeStatus,
  list_worktrees: handleListWorktrees,
};
