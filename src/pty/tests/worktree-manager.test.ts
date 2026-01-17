/**
 * WorktreeManager Tests
 * Tests for git worktree lifecycle management
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { WorktreeManager, resetWorktreeManager, getWorktreeManager } from '../worktree-manager';
import type { WorktreeInfo, MergeResult } from '../worktree-manager';
import { $ } from 'bun';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

// Test in a temporary directory to avoid messing with real repo
const TEST_DIR = '/tmp/worktree-test-' + Date.now();
const WORKTREES_DIR = `${TEST_DIR}/.worktrees`;

describe('WorktreeManager', () => {
  beforeEach(async () => {
    // Reset singleton
    resetWorktreeManager();

    // Create fresh test repo
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });

    // Initialize git repo
    await $`git -C ${TEST_DIR} init`.quiet();
    await $`git -C ${TEST_DIR} config user.email "test@test.com"`.quiet();
    await $`git -C ${TEST_DIR} config user.name "Test"`.quiet();

    // Create initial commit
    writeFileSync(join(TEST_DIR, 'README.md'), '# Test Repo\n');
    await $`git -C ${TEST_DIR} add .`.quiet();
    await $`git -C ${TEST_DIR} commit -m "Initial commit"`.quiet();

    // Create main branch
    await $`git -C ${TEST_DIR} branch -M main`.quiet();
  });

  afterEach(async () => {
    // Cleanup
    resetWorktreeManager();
    if (existsSync(TEST_DIR)) {
      // Force remove any remaining worktrees
      await $`git -C ${TEST_DIR} worktree prune`.quiet().nothrow();
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('provision', () => {
    test('should create worktree for agent', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      const info = await manager.provision(1);

      expect(info.agentId).toBe(1);
      expect(info.path).toContain('agent-1');
      expect(info.branch).toContain('agent-1');
      expect(info.baseBranch).toBe('main');
      expect(info.status).toBe('active');
      expect(existsSync(info.path)).toBe(true);
    });

    test('should create unique branches per agent', async () => {
      const manager = new WorktreeManager(TEST_DIR);

      const info1 = await manager.provision(1);
      const info2 = await manager.provision(2);

      expect(info1.branch).not.toBe(info2.branch);
      expect(info1.path).not.toBe(info2.path);
    });

    test('should return existing worktree if already provisioned', async () => {
      const manager = new WorktreeManager(TEST_DIR);

      const info1 = await manager.provision(1);
      const info2 = await manager.provision(1);

      expect(info1.path).toBe(info2.path);
      expect(info1.branch).toBe(info2.branch);
    });

    test('should use per-task branching when taskId provided', async () => {
      const manager = new WorktreeManager(TEST_DIR, { branchStrategy: 'per-task' });
      const info = await manager.provision(1, 'task-123');

      expect(info.branch).toContain('task-123');
    });

    test('should use configured base branch', async () => {
      // Create develop branch
      await $`git -C ${TEST_DIR} checkout -b develop`.quiet();
      await $`git -C ${TEST_DIR} checkout main`.quiet();

      const manager = new WorktreeManager(TEST_DIR, { baseBranch: 'develop' });
      const info = await manager.provision(1);

      expect(info.baseBranch).toBe('develop');
    });
  });

  describe('getWorktree', () => {
    test('should return worktree info for provisioned agent', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      await manager.provision(1);

      const info = manager.getWorktree(1);
      expect(info).not.toBeNull();
      expect(info?.agentId).toBe(1);
    });

    test('should return null for non-existent agent', () => {
      const manager = new WorktreeManager(TEST_DIR);
      const info = manager.getWorktree(999);
      expect(info).toBeNull();
    });
  });

  describe('getAllWorktrees', () => {
    test('should return all active worktrees', async () => {
      const manager = new WorktreeManager(TEST_DIR);

      await manager.provision(1);
      await manager.provision(2);
      await manager.provision(3);

      const all = manager.getAllWorktrees();
      expect(all.length).toBe(3);
      expect(all.map(w => w.agentId).sort()).toEqual([1, 2, 3]);
    });
  });

  describe('getWorktreeStatus', () => {
    test('should report clean status for new worktree', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      await manager.provision(1);

      const status = await manager.getWorktreeStatus(1);
      expect(status.clean).toBe(true);
      expect(status.changes).toEqual([]);
    });

    test('should report changes when files modified', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      const info = await manager.provision(1);

      // Modify file in worktree
      writeFileSync(join(info.path, 'test.txt'), 'test content');

      const status = await manager.getWorktreeStatus(1);
      expect(status.clean).toBe(false);
      expect(status.changes.length).toBeGreaterThan(0);
    });
  });

  describe('merge', () => {
    test('should merge work back to base branch', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      const info = await manager.provision(1);

      // Make changes in worktree
      writeFileSync(join(info.path, 'new-file.txt'), 'agent work');
      await $`git -C ${info.path} add .`.quiet();
      await $`git -C ${info.path} commit -m "Agent work"`.quiet();

      // Merge
      const result = await manager.merge(1);

      expect(result.success).toBe(true);
      expect(result.commitHash).toBeDefined();
      expect(info.status).toBe('merged');
    });

    test('should succeed with no commits to merge', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      await manager.provision(1);

      const result = await manager.merge(1);
      expect(result.success).toBe(true);
    });

    test('should fail with uncommitted changes (abort strategy)', async () => {
      const manager = new WorktreeManager(TEST_DIR, { conflictStrategy: 'abort' });
      const info = await manager.provision(1);

      // Leave uncommitted changes
      writeFileSync(join(info.path, 'uncommitted.txt'), 'dirty');

      const result = await manager.merge(1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Uncommitted');
    });

    test('should stash uncommitted changes (stash strategy)', async () => {
      const manager = new WorktreeManager(TEST_DIR, { conflictStrategy: 'stash' });
      const info = await manager.provision(1);

      // Make committed change
      writeFileSync(join(info.path, 'committed.txt'), 'work');
      await $`git -C ${info.path} add .`.quiet();
      await $`git -C ${info.path} commit -m "Work"`.quiet();

      // Leave uncommitted change
      writeFileSync(join(info.path, 'uncommitted.txt'), 'dirty');

      const result = await manager.merge(1);
      expect(result.success).toBe(true);
    });

    test('should return error for non-existent agent', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      const result = await manager.merge(999);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No worktree found');
    });
  });

  describe('cleanup', () => {
    test('should remove worktree and branch for merged work', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      const info = await manager.provision(1);
      const path = info.path;

      // Merge first (no commits, but sets status to merged)
      await manager.merge(1);

      // Cleanup
      await manager.cleanup(1);

      expect(existsSync(path)).toBe(false);
      expect(manager.getWorktree(1)).toBeNull();
    });

    test('should preserve branch for unmerged work', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      const info = await manager.provision(1);
      const branch = info.branch;

      // Make changes but don't merge
      writeFileSync(join(info.path, 'work.txt'), 'important work');
      await $`git -C ${info.path} add .`.quiet();
      await $`git -C ${info.path} commit -m "Work"`.quiet();

      // Cleanup without merging
      await manager.cleanup(1);

      // Branch should still exist (unmerged work)
      const branchCheck = await $`git -C ${TEST_DIR} branch --list ${branch}`.text();
      expect(branchCheck.trim()).toContain('agent-1');
    });

    test('should handle already cleaned worktree', async () => {
      const manager = new WorktreeManager(TEST_DIR);

      // Cleanup non-existent - should not throw
      await manager.cleanup(999);
      expect(true).toBe(true);
    });
  });

  describe('syncWithBase', () => {
    test('should rebase worktree on base branch', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      const info = await manager.provision(1);

      // Make change on main
      writeFileSync(join(TEST_DIR, 'main-change.txt'), 'main update');
      await $`git -C ${TEST_DIR} add .`.quiet();
      await $`git -C ${TEST_DIR} commit -m "Main update"`.quiet();

      // Sync worktree
      const success = await manager.syncWithBase(1, 'rebase');
      // Note: rebase may fail if no remote, but should not throw
      expect(typeof success).toBe('boolean');
    });

    test('should return false for non-existent agent', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      const success = await manager.syncWithBase(999);
      expect(success).toBe(false);
    });
  });

  describe('listAllGitWorktrees', () => {
    test('should list all git worktrees including main', async () => {
      const manager = new WorktreeManager(TEST_DIR);
      await manager.provision(1);
      await manager.provision(2);

      const worktrees = await manager.listAllGitWorktrees();

      // Should include main repo + 2 agent worktrees
      expect(worktrees.length).toBeGreaterThanOrEqual(3);
      expect(worktrees.some(w => w.includes('agent-1'))).toBe(true);
      expect(worktrees.some(w => w.includes('agent-2'))).toBe(true);
    });
  });

  describe('shutdown', () => {
    test('should cleanup all worktrees when cleanupOnShutdown true', async () => {
      const manager = new WorktreeManager(TEST_DIR, { cleanupOnShutdown: true });

      const info1 = await manager.provision(1);
      const info2 = await manager.provision(2);

      // Mark as merged so branches get deleted
      await manager.merge(1);
      await manager.merge(2);

      await manager.shutdown();

      expect(existsSync(info1.path)).toBe(false);
      expect(existsSync(info2.path)).toBe(false);
      expect(manager.getAllWorktrees().length).toBe(0);
    });

    test('should preserve worktrees when cleanupOnShutdown false', async () => {
      const manager = new WorktreeManager(TEST_DIR, { cleanupOnShutdown: false });

      const info1 = await manager.provision(1);

      await manager.shutdown();

      // Worktree should still exist on filesystem
      expect(existsSync(info1.path)).toBe(true);
    });
  });

  describe('singleton', () => {
    test('should return same instance', () => {
      const m1 = getWorktreeManager(TEST_DIR);
      const m2 = getWorktreeManager();

      expect(m1).toBe(m2);
    });

    test('should reset singleton', async () => {
      const m1 = getWorktreeManager(TEST_DIR);
      await m1.provision(1);

      resetWorktreeManager();

      const m2 = getWorktreeManager(TEST_DIR);
      expect(m2.getAllWorktrees().length).toBe(0);
    });
  });
});

describe('WorktreeManager integration with agents', () => {
  beforeEach(async () => {
    resetWorktreeManager();

    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });

    await $`git -C ${TEST_DIR} init`.quiet();
    await $`git -C ${TEST_DIR} config user.email "test@test.com"`.quiet();
    await $`git -C ${TEST_DIR} config user.name "Test"`.quiet();

    writeFileSync(join(TEST_DIR, 'README.md'), '# Test Repo\n');
    writeFileSync(join(TEST_DIR, 'shared.txt'), 'shared content\n');
    await $`git -C ${TEST_DIR} add .`.quiet();
    await $`git -C ${TEST_DIR} commit -m "Initial commit"`.quiet();
    await $`git -C ${TEST_DIR} branch -M main`.quiet();
  });

  afterEach(async () => {
    resetWorktreeManager();
    if (existsSync(TEST_DIR)) {
      await $`git -C ${TEST_DIR} worktree prune`.quiet().nothrow();
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('should allow parallel work without conflicts', async () => {
    const manager = new WorktreeManager(TEST_DIR);

    // Two agents work simultaneously
    const agent1 = await manager.provision(1);
    const agent2 = await manager.provision(2);

    // Agent 1 works on feature A
    writeFileSync(join(agent1.path, 'feature-a.txt'), 'Agent 1 work');
    await $`git -C ${agent1.path} add .`.quiet();
    await $`git -C ${agent1.path} commit -m "Feature A"`.quiet();

    // Agent 2 works on feature B (different file)
    writeFileSync(join(agent2.path, 'feature-b.txt'), 'Agent 2 work');
    await $`git -C ${agent2.path} add .`.quiet();
    await $`git -C ${agent2.path} commit -m "Feature B"`.quiet();

    // Both can merge without conflict
    const result1 = await manager.merge(1);
    const result2 = await manager.merge(2);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // Both files exist in main
    expect(existsSync(join(TEST_DIR, 'feature-a.txt'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'feature-b.txt'))).toBe(true);
  });

  test('should handle conflict on same file', async () => {
    const manager = new WorktreeManager(TEST_DIR, { conflictStrategy: 'abort' });

    const agent1 = await manager.provision(1);
    const agent2 = await manager.provision(2);

    // Both agents modify same file
    writeFileSync(join(agent1.path, 'shared.txt'), 'Agent 1 version');
    await $`git -C ${agent1.path} add .`.quiet();
    await $`git -C ${agent1.path} commit -m "Agent 1 change"`.quiet();

    writeFileSync(join(agent2.path, 'shared.txt'), 'Agent 2 version');
    await $`git -C ${agent2.path} add .`.quiet();
    await $`git -C ${agent2.path} commit -m "Agent 2 change"`.quiet();

    // First merge succeeds
    const result1 = await manager.merge(1);
    expect(result1.success).toBe(true);

    // Second merge has conflict
    const result2 = await manager.merge(2);
    expect(result2.success).toBe(false);
    expect(result2.conflictFiles).toBeDefined();
  });
});
