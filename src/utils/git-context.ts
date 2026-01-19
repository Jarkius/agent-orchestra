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

/**
 * Get commits since a specific ISO date
 */
export function getCommitsSinceDate(isoDate: string): string[] {
  try {
    const cmd = `git log --oneline --since="${isoDate}" 2>/dev/null || echo ""`;
    const raw = execSync(cmd, { encoding: 'utf-8' }).trim();
    return raw ? raw.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Task completion detection result
 */
export interface TaskCompletionHint {
  taskDescription: string;
  likelyCompleted: boolean;
  confidence: number;  // 0-1
  evidence: string[];  // Matching commit messages
}

/**
 * Detect if pending tasks were likely completed based on git history
 */
export function detectTaskCompletion(
  tasks: { description: string; status: string }[],
  sinceDate: string
): TaskCompletionHint[] {
  const commits = getCommitsSinceDate(sinceDate);
  if (commits.length === 0) return [];

  const hints: TaskCompletionHint[] = [];

  for (const task of tasks) {
    if (task.status === 'done') continue;

    // Extract keywords from task description
    const keywords = extractKeywords(task.description);
    if (keywords.length === 0) continue;

    // Find matching commits using fuzzy matching
    const evidence: string[] = [];
    for (const commit of commits) {
      const matchCount = matchesTask(commit, keywords);
      // Require at least 1 exact keyword match or 30% of keywords (lowered threshold for better recall)
      if (matchCount >= 1 || matchCount >= keywords.length * 0.3) {
        evidence.push(commit);
      }
    }

    if (evidence.length > 0) {
      // Calculate confidence based on match quality
      const avgMatchRatio = evidence.length / Math.max(commits.length, 1);
      const confidence = Math.min(0.5 + avgMatchRatio * 0.5, 0.95);

      hints.push({
        taskDescription: task.description,
        likelyCompleted: confidence > 0.6,
        confidence,
        evidence: evidence.slice(0, 3),  // Top 3 matches
      });
    }
  }

  return hints;
}

/**
 * Extract meaningful keywords from text
 * Keeps technical terms and significant words
 */
function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'to', 'of', 'in',
    'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'and', 'but',
    'or', 'not', 'this', 'that', 'these', 'those',
  ]);

  // Keep technical terms that are often part of method/class names
  const technicalTerms = new Set([
    'chromadb', 'chroma', 'vector', 'oracle', 'learning', 'lesson', 'knowledge',
    'session', 'agent', 'mission', 'task', 'harvest', 'cluster', 'recommend',
    'search', 'relevant', 'integrate', 'wire', 'loop', 'collection', 'dual',
    'pattern', 'failure', 'analysis', 'sqlite', 'database', 'table', 'index',
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopwords.has(word));

  // Also extract camelCase/PascalCase parts
  const camelParts: string[] = [];
  for (const word of words) {
    // Split on capital letters: addKnowledge -> add, knowledge
    const parts = word.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
    camelParts.push(...parts.filter(p => p.length > 2));
  }

  // Combine and dedupe
  const allWords = [...new Set([...words, ...camelParts])];

  // Prioritize technical terms but include others
  return allWords;
}

/**
 * Check if commit message matches task keywords
 * Uses fuzzy matching for partial word matches
 */
function matchesTask(commitMsg: string, keywords: string[]): number {
  // Normalize commit: lowercase, remove hyphens to join compound words
  const commitLower = commitMsg.toLowerCase();
  const commitNormalized = commitLower.replace(/-/g, '');  // dual-collection -> dualcollection

  let matches = 0;

  for (const kw of keywords) {
    // Exact match in normalized form
    if (commitNormalized.includes(kw)) {
      matches++;
      continue;
    }
    // Also check original (for hyphenated matches)
    if (commitLower.includes(kw)) {
      matches++;
      continue;
    }
    // Partial match (for compound words)
    if (kw.length >= 4) {
      // Check each word and hyphenated segment
      const commitParts = commitLower.split(/[\s-]+/);
      for (const commitWord of commitParts) {
        if (commitWord.includes(kw) || kw.includes(commitWord)) {
          matches += 0.5;
          break;
        }
      }
    }
  }

  return matches;
}
