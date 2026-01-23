#!/usr/bin/env bun
/**
 * Unified Task Management - System, Project & Session Tasks
 *
 * Usage:
 *   bun memory task                               # List all pending tasks
 *   bun memory task:list                          # List all pending tasks
 *   bun memory task:list --session                # Session-scoped tasks only
 *   bun memory task:list --project                # Project tasks only
 *   bun memory task:list --system                 # System tasks only
 *   bun memory task:create "Title" --system       # Create system task (-> GitHub)
 *   bun memory task:create "Title" --project      # Create project task
 *   bun memory task:create "Title" --session      # Create session task
 *   bun memory task:update <id> done              # Mark task complete
 *   bun memory task:update <id> --priority high   # Change priority
 *   bun memory task:sync                          # Sync with GitHub
 *   bun memory task:stats                         # Show statistics
 */

import {
  createUnifiedTask,
  updateUnifiedTask,
  getUnifiedTasks,
  getUnifiedTaskById,
  getTaskByGitHubIssue,
  markTaskSynced,
  markTaskSyncError,
  promoteTaskToSystem,
  getTasksPendingSync,
  getUnifiedTaskStats,
  type UnifiedTask,
  type UnifiedTaskStatus,
  type UnifiedTaskDomain,
} from '../../src/db';
import { getProjectGitHubRepo } from '../../src/utils/git-context';
import { $ } from 'bun';

// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';

const COMPONENTS = ['chromadb', 'sqlite', 'memory', 'mcp', 'agent', 'cli', 'vector', 'other'] as const;
type Component = typeof COMPONENTS[number];

const STATUS_ICONS: Record<UnifiedTaskStatus, string> = {
  open: '\u25cb',
  in_progress: '\u25d0',
  done: '\u25cf',
  blocked: '\u2298',
  wont_fix: '\u2717',
};

const PRIORITY_ICONS: Record<string, string> = {
  critical: '\ud83d\udd34',
  high: '\ud83d\udfe0',
  normal: '\ud83d\udfe1',
  low: '\ud83d\udfe2',
};

const DOMAIN_ICONS: Record<string, string> = {
  system: '\ud83d\udd27',
  project: '\ud83d\udcda',
  session: '\ud83d\udcdd',
};

// ============================================================================
// GitHub Sync Functions
// ============================================================================

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  labels: { name: string }[];
  body?: string;
}

async function createGitHubIssue(task: UnifiedTask): Promise<{ number: number; url: string } | null> {
  const labels: string[] = ['bug'];

  if (task.priority === 'critical') labels.push('priority:critical');
  else if (task.priority === 'high') labels.push('priority:high');
  else if (task.priority === 'low') labels.push('priority:low');

  if (task.component) labels.push(`component:${task.component}`);

  const body = `## Task Details

**Priority:** ${task.priority}
**Component:** ${task.component || 'unspecified'}
**Task ID:** #${task.id}
**Created:** ${task.created_at}

${task.description ? `## Description\n${task.description}\n` : ''}
${task.repro_steps ? `## Steps to Reproduce\n${task.repro_steps}\n` : ''}
${task.known_fix ? `## Known Fix/Workaround\n${task.known_fix}\n` : ''}

---
*Auto-created from unified task system*
`;

  const repoArg = task.github_repo ? ['-R', task.github_repo] : [];

  try {
    let result: string;
    try {
      const labelArg = labels.join(',');
      result = await $`gh issue create ${repoArg} --title ${task.title} --body ${body} --label ${labelArg} 2>&1`.text();
    } catch {
      result = await $`gh issue create ${repoArg} --title ${task.title} --body ${body} 2>&1`.text();
    }

    const urlMatch = result.match(/(https:\/\/github\.com\/[^\s]+\/issues\/(\d+))/);
    if (urlMatch) {
      return { url: urlMatch[1], number: parseInt(urlMatch[2]) };
    }

    const numberMatch = result.match(/#(\d+)/);
    if (numberMatch) {
      return { number: parseInt(numberMatch[1]), url: result.trim() };
    }

    return null;
  } catch (error: any) {
    console.error(`  Failed to create GitHub issue: ${error.message}`);
    return null;
  }
}

async function closeGitHubIssue(issueNumber: number, repo?: string | null): Promise<boolean> {
  const repoArg = repo ? ['-R', repo] : [];
  try {
    await $`gh issue close ${repoArg} ${issueNumber}`.quiet();
    return true;
  } catch {
    return false;
  }
}

async function fetchGitHubIssues(): Promise<GitHubIssue[]> {
  try {
    const result = await $`gh issue list --state all --json number,title,state,url,labels,body --limit 100`.json();
    return result as GitHubIssue[];
  } catch (error: any) {
    console.error(`Failed to fetch GitHub issues: ${error.message}`);
    return [];
  }
}

async function syncPendingTasks(): Promise<number> {
  const pending = getTasksPendingSync();
  let synced = 0;

  for (const task of pending) {
    console.log(`  Syncing task #${task.id}: ${task.title}`);
    const result = await createGitHubIssue(task);

    if (result) {
      markTaskSynced(task.id, result.number, result.url);
      console.log(`    \u2713 Created GitHub issue #${result.number}`);
      synced++;
    } else {
      markTaskSyncError(task.id, 'Failed to create GitHub issue');
      console.log(`    \u2717 Failed to sync`);
    }
  }

  return synced;
}

async function syncFromGitHub(): Promise<{ imported: number; updated: number }> {
  const issues = await fetchGitHubIssues();
  let imported = 0;
  let updated = 0;

  for (const issue of issues) {
    const existing = getTaskByGitHubIssue(issue.number);

    if (!existing) {
      const componentLabel = issue.labels.find(l => l.name.startsWith('component:'));
      const component = componentLabel?.name.replace('component:', '') || null;

      const priorityLabel = issue.labels.find(l => l.name.startsWith('priority:'));
      let priority: 'critical' | 'high' | 'normal' | 'low' = 'normal';
      if (priorityLabel?.name === 'priority:critical') priority = 'critical';
      else if (priorityLabel?.name === 'priority:high') priority = 'high';
      else if (priorityLabel?.name === 'priority:low') priority = 'low';

      createUnifiedTask({
        title: issue.title,
        description: issue.body || undefined,
        domain: 'system',
        status: issue.state === 'closed' ? 'done' : 'open',
        priority,
        component: component || undefined,
        github_issue_number: issue.number,
        github_issue_url: issue.url,
      });

      console.log(`  + Imported #${issue.number}: ${issue.title.slice(0, 50)}`);
      imported++;
    } else {
      const ghState = issue.state === 'closed' ? 'done' : 'open';
      if (existing.status === 'open' && ghState === 'done') {
        updateUnifiedTask(existing.id, { status: 'done' });
        console.log(`  ~ Updated #${issue.number}: marked done`);
        updated++;
      } else if (existing.status === 'done' && ghState === 'open') {
        updateUnifiedTask(existing.id, { status: 'open' });
        console.log(`  ~ Updated #${issue.number}: reopened`);
        updated++;
      }
    }
  }

  return { imported, updated };
}

// ============================================================================
// Display Functions
// ============================================================================

function formatTask(task: UnifiedTask, showGitHub = true): string {
  const statusIcon = STATUS_ICONS[task.status];
  const priorityIcon = PRIORITY_ICONS[task.priority] || '';
  const component = task.component ? `[${task.component}]` : '';
  let ghRef = '';
  if (showGitHub && task.github_issue_number) {
    const repoPrefix = task.github_repo ? `${task.github_repo}` : '';
    ghRef = repoPrefix ? ` (${repoPrefix}#${task.github_issue_number})` : ` (#${task.github_issue_number})`;
  }
  const title = task.title.length > 60 ? task.title.slice(0, 57) + '...' : task.title;

  return `${statusIcon} ${priorityIcon} #${task.id} ${component} ${title}${ghRef}`;
}

function displayTasks(tasks: UnifiedTask[], title: string): void {
  if (tasks.length === 0) {
    console.log(`\n${title}\n  (none)\n`);
    return;
  }

  console.log(`\n${title}`);
  console.log('\u2500'.repeat(70));

  for (const task of tasks) {
    console.log(`  ${formatTask(task)}`);
    if (task.description) {
      const desc = task.description.length > 60 ? task.description.slice(0, 57) + '...' : task.description;
      console.log(`      ${desc}`);
    }
  }
  console.log('');
}

// ============================================================================
// Action Handlers
// ============================================================================

function printHelp(): void {
  console.log(`
${BOLD}Unified Task Management${RESET}

${BOLD}Usage:${RESET}
  bun memory task                               List all pending tasks
  bun memory task:list [--domain] [--all]       List tasks by domain
  bun memory task:create "Title" --domain       Create a new task
  bun memory task:update <id> <status>          Update task status
  bun memory task:sync                          Sync with GitHub
  bun memory task:stats                         Show statistics

${BOLD}Domains:${RESET}
  --system, -s     System tasks (auto-sync to GitHub)
  --project, -p    Project tasks (local, can sync with --github)
  --session        Session-scoped tasks (local only)

${BOLD}Actions:${RESET}
  task:list        List tasks (default if no action specified)
  task:create      Create a new task
  task:update      Update task status/priority/notes
  task:sync        Sync system tasks with GitHub
  task:stats       Show task statistics
  task:promote     Promote project task to system

${BOLD}Examples:${RESET}
  bun memory task:create "Fix race condition" --system -c sqlite
  bun memory task:create "Study RAG patterns" --project
  bun memory task:create "Implement step 1" --session
  bun memory task:update 5 done
  bun memory task:update 5 --priority high
  bun memory task:list --system --all
  bun memory task:sync
`);
}

export async function handleList(args: string[]): Promise<void> {
  const showSystem = args.includes('--system') || args.includes('-s');
  const showProject = args.includes('--project') || args.includes('-p');
  const showSession = args.includes('--session');
  const includeCompleted = args.includes('--all');

  if (showSystem) {
    const tasks = getUnifiedTasks({ domain: 'system', includeCompleted });
    displayTasks(tasks, `${DOMAIN_ICONS.system} System Tasks (synced to GitHub)`);
  } else if (showProject) {
    const tasks = getUnifiedTasks({ domain: 'project', includeCompleted });
    displayTasks(tasks, `${DOMAIN_ICONS.project} Project Tasks (local)`);
  } else if (showSession) {
    const tasks = getUnifiedTasks({ domain: 'session', includeCompleted });
    displayTasks(tasks, `${DOMAIN_ICONS.session} Session Tasks (session-scoped)`);
  } else {
    // Show all domains
    const systemTasks = getUnifiedTasks({ domain: 'system', includeCompleted });
    const projectTasks = getUnifiedTasks({ domain: 'project', includeCompleted });
    const sessionTasks = getUnifiedTasks({ domain: 'session', includeCompleted });

    displayTasks(systemTasks, `${DOMAIN_ICONS.system} System Tasks (synced to GitHub)`);
    displayTasks(projectTasks, `${DOMAIN_ICONS.project} Project Tasks (local)`);
    displayTasks(sessionTasks, `${DOMAIN_ICONS.session} Session Tasks (session-scoped)`);

    console.log(`${DIM}Commands: task:update <id> done | task:sync | task:stats${RESET}\n`);
  }
}

export async function handleCreate(args: string[]): Promise<void> {
  // Find title (first non-flag argument)
  const title = args.find(a => !a.startsWith('-'));
  if (!title) {
    console.error('\u274c Title is required\n');
    console.error('Usage: bun memory task:create "Title" --domain\n');
    process.exit(1);
  }

  const isSystem = args.includes('--system') || args.includes('-s');
  const isProject = args.includes('--project') || args.includes('-p');
  const isSession = args.includes('--session');
  const syncToGitHub = args.includes('--github') || args.includes('-g');

  // Validate exactly one domain
  const domainCount = [isSystem, isProject, isSession].filter(Boolean).length;
  if (domainCount === 0) {
    console.error('\u274c Must specify domain: --system, --project, or --session\n');
    printHelp();
    process.exit(1);
  }
  if (domainCount > 1) {
    console.error('\u274c Cannot specify multiple domains. Choose one: --system, --project, or --session\n');
    printHelp();
    process.exit(1);
  }

  const domain: UnifiedTaskDomain = isSystem ? 'system' : isProject ? 'project' : 'session';

  // Parse options
  let component: string | undefined;
  let priority: 'critical' | 'high' | 'normal' | 'low' = 'normal';
  let repro: string | undefined;
  let fix: string | undefined;
  let sessionId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if ((arg === '--component' || arg === '-c') && next) {
      if (COMPONENTS.includes(next as Component)) {
        component = next;
      }
      i++;
    } else if (arg === '--priority' && next) {
      if (['critical', 'high', 'normal', 'low'].includes(next)) {
        priority = next as typeof priority;
      }
      i++;
    } else if (arg === '--repro' && next) {
      repro = next;
      i++;
    } else if (arg === '--fix' && next) {
      fix = next;
      i++;
    } else if (arg === '--session-id' && next) {
      sessionId = next;
      i++;
    }
  }

  // Don't add component to title - it's shown separately in display
  const formattedTitle = title;

  // GitHub repo for project tasks with --github flag
  let githubRepo: string | undefined;
  let syncToProjectGitHub = false;
  if (isProject && syncToGitHub) {
    githubRepo = getProjectGitHubRepo() || undefined;
    if (!githubRepo) {
      console.error('\u274c Current directory is not a GitHub repo (no remote origin)\n');
      console.error('   Use --project without --github for local-only task\n');
      process.exit(1);
    }
    syncToProjectGitHub = true;
  }

  const task = createUnifiedTask({
    title: formattedTitle,
    domain,
    priority,
    component,
    repro_steps: repro,
    known_fix: fix,
    github_repo: githubRepo,
    session_id: sessionId,
    syncToProjectGitHub,
  });

  console.log(`\n\u2713 Created ${domain} task #${task.id}`);
  console.log(`  ${formatTask(task)}\n`);

  // Auto-sync for system tasks OR project tasks with --github
  if (domain === 'system' || syncToProjectGitHub) {
    const targetRepo = task.github_repo || 'current repo';
    console.log(`  Creating GitHub issue in ${targetRepo}...`);
    const result = await createGitHubIssue(task);

    if (result) {
      markTaskSynced(task.id, result.number, result.url);
      console.log(`  \u2713 GitHub issue #${result.number}: ${result.url}\n`);
    } else {
      markTaskSyncError(task.id, 'Failed to create GitHub issue');
      console.log('  \u2717 Failed to create GitHub issue (will retry on sync)\n');
    }
  } else if (domain === 'session') {
    console.log('  (Session-scoped - will not sync to GitHub)\n');
  } else {
    console.log('  (Local only - use --github or task:promote to create GitHub issue)\n');
  }
}

export async function handleUpdate(args: string[]): Promise<void> {
  // First arg should be task ID
  const idArg = args[0];
  const taskId = parseInt(idArg || '');

  if (isNaN(taskId)) {
    console.error(`\u274c Invalid task ID: ${idArg}\n`);
    console.error('Usage: bun memory task:update <id> <status|--option>\n');
    process.exit(1);
  }

  const task = getUnifiedTaskById(taskId);
  if (!task) {
    console.error(`\u274c Task #${taskId} not found\n`);
    process.exit(1);
  }

  // Parse update options
  let status: UnifiedTaskStatus | undefined;
  let priority: string | undefined;
  let notes: string | undefined;

  const validStatuses = ['done', 'open', 'in_progress', 'blocked', 'wont_fix'];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (validStatuses.includes(arg)) {
      status = arg as UnifiedTaskStatus;
    } else if (arg === '--priority' && next) {
      priority = next;
      i++;
    } else if (arg === '--notes' && next) {
      notes = next;
      i++;
    }
  }

  if (!status && !priority && !notes) {
    // Just show task details
    console.log(`\n${BOLD}Task #${taskId}${RESET}`);
    console.log(`  ${formatTask(task)}`);
    console.log(`  Domain: ${task.domain}`);
    if (task.description) console.log(`  Description: ${task.description}`);
    if (task.github_issue_url) console.log(`  GitHub: ${task.github_issue_url}`);
    if (task.session_id) console.log(`  Session: ${CYAN}${task.session_id.replace('session_', '')}${RESET}`);
    console.log('');
    return;
  }

  const updates: Record<string, any> = {};
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  if (notes) updates.context = notes; // Store notes in context field

  updateUnifiedTask(taskId, updates);
  console.log(`\n\u2713 Task #${taskId} updated`);
  if (status) console.log(`  Status: ${task.status} \u2192 ${status}`);
  if (priority) console.log(`  Priority: ${task.priority} \u2192 ${priority}`);
  if (notes) console.log(`  Notes: ${notes}`);

  // Close GitHub issue if marking synced task as done
  if (status === 'done' && task.github_issue_number) {
    const repoInfo = task.github_repo ? ` in ${task.github_repo}` : '';
    console.log(`  Closing GitHub issue #${task.github_issue_number}${repoInfo}...`);
    const closed = await closeGitHubIssue(task.github_issue_number, task.github_repo);
    if (closed) {
      console.log('  \u2713 GitHub issue closed\n');
    } else {
      console.log('  \u2717 Failed to close GitHub issue\n');
    }
  } else {
    console.log('');
  }
}

export async function handleSync(): Promise<void> {
  console.log('\n\ud83d\udd04 Syncing with GitHub...\n');

  const pending = getTasksPendingSync();
  if (pending.length > 0) {
    console.log(`Syncing ${pending.length} pending task(s) to GitHub:`);
    await syncPendingTasks();
    console.log('');
  }

  console.log('Importing from GitHub:');
  const { imported, updated } = await syncFromGitHub();

  console.log(`\n\u2713 Sync complete: ${imported} imported, ${updated} updated\n`);
}

export async function handlePromote(args: string[]): Promise<void> {
  const idArg = args[0];
  const taskId = parseInt(idArg || '');

  if (isNaN(taskId)) {
    console.error(`\u274c Invalid task ID: ${idArg}\n`);
    process.exit(1);
  }

  const task = getUnifiedTaskById(taskId);
  if (!task) {
    console.error(`\u274c Task #${taskId} not found\n`);
    process.exit(1);
  }

  if (task.domain === 'system') {
    console.log(`\n\u26a0\ufe0f  Task #${taskId} is already a system task`);
    if (task.github_issue_url) {
      console.log(`   GitHub: ${task.github_issue_url}\n`);
    }
    return;
  }

  const promoted = promoteTaskToSystem(taskId);
  if (!promoted) {
    console.error(`\u274c Failed to promote task #${taskId}\n`);
    process.exit(1);
  }

  console.log(`\n\u2713 Task #${taskId} promoted to system domain`);
  console.log('  Creating GitHub issue...');

  const result = await createGitHubIssue(promoted);
  if (result) {
    markTaskSynced(taskId, result.number, result.url);
    console.log(`  \u2713 GitHub issue #${result.number}: ${result.url}\n`);
  } else {
    markTaskSyncError(taskId, 'Failed to create GitHub issue');
    console.log('  \u2717 Failed to create GitHub issue (will retry on sync)\n');
  }
}

export function handleStats(): void {
  const stats = getUnifiedTaskStats();

  console.log(`\n${BOLD}\ud83d\udcca Task Statistics${RESET}\n`);
  console.log('\u2500'.repeat(40));

  console.log(`\n${DOMAIN_ICONS.system} System Tasks:`);
  console.log(`   Open:        ${stats.system.open}`);
  console.log(`   In Progress: ${stats.system.in_progress}`);
  console.log(`   Blocked:     ${stats.system.blocked}`);
  console.log(`   Done:        ${stats.system.done}`);

  console.log(`\n${DOMAIN_ICONS.project} Project Tasks:`);
  console.log(`   Open:        ${stats.project.open}`);
  console.log(`   In Progress: ${stats.project.in_progress}`);
  console.log(`   Blocked:     ${stats.project.blocked}`);
  console.log(`   Done:        ${stats.project.done}`);

  // Session tasks stats (if we have them)
  const sessionTasks = getUnifiedTasks({ domain: 'session', includeCompleted: true });
  const sessionOpen = sessionTasks.filter(t => t.status === 'open').length;
  const sessionInProgress = sessionTasks.filter(t => t.status === 'in_progress').length;
  const sessionBlocked = sessionTasks.filter(t => t.status === 'blocked').length;
  const sessionDone = sessionTasks.filter(t => t.status === 'done').length;

  console.log(`\n${DOMAIN_ICONS.session} Session Tasks:`);
  console.log(`   Open:        ${sessionOpen}`);
  console.log(`   In Progress: ${sessionInProgress}`);
  console.log(`   Blocked:     ${sessionBlocked}`);
  console.log(`   Done:        ${sessionDone}`);

  console.log(`\n\ud83d\udd04 Pending GitHub sync: ${stats.pending_sync}\n`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runTask(action: string | undefined, args: string[]): Promise<void> {
  // Handle no action - check if first arg is a task ID (backwards compat: task 5 done)
  if (!action) {
    const firstArg = args[0];
    if (firstArg && !isNaN(parseInt(firstArg))) {
      // First arg is a number, treat as task ID for update/view
      await handleUpdate(args);
      return;
    }
    await handleList(args);
    return;
  }

  switch (action) {
    case 'list':
      await handleList(args);
      break;
    case 'create':
      await handleCreate(args);
      break;
    case 'update':
      await handleUpdate(args);
      break;
    case 'sync':
      await handleSync();
      break;
    case 'promote':
      await handlePromote(args);
      break;
    case 'stats':
      handleStats();
      break;
    case 'help':
      printHelp();
      break;
    default:
      // Check if action is a task ID (backwards compat: task 5 done)
      const taskId = parseInt(action);
      if (!isNaN(taskId)) {
        await handleUpdate([action, ...args]);
      } else if (!action.startsWith('-')) {
        // Treat as title for create (backwards compat: task "Title" --system)
        await handleCreate([action, ...args]);
      } else {
        printHelp();
      }
  }
}

// Direct execution
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    await handleList([]);
  } else {
    // Check if first arg looks like an action or task ID
    const firstArg = args[0];

    if (['list', 'create', 'update', 'sync', 'promote', 'stats', 'help'].includes(firstArg)) {
      await runTask(firstArg, args.slice(1));
    } else {
      // Backwards compat: treat as legacy command
      await runTask(undefined, args);
    }
  }
}
