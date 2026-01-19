/**
 * Git Context Utilities
 * Helpers for capturing git state - used by memory save and recall
 */

import { execSync } from 'child_process';

export interface GitContext {
  branch: string;
  recentCommits: string[];
  filesChanged: string[];
  diffSummary: string;
}

export interface GitStatus {
  branch: string;
  uncommitted: { path: string; status: string }[];
  staged: { path: string; status: string }[];
  untracked: string[];
}

export interface GitChangesSince {
  newCommits: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/**
 * Capture current git context for session saving
 */
export function captureGitContext(): GitContext | null {
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();

    // Get recent commits (last 10)
    const commitsRaw = execSync('git log --oneline -10 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
    const recentCommits = commitsRaw ? commitsRaw.split('\n').filter(Boolean) : [];

    // Get files changed in working tree + staged
    const filesRaw = execSync('git diff --name-only HEAD~5 2>/dev/null || git diff --name-only --cached 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
    const filesChanged = filesRaw ? [...new Set(filesRaw.split('\n').filter(Boolean))] : [];

    // Get a summary of changes (insertions/deletions)
    let diffSummary = '';
    try {
      const shortstat = execSync('git diff --shortstat HEAD~5 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
      if (shortstat) {
        diffSummary = shortstat;
      }
    } catch {
      // Ignore if we can't get diff summary
    }

    return { branch, recentCommits, filesChanged, diffSummary };
  } catch {
    return null;
  }
}

/**
 * Get current git status (uncommitted changes, staged files, etc.)
 */
export function getGitStatus(): GitStatus | null {
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();

    // Get status in porcelain format
    const statusRaw = execSync('git status --porcelain 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
    const lines = statusRaw ? statusRaw.split('\n').filter(Boolean) : [];

    const uncommitted: { path: string; status: string }[] = [];
    const staged: { path: string; status: string }[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const path = line.slice(3);

      if (indexStatus === '?' && workTreeStatus === '?') {
        untracked.push(path);
      } else {
        if (indexStatus !== ' ' && indexStatus !== '?') {
          staged.push({ path, status: indexStatus || ' ' });
        }
        if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
          uncommitted.push({ path, status: workTreeStatus || ' ' });
        }
      }
    }

    return { branch, uncommitted, staged, untracked };
  } catch {
    return null;
  }
}

/**
 * Get recent commits since a specific date or commit hash
 */
export function getRecentCommits(since?: string, limit = 10): string[] {
  try {
    let cmd = `git log --oneline -${limit}`;
    if (since) {
      // Check if it's a commit hash (7+ hex chars) or a date
      if (/^[a-f0-9]{7,}$/i.test(since)) {
        cmd = `git log --oneline ${since}..HEAD`;
      } else {
        cmd = `git log --oneline --since="${since}"`;
      }
    }
    const raw = execSync(`${cmd} 2>/dev/null || echo ""`, { encoding: 'utf-8' }).trim();
    return raw ? raw.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Get changes since a specific commit
 */
export function getChangesSinceCommit(commitHash: string): GitChangesSince | null {
  try {
    // Get new commits
    const commitsRaw = execSync(`git log --oneline ${commitHash}..HEAD 2>/dev/null || echo ""`, { encoding: 'utf-8' }).trim();
    const newCommits = commitsRaw ? commitsRaw.split('\n').filter(Boolean) : [];

    // Get stats
    const statsRaw = execSync(`git diff --shortstat ${commitHash} 2>/dev/null || echo ""`, { encoding: 'utf-8' }).trim();

    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    if (statsRaw) {
      // Parse "3 files changed, 120 insertions(+), 45 deletions(-)"
      const filesMatch = statsRaw.match(/(\d+) files? changed/);
      const insertMatch = statsRaw.match(/(\d+) insertions?\(\+\)/);
      const deleteMatch = statsRaw.match(/(\d+) deletions?\(-\)/);

      if (filesMatch) filesChanged = parseInt(filesMatch[1] ?? '0');
      if (insertMatch) insertions = parseInt(insertMatch[1] ?? '0');
      if (deleteMatch) deletions = parseInt(deleteMatch[1] ?? '0');
    }

    return { newCommits, filesChanged, insertions, deletions };
  } catch {
    return null;
  }
}

/**
 * Extract the first commit hash from git context (for comparison)
 */
export function getLastCommitHash(gitCommits?: string[]): string | null {
  if (!gitCommits || gitCommits.length === 0) return null;
  // Format is "abc1234 commit message"
  const match = gitCommits[0]!.match(/^([a-f0-9]+)/i);
  return match ? (match[1] ?? null) : null;
}
