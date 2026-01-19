#!/usr/bin/env bun
/**
 * /task - Manage session tasks
 * Usage:
 *   bun scripts/memory/task-update.ts list          # List pending tasks
 *   bun scripts/memory/task-update.ts list --all    # List all tasks
 *   bun scripts/memory/task-update.ts <id> <status> # Update task status
 *   bun scripts/memory/task-update.ts <id> --notes "note"  # Add notes
 */

import {
  getAllPendingTasks,
  getAllSessionTasks,
  getSessionTaskById,
  updateSessionTask,
  getSessionById,
} from '../../src/db';

// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

const STATUS_ICONS: Record<string, string> = {
  done: `${GREEN}✓${RESET}`,
  pending: `${YELLOW}○${RESET}`,
  blocked: `${RED}✗${RESET}`,
  in_progress: `${CYAN}▶${RESET}`,
};

const VALID_STATUSES = ['done', 'pending', 'blocked', 'in_progress'];

function formatDate(dateStr?: string): string {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function listTasks(showAll: boolean) {
  const tasks = showAll ? getAllSessionTasks(50) : getAllPendingTasks(50);

  if (tasks.length === 0) {
    console.log(showAll ? 'No tasks found.' : 'No pending tasks found.');
    return;
  }

  const header = showAll ? '📋 All Tasks' : '📋 Pending Tasks';
  console.log(`\n${BOLD}${header}${RESET}\n`);

  // Group by session
  const bySession: Record<string, typeof tasks> = {};
  for (const task of tasks) {
    const sid = task.session_id || 'unknown';
    if (!bySession[sid]) bySession[sid] = [];
    bySession[sid].push(task);
  }

  for (const [sessionId, sessionTasks] of Object.entries(bySession)) {
    // Get session summary
    const session = getSessionById(sessionId);
    const summary = session?.summary
      ? truncate(session.summary, 60)
      : 'No summary';

    console.log(`${DIM}Session: ${CYAN}${sessionId.replace('session_', '')}${RESET}`);
    console.log(`${DIM}${summary}${RESET}\n`);

    for (const task of sessionTasks) {
      const icon = STATUS_ICONS[task.status || 'pending'];
      const desc = truncate(task.description, 70);
      console.log(`  ${icon} [${task.id}] ${desc}`);
      if (task.notes) {
        console.log(`       ${DIM}Note: ${task.notes}${RESET}`);
      }
      if (task.started_at) {
        console.log(`       ${DIM}Started: ${formatDate(task.started_at)}${RESET}`);
      }
      if (task.completed_at) {
        console.log(`       ${DIM}Completed: ${formatDate(task.completed_at)}${RESET}`);
      }
    }
    console.log('');
  }

  console.log(`${DIM}Total: ${tasks.length} task(s)${RESET}\n`);
}

function updateTask(taskId: number, status?: string, notes?: string) {
  const task = getSessionTaskById(taskId);
  if (!task) {
    console.log(`${RED}Task #${taskId} not found.${RESET}`);
    process.exit(1);
  }

  if (status && !VALID_STATUSES.includes(status)) {
    console.log(`${RED}Invalid status: ${status}${RESET}`);
    console.log(`Valid statuses: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const success = updateSessionTask(taskId, { status, notes });
  if (success) {
    const icon = status ? STATUS_ICONS[status] : STATUS_ICONS[task.status || 'pending'];
    console.log(`\n${GREEN}✓ Updated task #${taskId}${RESET}`);
    console.log(`  ${icon} ${truncate(task.description, 60)}`);
    if (status) console.log(`  Status: ${task.status} → ${status}`);
    if (notes) console.log(`  Notes: ${notes}`);
    console.log('');
  } else {
    console.log(`${RED}Failed to update task.${RESET}`);
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
${BOLD}Usage:${RESET}
  bun memory task list              List pending tasks
  bun memory task list --all        List all tasks
  bun memory task <id> <status>     Update task status
  bun memory task <id> --notes "x"  Add notes to task

${BOLD}Valid statuses:${RESET}
  done, pending, blocked, in_progress

${BOLD}Examples:${RESET}
  bun memory task list
  bun memory task 5 done
  bun memory task 5 in_progress
  bun memory task 5 --notes "Blocked on API review"
`);
}

// Parse arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  printUsage();
  process.exit(0);
}

if (args[0] === 'list') {
  const showAll = args.includes('--all') || args.includes('-a');
  listTasks(showAll);
} else {
  // Update task: <id> <status> or <id> --notes "..."
  const taskId = parseInt(args[0]!, 10);
  if (isNaN(taskId)) {
    console.log(`${RED}Invalid task ID: ${args[0]}${RESET}`);
    printUsage();
    process.exit(1);
  }

  let status: string | undefined;
  let notes: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--notes' && args[i + 1]) {
      notes = args[i + 1];
      i++;
    } else if (VALID_STATUSES.includes(args[i]!)) {
      status = args[i];
    }
  }

  if (!status && !notes) {
    // Just show task details
    const task = getSessionTaskById(taskId);
    if (!task) {
      console.log(`${RED}Task #${taskId} not found.${RESET}`);
      process.exit(1);
    }
    const icon = STATUS_ICONS[task.status || 'pending'];
    console.log(`\n${BOLD}Task #${taskId}${RESET}`);
    console.log(`  ${icon} ${task.description}`);
    console.log(`  Session: ${CYAN}${task.session_id?.replace('session_', '')}${RESET}`);
    console.log(`  Status: ${task.status}`);
    if (task.notes) console.log(`  Notes: ${task.notes}`);
    if (task.started_at) console.log(`  Started: ${formatDate(task.started_at)}`);
    if (task.completed_at) console.log(`  Completed: ${formatDate(task.completed_at)}`);
    console.log('');
  } else {
    updateTask(taskId, status, notes);
  }
}
