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
 */

import { readdirSync, statSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { recall, type RecallResult, type SessionWithContext, type LearningWithContext } from '../../src/services/recall-service';
import { formatFullContext, getStatusIcon, getConfidenceBadge, truncate } from '../../src/utils/formatters';
import { getGitStatus, getChangesSinceCommit, getLastCommitHash } from '../../src/utils/git-context';

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
            title = match ? match[1] : '';
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

const query = process.argv[2];
const agentId = process.env.MEMORY_AGENT_ID ? parseInt(process.env.MEMORY_AGENT_ID) : undefined;

async function main() {
  const result = await recall(query, {
    limit: 5,
    includeLinks: true,
    includeTasks: true,
    agentId,
    includeShared: true,
  });

  // Show agent filter if active
  if (agentId !== undefined) {
    console.log(`\n🔒 Filtering by Agent ID: ${agentId}`);
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

  const { session, tasks, linkedSessions } = result.sessions[0];

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
  const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress' || t.status === 'blocked');
  const doneTasks = tasks.filter(t => t.status === 'done');

  if (pendingTasks.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log('  PENDING TASKS (continue from here)');
    console.log('─'.repeat(40));
    for (const task of pendingTasks) {
      console.log(`  ${getStatusIcon(task.status)} ${task.description}`);
      if (task.notes) {
        console.log(`    Notes: ${task.notes}`);
      }
    }
  }

  // Show full context (includes next_steps, challenges, git info)
  if (session.full_context) {
    const contextLines = formatFullContext(session.full_context);
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

  // Show high-confidence learnings
  if (result.learnings.length > 0) {
    console.log('\n' + '─'.repeat(40));
    console.log('  KEY LEARNINGS');
    console.log('─'.repeat(40));
    for (const { learning } of result.learnings) {
      const badge = getConfidenceBadge(learning.confidence || 'low', learning.times_validated);
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
    displaySessionDetails(result.sessions[0]);
  }

  if (result.learnings.length > 0) {
    displayLearningDetails(result.learnings[0]);
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

  // Full context (includes next_steps, challenges, git info)
  if (session.full_context) {
    const contextLines = formatFullContext(session.full_context);
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

  const badge = getConfidenceBadge(learning.confidence || 'low', learning.times_validated);
  console.log(`\n${badge} Learning #${learning.id}`);
  console.log(`${learning.title}`);
  console.log(`Category: ${learning.category} | Confidence: ${learning.confidence}`);

  if (learning.description) {
    console.log(`\nDescription: ${learning.description}`);
  }
  if (learning.context) {
    console.log(`When to apply: ${learning.context}`);
  }
  if (learning.source_session_id) {
    console.log(`Source session: ${learning.source_session_id}`);
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
      const linkedBadge = getConfidenceBadge(linked.confidence || 'low');
      const score = similarity ? ` (${(similarity * 100).toFixed(0)}%)` : '';
      console.log(`  ${linkedBadge} #${linked.id} ${linked.title}${score}`);
    }
  }
}

/**
 * Display semantic search results
 */
function displaySearchResults(result: RecallResult) {
  console.log(`\n🔍 Searching for: "${result.query}"\n`);

  // Sessions
  console.log('━━━ Sessions ━━━');
  if (result.sessions.length > 0) {
    for (const { session, tasks, similarity } of result.sessions) {
      const score = similarity ? `[${similarity.toFixed(3)}] ` : '';
      console.log(`\n  ${score}${session.id}`);
      console.log(`  ${truncate(session.summary, 100)}`);
      console.log(`  Tags: ${session.tags?.join(', ') || 'none'}`);

      // Show tasks
      if (tasks.length > 0) {
        console.log('  📋 Tasks:');
        for (const task of tasks.slice(0, 5)) {
          console.log(`     ${getStatusIcon(task.status)} ${truncate(task.description, 60)}`);
        }
        if (tasks.length > 5) {
          console.log(`     ... and ${tasks.length - 5} more`);
        }
      }
    }
  } else {
    console.log('  No matching sessions found');
  }

  // Learnings
  console.log('\n━━━ Learnings ━━━');
  if (result.learnings.length > 0) {
    for (const { learning, similarity } of result.learnings) {
      const score = similarity ? `[${similarity.toFixed(3)}] ` : '';
      const badge = getConfidenceBadge(learning.confidence || 'low');
      console.log(`\n  ${score}#${learning.id} ${badge} ${learning.title}`);
      console.log(`  Category: ${learning.category} | Confidence: ${learning.confidence}`);
      if (learning.description) {
        console.log(`  ${truncate(learning.description, 80)}`);
      }
    }
  } else {
    console.log('  No matching learnings found');
  }

  // Tasks
  console.log('\n━━━ Tasks ━━━');
  if (result.tasks.length > 0) {
    for (const task of result.tasks) {
      console.log(`\n  [${task.similarity.toFixed(3)}] Task #${task.id} in ${task.session_id}`);
      console.log(`  ${getStatusIcon(task.status)} "${task.description}" [${task.status}]`);
      if (task.notes) {
        console.log(`  Notes: ${truncate(task.notes, 60)}`);
      }
    }
  } else {
    console.log('  No matching tasks found');
  }

  console.log('\n');
}

main().catch(console.error);
