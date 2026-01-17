/**
 * WorktreeManager - Git worktree lifecycle management for agents
 *
 * Provides isolated git worktrees for each agent to enable parallel development
 * without file conflicts. Work is merged back when tasks complete.
 *
 * Usage:
 *   const manager = getWorktreeManager(process.cwd());
 *   const info = await manager.provision(agentId);
 *   // Agent works in info.path with branch info.branch
 *   await manager.merge(agentId);
 *   await manager.cleanup(agentId);
 */

import { $ } from 'bun';
import { existsSync, mkdirSync, rmSync } from 'fs';
import type { WorktreeConfig } from '../interfaces/pty';

export interface WorktreeInfo {
  agentId: number;
  path: string;
  branch: string;
  baseBranch: string;
  createdAt: Date;
  status: 'active' | 'merged' | 'conflict' | 'cleaned';
}

export interface MergeResult {
  success: boolean;
  conflictFiles?: string[];
  commitHash?: string;
  error?: string;
}

const DEFAULT_CONFIG: Required<WorktreeConfig> = {
  enabled: true,
  basePath: '.worktrees',
  branchStrategy: 'per-agent',
  baseBranch: 'main',
  autoMerge: false,
  cleanupOnShutdown: true,
  conflictStrategy: 'abort',
};

export class WorktreeManager {
  private worktrees: Map<number, WorktreeInfo> = new Map();
  private repoPath: string;
  private config: Required<WorktreeConfig>;

  constructor(repoPath: string, config?: Partial<WorktreeConfig>) {
    this.repoPath = repoPath;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Resolve basePath relative to repoPath
    if (!this.config.basePath.startsWith('/')) {
      this.config.basePath = `${repoPath}/${this.config.basePath}`;
    }

    // Ensure base directory exists
    if (!existsSync(this.config.basePath)) {
      mkdirSync(this.config.basePath, { recursive: true });
    }
  }

  /**
   * Provision a new worktree for an agent
   */
  async provision(agentId: number, taskId?: string): Promise<WorktreeInfo> {
    // Detect base branch
    const baseBranch = await this.detectBaseBranch();

    // Generate branch name based on strategy
    const branchName = this.generateBranchName(agentId, taskId);

    // Worktree path
    const worktreePath = `${this.config.basePath}/agent-${agentId}`;

    // Check if worktree already exists for this agent
    if (this.worktrees.has(agentId)) {
      const existing = this.worktrees.get(agentId)!;
      if (existsSync(existing.path)) {
        return existing;
      }
    }

    // Clean up any stale worktree at this path
    await this.cleanupStalePath(worktreePath);

    // Prune any orphaned worktrees
    await $`git -C ${this.repoPath} worktree prune`.quiet().nothrow();

    // Create new branch from base
    await $`git -C ${this.repoPath} branch -D ${branchName}`.quiet().nothrow();
    await $`git -C ${this.repoPath} checkout -b ${branchName} ${baseBranch}`.quiet().nothrow();
    await $`git -C ${this.repoPath} checkout ${baseBranch}`.quiet().nothrow();

    // Add worktree
    const result = await $`git -C ${this.repoPath} worktree add ${worktreePath} ${branchName}`.quiet().nothrow();

    if (result.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${result.stderr}`);
    }

    const info: WorktreeInfo = {
      agentId,
      path: worktreePath,
      branch: branchName,
      baseBranch,
      createdAt: new Date(),
      status: 'active',
    };

    this.worktrees.set(agentId, info);
    return info;
  }

  /**
   * Merge agent's work back to base branch
   */
  async merge(agentId: number): Promise<MergeResult> {
    const info = this.worktrees.get(agentId);
    if (!info) {
      return { success: false, error: 'No worktree found for agent' };
    }

    // Check for uncommitted changes in worktree
    const status = await $`git -C ${info.path} status --porcelain`.text().catch(() => '');
    if (status.trim()) {
      if (this.config.conflictStrategy === 'stash') {
        await $`git -C ${info.path} stash push -m "auto-stash-agent-${agentId}"`.quiet().nothrow();
      } else {
        return {
          success: false,
          error: 'Uncommitted changes in worktree',
          conflictFiles: status.split('\n').filter(Boolean).map(l => l.slice(3)),
        };
      }
    }

    // Check if there are any commits to merge
    const logOutput = await $`git -C ${info.path} log ${info.baseBranch}..${info.branch} --oneline`.text().catch(() => '');
    if (!logOutput.trim()) {
      // No commits to merge
      info.status = 'merged';
      return { success: true, commitHash: undefined };
    }

    // Switch to base branch in main repo
    await $`git -C ${this.repoPath} checkout ${info.baseBranch}`.quiet().nothrow();

    // Attempt merge
    const mergeResult = await $`git -C ${this.repoPath} merge --no-ff ${info.branch} -m "Merge agent-${agentId} work from ${info.branch}"`.quiet().nothrow();

    if (mergeResult.exitCode === 0) {
      const commitHash = await $`git -C ${this.repoPath} rev-parse HEAD`.text().catch(() => '');
      info.status = 'merged';
      return {
        success: true,
        commitHash: commitHash.trim(),
      };
    }

    // Handle merge conflict
    const conflictFiles = await this.getConflictFiles();

    if (this.config.conflictStrategy === 'abort') {
      await $`git -C ${this.repoPath} merge --abort`.quiet().nothrow();
    } else if (this.config.conflictStrategy === 'theirs') {
      await $`git -C ${this.repoPath} checkout --theirs .`.quiet().nothrow();
      await $`git -C ${this.repoPath} add .`.quiet().nothrow();
      await $`git -C ${this.repoPath} commit -m "Merge agent-${agentId} (accept theirs)"`.quiet().nothrow();
      info.status = 'merged';
      return { success: true };
    } else if (this.config.conflictStrategy === 'ours') {
      await $`git -C ${this.repoPath} checkout --ours .`.quiet().nothrow();
      await $`git -C ${this.repoPath} add .`.quiet().nothrow();
      await $`git -C ${this.repoPath} commit -m "Merge agent-${agentId} (keep ours)"`.quiet().nothrow();
      info.status = 'merged';
      return { success: true };
    }

    info.status = 'conflict';

    return {
      success: false,
      error: 'Merge conflict',
      conflictFiles,
    };
  }

  /**
   * Cleanup worktree for agent
   */
  async cleanup(agentId: number): Promise<void> {
    const info = this.worktrees.get(agentId);
    if (!info) return;

    // Remove worktree
    await $`git -C ${this.repoPath} worktree remove --force ${info.path}`.quiet().nothrow();

    // Force remove directory if still exists
    if (existsSync(info.path)) {
      rmSync(info.path, { recursive: true, force: true });
    }

    // Delete branch only if merged (to avoid losing work)
    if (info.status === 'merged') {
      await $`git -C ${this.repoPath} branch -d ${info.branch}`.quiet().nothrow();
    }

    // Prune orphaned worktrees
    await $`git -C ${this.repoPath} worktree prune`.quiet().nothrow();

    info.status = 'cleaned';
    this.worktrees.delete(agentId);
  }

  /**
   * Get worktree info for agent
   */
  getWorktree(agentId: number): WorktreeInfo | null {
    return this.worktrees.get(agentId) || null;
  }

  /**
   * Get all active worktrees
   */
  getAllWorktrees(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }

  /**
   * Sync worktree with base branch (rebase or merge)
   */
  async syncWithBase(agentId: number, strategy: 'rebase' | 'merge' = 'rebase'): Promise<boolean> {
    const info = this.worktrees.get(agentId);
    if (!info) return false;

    try {
      // Fetch latest
      await $`git -C ${info.path} fetch origin ${info.baseBranch}`.quiet().nothrow();

      if (strategy === 'rebase') {
        const result = await $`git -C ${info.path} rebase origin/${info.baseBranch}`.quiet().nothrow();
        return result.exitCode === 0;
      } else {
        const result = await $`git -C ${info.path} merge origin/${info.baseBranch}`.quiet().nothrow();
        return result.exitCode === 0;
      }
    } catch {
      return false;
    }
  }

  /**
   * Get git status for a worktree
   */
  async getWorktreeStatus(agentId: number): Promise<{ clean: boolean; changes: string[] }> {
    const info = this.worktrees.get(agentId);
    if (!info) return { clean: true, changes: [] };

    const status = await $`git -C ${info.path} status --porcelain`.text().catch(() => '');
    const changes = status.split('\n').filter(Boolean);

    return {
      clean: changes.length === 0,
      changes,
    };
  }

  /**
   * List all git worktrees (including external ones)
   */
  async listAllGitWorktrees(): Promise<string[]> {
    const output = await $`git -C ${this.repoPath} worktree list --porcelain`.text().catch(() => '');
    const lines = output.split('\n');
    const worktrees: string[] = [];

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        worktrees.push(line.slice(9));
      }
    }

    return worktrees;
  }

  /**
   * Shutdown - cleanup all worktrees
   */
  async shutdown(): Promise<void> {
    if (!this.config.cleanupOnShutdown) return;

    for (const agentId of this.worktrees.keys()) {
      await this.cleanup(agentId);
    }
  }

  // Private helpers

  private async detectBaseBranch(): Promise<string> {
    // Try configured branch first
    const check = await $`git -C ${this.repoPath} rev-parse --verify ${this.config.baseBranch}`.quiet().nothrow();
    if (check.exitCode === 0) {
      return this.config.baseBranch;
    }

    // Fall back to main/master
    for (const branch of ['main', 'master']) {
      const result = await $`git -C ${this.repoPath} rev-parse --verify ${branch}`.quiet().nothrow();
      if (result.exitCode === 0) {
        return branch;
      }
    }

    // Use current branch
    const current = await $`git -C ${this.repoPath} branch --show-current`.text().catch(() => 'main');
    return current.trim() || 'main';
  }

  private generateBranchName(agentId: number, taskId?: string): string {
    const timestamp = Date.now();

    switch (this.config.branchStrategy) {
      case 'per-task':
        return `agent-${agentId}/task-${taskId || timestamp}`;
      case 'per-agent':
      default:
        return `agent-${agentId}/work-${timestamp}`;
    }
  }

  private async cleanupStalePath(path: string): Promise<void> {
    if (existsSync(path)) {
      // Try to remove via git first
      await $`git -C ${this.repoPath} worktree remove --force ${path}`.quiet().nothrow();

      // If still exists, force remove directory
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
      }
    }
  }

  private async getConflictFiles(): Promise<string[]> {
    const output = await $`git -C ${this.repoPath} diff --name-only --diff-filter=U`.text().catch(() => '');
    return output.split('\n').filter(Boolean);
  }
}

// Singleton factory
let instance: WorktreeManager | null = null;

export function getWorktreeManager(repoPath?: string, config?: Partial<WorktreeConfig>): WorktreeManager {
  if (!instance) {
    if (!repoPath) {
      repoPath = process.cwd();
    }
    instance = new WorktreeManager(repoPath, config);
  }
  return instance;
}

// Reset singleton (for testing)
export function resetWorktreeManager(): void {
  instance = null;
}

export default WorktreeManager;
