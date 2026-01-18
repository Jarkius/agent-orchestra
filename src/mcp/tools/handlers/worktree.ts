/**
 * Worktree Management Tool
 * Consolidated MCP tool for git worktree lifecycle management
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler, MCPResponse } from '../../types';
import { jsonResponse, errorResponse } from '../../utils/response';
import { getWorktreeManager } from '../../../pty/worktree-manager';

// ============ Schema ============

const WorktreeSchema = z.object({
  action: z.enum(['provision', 'merge', 'sync', 'cleanup', 'status', 'list']),
  agent_id: z.number().optional(),
  task_id: z.string().optional(),
  base_branch: z.string().optional(),
  conflict_strategy: z.enum(['abort', 'stash', 'theirs', 'ours']).optional(),
  strategy: z.enum(['rebase', 'merge']).optional(),
});

// ============ Tool Definition ============

export const worktreeTools: ToolDefinition[] = [
  {
    name: 'worktree',
    description: 'Git worktree ops',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['provision', 'merge', 'sync', 'cleanup', 'status', 'list'] },
        agent_id: { type: 'number' },
        task_id: { type: 'string' },
        base_branch: { type: 'string' },
        conflict_strategy: { type: 'string', enum: ['abort', 'stash', 'theirs', 'ours'] },
        strategy: { type: 'string', enum: ['rebase', 'merge'] },
      },
      required: ['action'],
    },
  },
];

// ============ Handler ============

async function handleWorktree(args: unknown): Promise<MCPResponse> {
  const parsed = WorktreeSchema.parse(args);
  const { action, agent_id } = parsed;

  // Validate agent_id requirement for most actions
  if (action !== 'list' && agent_id === undefined) {
    return errorResponse(`agent_id required for action: ${action}`);
  }

  try {
    switch (action) {
      case 'provision': {
        const manager = getWorktreeManager(process.cwd(), {
          baseBranch: parsed.base_branch,
          conflictStrategy: parsed.conflict_strategy,
        });
        const info = await manager.provision(agent_id!, parsed.task_id);
        return jsonResponse({
          agent_id: info.agentId,
          path: info.path,
          branch: info.branch,
          base_branch: info.baseBranch,
          created_at: info.createdAt.toISOString(),
          status: info.status,
        });
      }

      case 'merge': {
        const manager = getWorktreeManager();
        const info = manager.getWorktree(agent_id!);
        if (!info) {
          return errorResponse(`No worktree found for agent ${agent_id}`);
        }
        const result = await manager.merge(agent_id!);
        return jsonResponse({
          success: result.success,
          agent_id,
          branch: info.branch,
          base_branch: info.baseBranch,
          commit_hash: result.commitHash,
          conflict_files: result.conflictFiles,
          error: result.error,
        });
      }

      case 'sync': {
        const manager = getWorktreeManager();
        const info = manager.getWorktree(agent_id!);
        if (!info) {
          return errorResponse(`No worktree found for agent ${agent_id}`);
        }
        const strategy = parsed.strategy || 'rebase';
        const success = await manager.syncWithBase(agent_id!, strategy);
        return jsonResponse({
          success,
          agent_id,
          strategy,
          branch: info.branch,
          base_branch: info.baseBranch,
        });
      }

      case 'cleanup': {
        const manager = getWorktreeManager();
        const info = manager.getWorktree(agent_id!);
        if (!info) {
          return jsonResponse({
            success: true,
            agent_id,
            message: 'No worktree found (already cleaned up)',
          });
        }
        const branch = info.branch;
        const path = info.path;
        await manager.cleanup(agent_id!);
        return jsonResponse({
          success: true,
          agent_id,
          cleaned_path: path,
          cleaned_branch: branch,
        });
      }

      case 'status': {
        const manager = getWorktreeManager();
        const info = manager.getWorktree(agent_id!);
        if (!info) {
          return jsonResponse({ agent_id, has_worktree: false });
        }
        const status = await manager.getWorktreeStatus(agent_id!);
        return jsonResponse({
          agent_id,
          has_worktree: true,
          path: info.path,
          branch: info.branch,
          base_branch: info.baseBranch,
          status: info.status,
          created_at: info.createdAt.toISOString(),
          clean: status.clean,
          changes: status.changes,
        });
      }

      case 'list': {
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
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (error) {
    return errorResponse(`Worktree ${action} failed: ${error}`);
  }
}

// ============ Export ============

export const worktreeHandlers: Record<string, ToolHandler> = {
  worktree: handleWorktree,
};
