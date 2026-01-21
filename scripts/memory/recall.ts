#!/usr/bin/env bun
/**
 * /recall - Smart memory recall for continuing work
 *
 * Usage:
 *   bun memory recall                    # Resume last session (show context to continue)
 *   bun memory recall "session_123..."   # Recall specific session by ID
 *   bun memory recall "#5"               # Recall specific learning by ID
 *   bun memory recall "search query"     # Semantic search
 *
 * Environment:
 *   MEMORY_AGENT_ID                      # Filter by agent ID (set by --agent flag)
 *   MEMORY_PROJECT_PATH                  # Override project path (auto-detected from git root)
 */

import { readdirSync, statSync, readFileSync, lstatSync, readlinkSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { recall, type RecallResult, type SessionWithContext, type LearningWithContext } from '../../src/services/recall-service';
import { type SessionTask, getLearningEntities, getRelatedEntities, updateSessionTaskStatus } from '../../src/db';
import { formatFullContext, formatFullContextEnhanced, getStatusIcon, getConfidenceBadge, truncate } from '../../src/utils/formatters';
import { getGitStatus, getChangesSinceCommit, getLastCommitHash, detectTaskCompletion, type TaskCompletionHint } from '../../src/utils/git-context';

// ============ Enhanced Resume Context ============

interface PlanFile {
  name: string;
  path: string;
  title: string;
  modifiedAgo: string;
}

/**
 * Get recent plan files from ~/.claude/plans/ (modified in last 24 hours)
 */
function getRecentPlanFiles(): PlanFile[] {
  const planDirs = [
    join(homedir(), '.claude', 'plans'),
    join(process.cwd(), '.claude', 'plans'),
  ];

  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  const plans: PlanFile[] = [];

  for (const dir of planDirs) {
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        const age = now - stat.mtimeMs;

        if (age < maxAge) {
          // Extract title from first heading
          let title = '';
          try {
            const content = readFileSync(filePath, 'utf-8');
            const match = content.match(/^#\s+(.+)$/m);
            title = match ? (match[1] ?? '') : '';
          } catch {
            // Ignore read errors
          }

          plans.push({
            name: file,
            path: filePath,
            title,
            modifiedAgo: formatTimeAgo(age),
          });
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  // Sort by most recent first
  return plans.sort((a, b) => a.modifiedAgo.localeCompare(b.modifiedAgo));
}

/**
 * Format milliseconds as human-readable time ago
 */
function formatTimeAgo(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Convert UTC timestamp to local time display
 */
function toLocalTime(utcString?: string): string {
  if (!utcString) return 'unknown';
  const date = new Date(utcString + (utcString.endsWith('Z') ? '' : 'Z'));
  return date.toLocaleString();
}

// Parse arguments and flags
const args = process.argv.slice(2);
const showIndex = args.includes('--index');
const showSummary = args.includes('--summary');
const showFull = !showIndex && !showSummary;

// Extract query (first non-flag argument)
const query = args.find(arg => !arg.startsWith('--'));
const agentId = process.env.MEMORY_AGENT_ID ? parseInt(process.env.MEMORY_AGENT_ID) : undefined;

/**
 * Estimate token count (rough: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Get the git root path for the current directory
 * Returns undefined if not in a git repository
 */
function getGitRootPath(): string | undefined {
  // Allow override via environment variable
  if (process.env.MEMORY_PROJECT_PATH) {
    return process.env.MEMORY_PROJECT_PATH;
  }

  try {
    const root = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return root || undefined;
  } catch {
    // Not in a git repository
    return undefined;
  }
}

/**
 * Check if agents.db is a symlink pointing to another location
 * This indicates a shared database scenario where we should allow cross-project access
 */
function isSharedDatabase(): boolean {
  const dbPath = join(process.cwd(), 'agents.db');
  try {
    const stat = lstatSync(dbPath);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(dbPath);
      // If symlink points outside current directory, it's a shared db
      const targetDir = dirname(target.startsWith('/') ? target : join(process.cwd(), target));
      return targetDir !== process.cwd();
    }
    return false;
  } catch {
    return false;
  }
}

async function main() {
  const projectPath = getGitRootPath();
  const sharedDb = isSharedDatabase();

  // Skip project filtering if using a shared/symlinked database
  const effectiveProjectPath = sharedDb ? undefined : projectPath;

  const result = await recall(query, {
    limit: 5,
    includeLinks: true,
    includeTasks: true,
    agentId,
    includeShared: true,
    projectPath: effectiveProjectPath,  // Filter by current project (unless shared db)
  });

  // Show active filters
  console.log('');
  if (projectPath) {
    console.log(`📁 Project: ${basename(projectPath)}${sharedDb ? ' (shared database)' : ''}`);
  }
  if (agentId !== undefined) {
    console.log(`🔒 Agent ID: ${agentId}`);
  }

  switch (result.type) {
    case 'recent':
      displayResumeContext(result);
      break;
    case 'exact_match':
      displayExactMatch(result);
      break;
    case 'semantic_search':
      displaySearchResults(result);
      break;
  }
}

/**
 * Display resume context - last session with actionable items
 */
function displayResumeContext(result: RecallResult) {
  if (result.sessions.length === 0) {
    console.log('\nNo sessions found. Start a new session with: bun memory save\n');
    return;
  }

  const { session, tasks, linkedSessions } = result.sessions[0]!;

  console.log('\n' + '═'.repeat(60));
  console.log('  RESUME SESSION');
  console.log('═'.repeat(60));

  // Show recent plan files first (actionable)
  const recentPlans = getRecentPlanFiles();
  if (recentPlans.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log('  RECENT PLAN FILES');
    console.log('─'.repeat(40));
    for (const plan of recentPlans.slice(0, 5)) {
      console.log(`  ${plan.name} (${plan.modifiedAgo})`);
      if (plan.title) {
        console.log(`    "${truncate(plan.title, 50)}"`);
      }
    }
  }

  // Show current git status
  const gitStatus = getGitStatus();
  if (gitStatus) {
    const totalChanges = gitStatus.uncommitted.length + gitStatus.staged.length + gitStatus.untracked.length;
    if (totalChanges > 0) {
      console.log('\n' + '─'.repeat(40));
      console.log('  CURRENT GIT STATUS');
      console.log('─'.repeat(40));
      console.log(`  Branch: ${gitStatus.branch}`);
      if (gitStatus.uncommitted.length > 0) {
        console.log(`  Uncommitted: ${gitStatus.uncommitted.length} files`);
        for (const f of gitStatus.uncommitted.slice(0, 3)) {
          console.log(`    ${f.status} ${f.path}`);
        }
        if (gitStatus.uncommitted.length > 3) {
          console.log(`    ... and ${gitStatus.uncommitted.length - 3} more`);
        }
      }
      if (gitStatus.staged.length > 0) {
        console.log(`  Staged: ${gitStatus.staged.length} files`);
      }
      if (gitStatus.untracked.length > 0) {
        console.log(`  Untracked: ${gitStatus.untracked.length} files`);
      }
    }
  }

  // Show changes since last session
  if (session.full_context?.git_commits) {
    const lastCommit = getLastCommitHash(session.full_context.git_commits);
    if (lastCommit) {
      const changes = getChangesSinceCommit(lastCommit);
      if (changes && changes.newCommits.length > 0) {
        console.log('\n' + '─'.repeat(40));
        console.log('  CHANGES SINCE LAST SESSION');
        console.log('─'.repeat(40));
        console.log(`  New commits: ${changes.newCommits.length}`);
        for (const commit of changes.newCommits.slice(0, 3)) {
          console.log(`    ${commit}`);
        }
        if (changes.newCommits.length > 3) {
          console.log(`    ... and ${changes.newCommits.length - 3} more`);
        }
        console.log(`  Files changed: ${changes.filesChanged} (+${changes.insertions}, -${changes.deletions})`);
      }
    }
  }

  console.log('\n' + '─'.repeat(40));
  console.log('  LAST SESSION');
  console.log('─'.repeat(40));
  console.log(`\n${session.id}`);
  console.log(`${session.summary}`);
  if (session.tags?.length) {
    console.log(`Tags: ${session.tags.join(', ')}`);
  }
  console.log(`Created: ${toLocalTime(session.created_at)}`);

  // Show pending/in-progress tasks first (actionable)
  const pendingTasks = tasks.filter((t: SessionTask) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'blocked');
  const doneTasks = tasks.filter((t: SessionTask) => t.status === 'done');

  // Detect likely completed tasks based on git history
  let completionHints: TaskCompletionHint[] = [];
  if (pendingTasks.length > 0 && session.created_at) {
    completionHints = detectTaskCompletion(
      pendingTasks.map(t => ({ description: t.description, status: t.status })),
      session.created_at
    );
  }

  // Show completion hints if found
  const likelyCompleted = completionHints.filter(h => h.likelyCompleted);
  if (likelyCompleted.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log('  ⚡ LIKELY COMPLETED (detected from git)');
    console.log('─'.repeat(40));
    for (const hint of likelyCompleted) {
      const pct = Math.round(hint.confidence * 100);
      console.log(`  ✓? ${truncate(hint.taskDescription, 50)} [${pct}% confidence]`);
      if (hint.evidence.length > 0) {
        console.log(`    └─ ${hint.evidence[0]}`);
      }
    }
    console.log('  \x1b[2mUse: bun memory task done <id> to confirm\x1b[0m');
  }

  // Filter out likely completed from pending display
  const likelyCompletedDescs = new Set(likelyCompleted.map(h => h.taskDescription));
  const stillPending = pendingTasks.filter(t => !likelyCompletedDescs.has(t.description));

  if (stillPending.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log('  PENDING TASKS (continue from here)');
    console.log('─'.repeat(40));
    for (const task of stillPending) {
      console.log(`  ${getStatusIcon(task.status)} ${task.description}`);
      if (task.notes) {
        console.log(`    Notes: ${task.notes}`);
      }
    }
  }

  // Show full context (includes next_steps, challenges, git info, continuation bundle)
  if (session.full_context) {
    const contextLines = formatFullContextEnhanced(session.full_context);
    if (contextLines.length > 0) {
      console.log('\n' + '─'.repeat(40));
      console.log('  SESSION CONTEXT');
      console.log('─'.repeat(40));
      for (const line of contextLines) {
        console.log(`  ${line}`);
      }
    }
  }

  // Show completed tasks summary
  if (doneTasks.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log(`  COMPLETED (${doneTasks.length} tasks)`);
    console.log('─'.repeat(40));
    for (const task of doneTasks.slice(0, 3)) {
      console.log(`  ${getStatusIcon(task.status)} ${truncate(task.description, 60)}`);
    }
    if (doneTasks.length > 3) {
      console.log(`  ... and ${doneTasks.length - 3} more`);
    }
  }

  // Show linked sessions
  if (linkedSessions.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log('  RELATED SESSIONS');
    console.log('─'.repeat(40));
    for (const { session: linked, link_type, similarity } of linkedSessions.slice(0, 3)) {
      const score = similarity ? ` (${(similarity * 100).toFixed(0)}%)` : '';
      console.log(`  ${linked.id}${score}`);
      console.log(`    ${truncate(linked.summary, 50)}`);
    }
  }

  // Show high-confidence learnings with maturity
  if (result.learnings.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log('  KEY LEARNINGS');
    console.log('─'.repeat(40));
    for (const { learning } of result.learnings) {
      const badge = getConfidenceBadge(learning.confidence || 'low', learning.times_validated, learning.maturity_stage);
      console.log(`  ${badge} #${learning.id} ${learning.title}`);
    }
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

/**
 * Display exact match - full details for a specific session or learning
 */
function displayExactMatch(result: RecallResult) {
  console.log('\n' + '═'.repeat(60));
  console.log('  EXACT MATCH');
  console.log('═'.repeat(60));

  if (result.sessions.length > 0) {
    displaySessionDetails(result.sessions[0]!);
  }

  if (result.learnings.length > 0) {
    displayLearningDetails(result.learnings[0]!);
  }

  if (result.sessions.length === 0 && result.learnings.length === 0) {
    console.log(`\nNo match found for: ${result.query}`);
    console.log('Try a semantic search instead.\n');
  }

  console.log('═'.repeat(60) + '\n');
}

/**
 * Display session with full details
 */
function displaySessionDetails(ctx: SessionWithContext) {
  const { session, tasks, linkedSessions } = ctx;

  console.log(`\n${session.id}`);
  console.log(`${session.summary}`);

  if (session.tags?.length) {
    console.log(`Tags: ${session.tags.join(', ')}`);
  }
  if (session.duration_mins) {
    console.log(`Duration: ${session.duration_mins} mins`);
  }
  if (session.commits_count) {
    console.log(`Commits: ${session.commits_count}`);
  }

  // Show agent ownership
  const ownerLabel = session.agent_id === null ? 'orchestrator' : `Agent ${session.agent_id}`;
  console.log(`Owner: ${ownerLabel} | Visibility: ${session.visibility || 'public'}`);
  console.log(`Created: ${toLocalTime(session.created_at)}`);

  // Full context (includes next_steps, challenges, git info, continuation bundle)
  if (session.full_context) {
    const contextLines = formatFullContextEnhanced(session.full_context);
    if (contextLines.length > 0) {
      console.log('\n' + '─'.repeat(40));
      console.log('  CONTEXT');
      console.log('─'.repeat(40));
      for (const line of contextLines) {
        console.log(`  ${line}`);
      }
    }
  }

  // All tasks
  if (tasks.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log(`  TASKS (${tasks.length})`);
    console.log('─'.repeat(40));
    for (const task of tasks) {
      console.log(`  ${getStatusIcon(task.status)} ${task.description} [${task.status}]`);
      if (task.notes) {
        console.log(`    Notes: ${task.notes}`);
      }
    }
  }

  // Linked sessions
  if (linkedSessions.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log('  LINKED SESSIONS');
    console.log('─'.repeat(40));
    for (const { session: linked, link_type, similarity } of linkedSessions) {
      const score = similarity ? ` (${(similarity * 100).toFixed(0)}%)` : '';
      console.log(`  [${link_type}] ${linked.id}${score}`);
      console.log(`    ${truncate(linked.summary, 50)}`);
    }
  }
}

/**
 * Display learning with full details
 */
function displayLearningDetails(ctx: LearningWithContext) {
  const { learning, linkedLearnings } = ctx;

  const badge = getConfidenceBadge(learning.confidence || 'low', learning.times_validated, learning.maturity_stage);
  console.log(`\n${badge} Learning #${learning.id}`);
  console.log(`${learning.title}`);
  const maturityLabel = learning.maturity_stage ? ` | Maturity: ${learning.maturity_stage}` : '';
  console.log(`Category: ${learning.category} | Confidence: ${learning.confidence}${maturityLabel}`);

  if (learning.description) {
    console.log(`\nDescription: ${learning.description}`);
  }
  if (learning.context) {
    console.log(`When to apply: ${learning.context}`);
  }
  if (learning.source_session_id) {
    console.log(`Source session: ${learning.source_session_id}`);
  }

  // Show structured learning fields
  if (learning.what_happened) {
    console.log(`\nWhat happened: ${learning.what_happened}`);
  }
  if (learning.lesson) {
    console.log(`Lesson: ${learning.lesson}`);
  }
  if (learning.prevention) {
    console.log(`How to prevent/apply: ${learning.prevention}`);
  }
  if (learning.source_url) {
    console.log(`Source: ${learning.source_url}`);
  }

  // Show entities from knowledge graph
  if (learning.id) {
    const entities = getLearningEntities(learning.id);
    if (entities.length > 0) {
      console.log(`Entities: ${entities.map(e => e.name).join(', ')}`);
    }
  }

  // Show agent ownership
  const ownerLabel = learning.agent_id === null ? 'orchestrator' : `Agent ${learning.agent_id}`;
  console.log(`Owner: ${ownerLabel} | Visibility: ${learning.visibility || 'public'}`);
  console.log(`Created: ${toLocalTime(learning.created_at)}`);

  if (linkedLearnings.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log('  RELATED LEARNINGS');
    console.log('─'.repeat(40));
    for (const { learning: linked, link_type, similarity } of linkedLearnings) {
      const linkedBadge = getConfidenceBadge(linked.confidence || 'low', linked.times_validated, linked.maturity_stage);
      const score = similarity ? ` (${(similarity * 100).toFixed(0)}%)` : '';
      console.log(`  ${linkedBadge} #${linked.id} ${linked.title}${score}`);
    }
  }
}

/**
 * Display semantic search results with progressive disclosure:
 * --index:   IDs + titles only (~50 tokens/result)
 * --summary: + category + confidence (~100 tokens/result)
 * (default): Full content (~500+ tokens/result)
 */
function displaySearchResults(result: RecallResult) {
  let totalTokens = 0;
  const countTokens = (text: string) => {
    const tokens = estimateTokens(text);
    totalTokens += tokens;
    return text;
  };

  console.log(countTokens(`\n🔍 Searching for: "${result.query}"`));

  if (showIndex) {
    console.log(countTokens(`\x1b[2mMode: --index (compact)\x1b[0m\n`));
  } else if (showSummary) {
    console.log(countTokens(`\x1b[2mMode: --summary\x1b[0m\n`));
  } else {
    console.log('');
  }

  // Sessions (only show in full mode)
  if (showFull) {
    console.log(countTokens('━━━ Sessions ━━━'));
    if (result.sessions.length > 0) {
      for (const { session, tasks, similarity } of result.sessions) {
        const score = similarity ? `[${similarity.toFixed(3)}] ` : '';
        console.log(countTokens(`\n  ${score}${session.id}`));
        console.log(countTokens(`  ${truncate(session.summary, 100)}`));
        console.log(countTokens(`  Tags: ${session.tags?.join(', ') || 'none'}`));

        // Show tasks
        if (tasks.length > 0) {
          console.log(countTokens('  📋 Tasks:'));
          for (const task of tasks.slice(0, 5)) {
            console.log(countTokens(`     ${getStatusIcon(task.status)} ${truncate(task.description, 60)}`));
          }
          if (tasks.length > 5) {
            console.log(countTokens(`     ... and ${tasks.length - 5} more`));
          }
        }
      }
    } else {
      console.log(countTokens('  No matching sessions found'));
    }
  }

  // Learnings - respects progressive disclosure
  console.log(countTokens('\n━━━ Learnings ━━━'));
  if (result.learnings.length > 0) {
    for (const { learning, similarity } of result.learnings) {
      const score = similarity ? `[${similarity.toFixed(3)}] ` : '';
      const badge = getConfidenceBadge(learning.confidence || 'low', learning.times_validated, learning.maturity_stage);

      if (showIndex) {
        // Compact: just ID, title, category
        console.log(countTokens(`  #${learning.id} "${learning.title}" [${learning.category}]`));
      } else if (showSummary) {
        // Summary: + badge + confidence
        console.log(countTokens(`\n  ${score}#${learning.id} · ${learning.title}`));
        console.log(countTokens(`  ${badge} ${learning.category} | ${learning.confidence}`));
      } else {
        // Full: + description
        console.log(countTokens(`\n  ${score}#${learning.id} · ${learning.title}`));
        console.log(countTokens(`  ${badge} Category: ${learning.category} | Confidence: ${learning.confidence}`));
        if (learning.description) {
          console.log(countTokens(`  ${truncate(learning.description, 80)}`));
        }
      }
    }
  } else {
    console.log(countTokens('  No matching learnings found'));
  }

  // Tasks (only show in full mode)
  if (showFull) {
    console.log(countTokens('\n━━━ Tasks ━━━'));
    if (result.tasks.length > 0) {
      for (const task of result.tasks) {
        console.log(countTokens(`\n  [${task.similarity.toFixed(3)}] Task #${task.id} in ${task.session_id}`));
        console.log(countTokens(`  ${getStatusIcon(task.status)} "${task.description}" [${task.status}]`));
        if (task.notes) {
          console.log(countTokens(`  Notes: ${truncate(task.notes, 60)}`));
        }
      }
    } else {
      console.log(countTokens('  No matching tasks found'));
    }
  }

  // Show token estimate
  console.log(`\n\x1b[2m📊 Results: ${result.sessions.length} sessions, ${result.learnings.length} learnings | ~${totalTokens} tokens\x1b[0m\n`);
}

main().catch(console.error);
