#!/usr/bin/env bun
/**
 * Unified Task Management - System & Project Tasks with Multi-Repo GitHub Sync
 *
 * Usage:
 *   bun memory utask                           # List pending tasks
 *   bun memory utask list                      # List pending tasks
 *   bun memory utask list --system             # System tasks only
 *   bun memory utask list --project            # Project tasks only
 *   bun memory utask "Title" --system          # Create system task (auto GitHub)
 *   bun memory utask "Title" --project         # Create project task (local)
 *   bun memory utask "Title" --project --github # Create project task (→ project's GitHub)
 *   bun memory utask 5 done                    # Complete task
 *   bun memory utask 5 --promote               # Promote project -> system
 *   bun memory utask sync                      # Sync from GitHub
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

const COMPONENTS = ['chromadb', 'sqlite', 'memory', 'mcp', 'agent', 'cli', 'vector', 'other'] as const;
type Component = typeof COMPONENTS[number];

const STATUS_ICONS: Record<UnifiedTaskStatus, string> = {
  open: '○',
  in_progress: '◐',
  done: '●',
  blocked: '⊘',
  wont_fix: '✗',
};

const PRIORITY_ICONS: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  normal: '🟡',
  low: '🟢',
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

  // Use task.github_repo if set (multi-repo support)
  const repoArg = task.github_repo ? ['-R', task.github_repo] : [];

  try {
    // Try with labels first
    let result: string;
    try {
      const labelArg = labels.join(',');
      result = await $`gh issue create ${repoArg} --title ${task.title} --body ${body} --label ${labelArg} 2>&1`.text();
    } catch {
      // Labels might not exist, try without
      result = await $`gh issue create ${repoArg} --title ${task.title} --body ${body} 2>&1`.text();
    }

    // Extract issue URL and number
    const urlMatch = result.match(/(https:\/\/github\.com\/[^\s]+\/issues\/(\d+))/);
    if (urlMatch) {
      return { url: urlMatch[1], number: parseInt(urlMatch[2]) };
    }

    // Try to get number from output like "Created issue #123"
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

// ============================================================================
// Sync Engine
// ============================================================================

async function syncPendingTasks(): Promise<number> {
  const pending = getTasksPendingSync();
  let synced = 0;

  for (const task of pending) {
    console.log(`  Syncing task #${task.id}: ${task.title}`);
    const result = await createGitHubIssue(task);

    if (result) {
      markTaskSynced(task.id, result.number, result.url);
      console.log(`    ✓ Created GitHub issue #${result.number}`);
      synced++;
    } else {
      markTaskSyncError(task.id, 'Failed to create GitHub issue');
      console.log(`    ✗ Failed to sync`);
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
      // Import new issue
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
      // Update status if changed
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
  console.log('─'.repeat(70));

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
// CLI Commands
// ============================================================================

function printHelp(): void {
  console.log(`
📋 Unified Task Management

Usage:
  bun memory utask                           # List all pending tasks
  bun memory utask list [--system|--project] # List tasks by domain
  bun memory utask "Title" --system          # Create system task (→ GitHub issue)
  bun memory utask "Title" --project         # Create project task (local only)
  bun memory utask "Title" --project --github # Create project task (→ project's GitHub)
  bun memory utask <id> done                 # Complete task (closes GitHub if synced)
  bun memory utask <id> in_progress          # Mark in progress
  bun memory utask <id> blocked              # Mark blocked
  bun memory utask <id> --promote            # Promote project → system (creates GitHub)
  bun memory utask sync                      # Sync with GitHub (import + export)
  bun memory utask stats                     # Show task statistics

Options:
  --system, -s       System domain (auto-syncs to system GitHub repo)
  --project, -p      Project domain (local until --promote or --github)
  --github, -g       Sync project task to current project's GitHub repo
  --component, -c    Component: ${COMPONENTS.join(', ')}
  --priority         Priority: critical, high, normal, low
  --repro            Steps to reproduce
  --fix              Known fix or workaround
  --all              Include completed tasks in list

Domains:
  system   Auto-syncs with system GitHub issues. For bugs, features, test plans.
  project  Local by default. Use --github to sync to current project's repo.

Examples:
  bun memory utask "Fix race condition" --system -c sqlite
  bun memory utask "Study RAG patterns" --project
  bun memory utask "Add feature X" --project --github  # → current project's GitHub
  bun memory utask 5 done
  bun memory utask 5 --promote
  bun memory utask sync
`);
}

async function handleList(args: string[]): Promise<void> {
  const showSystem = args.includes('--system') || args.includes('-s');
  const showProject = args.includes('--project') || args.includes('-p');
  const includeCompleted = args.includes('--all');

  if (showSystem) {
    const tasks = getUnifiedTasks({ domain: 'system', includeCompleted });
    displayTasks(tasks, '🔧 System Tasks (synced to GitHub)');
  } else if (showProject) {
    const tasks = getUnifiedTasks({ domain: 'project', includeCompleted });
    displayTasks(tasks, '📚 Project Tasks (local)');
  } else {
    const systemTasks = getUnifiedTasks({ domain: 'system', includeCompleted });
    const projectTasks = getUnifiedTasks({ domain: 'project', includeCompleted });

    displayTasks(systemTasks, '🔧 System Tasks (synced to GitHub)');
    displayTasks(projectTasks, '📚 Project Tasks (local)');

    console.log('Commands: utask <id> done | utask <id> --promote | utask sync\n');
  }
}

async function handleCreate(title: string, args: string[]): Promise<void> {
  const isSystem = args.includes('--system') || args.includes('-s');
  const isProject = args.includes('--project') || args.includes('-p');
  const syncToGitHub = args.includes('--github') || args.includes('-g');

  if (!isSystem && !isProject) {
    console.error('❌ Must specify domain: --system or --project\n');
    printHelp();
    process.exit(1);
  }

  const domain: UnifiedTaskDomain = isSystem ? 'system' : 'project';

  // Parse options
  let component: string | undefined;
  let priority: 'critical' | 'high' | 'normal' | 'low' = 'normal';
  let repro: string | undefined;
  let fix: string | undefined;

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
    }
  }

  // Format title with component if provided
  const formattedTitle = component ? `[${component}] ${title}` : title;

  // Determine GitHub repo for project tasks with --github flag
  let githubRepo: string | undefined;
  let syncToProjectGitHub = false;
  if (isProject && syncToGitHub) {
    githubRepo = getProjectGitHubRepo() || undefined;
    if (!githubRepo) {
      console.error('❌ Current directory is not a GitHub repo (no remote origin)\n');
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
    syncToProjectGitHub,
  });

  console.log(`\n✓ Created ${domain} task #${task.id}`);
  console.log(`  ${formatTask(task)}\n`);

  // Auto-sync for system tasks OR project tasks with --github
  if (domain === 'system' || syncToProjectGitHub) {
    const targetRepo = task.github_repo || 'current repo';
    console.log(`  Creating GitHub issue in ${targetRepo}...`);
    const result = await createGitHubIssue(task);

    if (result) {
      markTaskSynced(task.id, result.number, result.url);
      console.log(`  ✓ GitHub issue #${result.number}: ${result.url}\n`);
    } else {
      markTaskSyncError(task.id, 'Failed to create GitHub issue');
      console.log('  ✗ Failed to create GitHub issue (will retry on sync)\n');
    }
  } else {
    console.log('  (Local only - use --github or --promote to create GitHub issue)\n');
  }
}

async function handleStatusUpdate(id: number, status: UnifiedTaskStatus): Promise<void> {
  const task = getUnifiedTaskById(id);

  if (!task) {
    console.error(`❌ Task #${id} not found\n`);
    process.exit(1);
  }

  updateUnifiedTask(id, { status });
  console.log(`\n✓ Task #${id} marked as ${status}`);

  // Close GitHub issue if marking synced task as done
  if (status === 'done' && task.github_issue_number) {
    const repoInfo = task.github_repo ? ` in ${task.github_repo}` : '';
    console.log(`  Closing GitHub issue #${task.github_issue_number}${repoInfo}...`);
    const closed = await closeGitHubIssue(task.github_issue_number, task.github_repo);
    if (closed) {
      console.log('  ✓ GitHub issue closed\n');
    } else {
      console.log('  ✗ Failed to close GitHub issue\n');
    }
  } else {
    console.log('');
  }
}

async function handlePromote(id: number): Promise<void> {
  const task = getUnifiedTaskById(id);

  if (!task) {
    console.error(`❌ Task #${id} not found\n`);
    process.exit(1);
  }

  if (task.domain === 'system') {
    console.log(`\n⚠️  Task #${id} is already a system task`);
    if (task.github_issue_url) {
      console.log(`   GitHub: ${task.github_issue_url}\n`);
    }
    return;
  }

  const promoted = promoteTaskToSystem(id);
  if (!promoted) {
    console.error(`❌ Failed to promote task #${id}\n`);
    process.exit(1);
  }

  console.log(`\n✓ Task #${id} promoted to system domain`);
  console.log('  Creating GitHub issue...');

  const result = await createGitHubIssue(promoted);
  if (result) {
    markTaskSynced(id, result.number, result.url);
    console.log(`  ✓ GitHub issue #${result.number}: ${result.url}\n`);
  } else {
    markTaskSyncError(id, 'Failed to create GitHub issue');
    console.log('  ✗ Failed to create GitHub issue (will retry on sync)\n');
  }
}

async function handleSync(): Promise<void> {
  console.log('\n🔄 Syncing with GitHub...\n');

  // First, sync pending local tasks to GitHub
  const pending = getTasksPendingSync();
  if (pending.length > 0) {
    console.log(`Syncing ${pending.length} pending task(s) to GitHub:`);
    await syncPendingTasks();
    console.log('');
  }

  // Then, import from GitHub
  console.log('Importing from GitHub:');
  const { imported, updated } = await syncFromGitHub();

  console.log(`\n✓ Sync complete: ${imported} imported, ${updated} updated\n`);
}

function handleStats(): void {
  const stats = getUnifiedTaskStats();

  console.log('\n📊 Task Statistics\n');
  console.log('─'.repeat(40));

  console.log('\n🔧 System Tasks:');
  console.log(`   Open:        ${stats.system.open}`);
  console.log(`   In Progress: ${stats.system.in_progress}`);
  console.log(`   Blocked:     ${stats.system.blocked}`);
  console.log(`   Done:        ${stats.system.done}`);

  console.log('\n📚 Project Tasks:');
  console.log(`   Open:        ${stats.project.open}`);
  console.log(`   In Progress: ${stats.project.in_progress}`);
  console.log(`   Blocked:     ${stats.project.blocked}`);
  console.log(`   Done:        ${stats.project.done}`);

  console.log(`\n🔄 Pending GitHub sync: ${stats.pending_sync}\n`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    handleList([]);
    return;
  }

  const command = args[0];

  // Handle commands
  if (command === 'list') {
    await handleList(args.slice(1));
    return;
  }

  if (command === 'sync') {
    await handleSync();
    return;
  }

  if (command === 'stats') {
    handleStats();
    return;
  }

  if (command === 'help') {
    printHelp();
    return;
  }

  // Check if first arg is a task ID
  const taskId = parseInt(command);
  if (!isNaN(taskId)) {
    const action = args[1];

    if (action === '--promote' || action === '-p') {
      await handlePromote(taskId);
      return;
    }

    if (['done', 'open', 'in_progress', 'blocked', 'wont_fix'].includes(action)) {
      await handleStatusUpdate(taskId, action as UnifiedTaskStatus);
      return;
    }

    // Show task details
    const task = getUnifiedTaskById(taskId);
    if (task) {
      console.log(`\n${formatTask(task)}`);
      if (task.description) console.log(`  ${task.description}`);
      if (task.github_issue_url) console.log(`  GitHub: ${task.github_issue_url}`);
      console.log('');
    } else {
      console.error(`❌ Task #${taskId} not found\n`);
    }
    return;
  }

  // Otherwise, treat first arg as title for new task
  if (!command.startsWith('-')) {
    await handleCreate(command, args.slice(1));
    return;
  }

  // Unknown command
  printHelp();
}

main().catch(console.error);
