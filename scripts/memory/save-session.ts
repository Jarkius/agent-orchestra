#!/usr/bin/env bun
/**
 * Interactive Session Save
 * Save current session with full context to SQLite + ChromaDB
 *
 * Usage:
 *   bun memory save                    # Interactive mode
 *   bun memory save "summary"          # Quick mode
 *   bun memory save --auto "summary"   # Auto-capture from Claude Code files
 *
 * Auto-capture reads from ~/.claude/:
 *   - history.jsonl - User messages from current session
 *   - todos/{sessionId}-*.json - Task lists
 *   - plans/*.md - Recent plan files
 *   - Git context (branch, commits, files)
 */

import { execSync } from 'child_process';
import {
  createSession,
  createSessionLink,
  createLearning,
  createSessionTask,
  getSessionStats,
  listSessionsFromDb,
  type SessionRecord,
  type FullContext,
  type SessionTask,
} from '../../src/db';
import {
  initVectorDB,
  saveSession as saveSessionToChroma,
  findSimilarSessions,
  embedSessionTask,
  saveLearning as saveLearningToChroma,
  findSimilarLearnings,
} from '../../src/vector-db';
import { createLearningLink } from '../../src/db';
import { captureFromClaudeCode, formatCapturedContext, type CapturedContext } from './capture-context';

// ============ Git Context Auto-Capture ============

interface GitContext {
  branch: string;
  recentCommits: string[];
  filesChanged: string[];
  diffSummary: string;
}

/**
 * Build rich search content for ChromaDB indexing
 * Includes summary, tags, and key context for better semantic search
 */
function buildSearchContent(summary: string, tags: string[], context: FullContext): string {
  const parts: string[] = [summary];

  if (tags.length > 0) {
    parts.push(tags.join(' '));
  }

  // Add key decisions for searchability
  if (context.key_decisions?.length) {
    parts.push(`Decisions: ${context.key_decisions.join('. ')}`);
  }

  // Add wins and issues
  if (context.wins?.length) {
    parts.push(`Wins: ${context.wins.join('. ')}`);
  }
  if (context.issues?.length) {
    parts.push(`Issues: ${context.issues.join('. ')}`);
  }

  // Add challenges
  if (context.challenges?.length) {
    parts.push(`Challenges: ${context.challenges.join('. ')}`);
  }

  // Add next steps
  if (context.next_steps?.length) {
    parts.push(`Next: ${context.next_steps.join('. ')}`);
  }

  // Add files changed for technical context
  if (context.files_changed?.length) {
    const keyFiles = context.files_changed.slice(0, 10).join(' ');
    parts.push(`Files: ${keyFiles}`);
  }

  // Add git commits for context
  if (context.git_commits?.length) {
    const commits = context.git_commits.slice(0, 5).join(' ');
    parts.push(`Commits: ${commits}`);
  }

  return parts.join(' ');
}

function captureGitContext(): GitContext | null {
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

// Categories for learnings
const TECHNICAL_CATEGORIES = ['performance', 'architecture', 'tooling', 'process', 'debugging', 'security', 'testing'] as const;
const WISDOM_CATEGORIES = ['philosophy', 'principle', 'insight', 'pattern', 'retrospective'] as const;
const ALL_CATEGORIES = [...TECHNICAL_CATEGORIES, ...WISDOM_CATEGORIES] as const;
type Category = typeof ALL_CATEGORIES[number];

const CATEGORY_ICONS: Record<Category, string> = {
  performance: '⚡', architecture: '🏛️', tooling: '🔧', debugging: '🔍',
  security: '🔒', testing: '🧪', process: '📋', philosophy: '🌟',
  principle: '⚖️', insight: '💡', pattern: '🔄', retrospective: '📖',
};

interface TaskInput {
  description: string;
  status: 'done' | 'pending' | 'blocked' | 'in_progress';
  notes?: string;
}

interface LearningInput {
  title: string;
  category: Category;
  context?: string;
  what_happened?: string;
  lesson?: string;
  prevention?: string;
}

// Parse arguments
const args = process.argv.slice(2);
let summary = '';
let tags: string[] = [];
let autoMode = false;
let cliWins: string[] = [];
let cliChallenges: string[] = [];
let cliLearnings: string[] = [];
let cliNextSteps: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--auto') {
    autoMode = true;
  } else if (args[i] === '--tags' && args[i + 1]) {
    tags = args[i + 1].split(',').map(t => t.trim());
    i++;
  } else if (args[i] === '--wins' && args[i + 1]) {
    cliWins = args[i + 1].split(',').map(t => t.trim()).filter(Boolean);
    i++;
  } else if (args[i] === '--challenges' && args[i + 1]) {
    cliChallenges = args[i + 1].split(',').map(t => t.trim()).filter(Boolean);
    i++;
  } else if (args[i] === '--learnings' && args[i + 1]) {
    cliLearnings = args[i + 1].split(',').map(t => t.trim()).filter(Boolean);
    i++;
  } else if (args[i] === '--next-steps' && args[i + 1]) {
    cliNextSteps = args[i + 1].split(',').map(t => t.trim()).filter(Boolean);
    i++;
  } else if (!args[i].startsWith('--')) {
    summary = args[i];
  }
}

async function promptInput(question: string): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parseStatus(input: string): 'done' | 'pending' | 'blocked' | 'in_progress' {
  const normalized = input.toLowerCase().trim();
  if (normalized === 'd' || normalized === 'done') return 'done';
  if (normalized === 'p' || normalized === 'pending') return 'pending';
  if (normalized === 'b' || normalized === 'blocked') return 'blocked';
  if (normalized === 'i' || normalized === 'in_progress' || normalized === 'in-progress') return 'in_progress';
  return 'pending'; // default
}

async function collectTasks(): Promise<TaskInput[]> {
  const tasks: TaskInput[] = [];

  console.log('\n📋 Tasks (enter tasks, empty description to finish):');
  console.log('   Status shortcuts: [d]one, [p]ending, [b]locked, [i]n_progress\n');

  let taskNum = 1;
  while (true) {
    const description = await promptInput(`${taskNum}. Task description: `);
    if (!description) break;

    const statusInput = await promptInput('   Status [d/p/b/i] (default: p): ');
    const status = parseStatus(statusInput || 'p');

    const notes = await promptInput('   Notes (optional): ');

    tasks.push({
      description,
      status,
      notes: notes || undefined,
    });

    taskNum++;
    console.log('');
  }

  return tasks;
}

async function collectLearnings(sessionId: string): Promise<LearningInput[]> {
  const learnings: LearningInput[] = [];

  console.log('\n🧠 Learnings from this session:');
  console.log('   Categories: insight, philosophy, principle, pattern, retrospective');
  console.log('   Technical:  performance, architecture, tooling, debugging, security, testing, process\n');

  const addLearnings = await promptInput('Add learnings? [y/N]: ');
  if (addLearnings.toLowerCase() !== 'y') {
    return learnings;
  }

  let learningNum = 1;
  while (true) {
    const title = await promptInput(`\n   ${learningNum}. Title (empty to finish): `);
    if (!title) break;

    const categoryInput = await promptInput('      Category [insight]: ');
    const category = (categoryInput.toLowerCase() || 'insight') as Category;

    if (!ALL_CATEGORIES.includes(category)) {
      console.log(`      ⚠ Invalid category, using 'insight'`);
    }

    // Prompt for structured learning details
    console.log('      📝 Structured details (all optional):');
    const what_happened = await promptInput('      What happened? > ');
    const lesson = await promptInput('      What did you learn? > ');
    const prevention = await promptInput('      How to prevent/apply? > ');

    learnings.push({
      title,
      category: ALL_CATEGORIES.includes(category) ? category : 'insight',
      what_happened: what_happened || undefined,
      lesson: lesson || undefined,
      prevention: prevention || undefined,
    });

    const icon = CATEGORY_ICONS[ALL_CATEGORIES.includes(category) ? category : 'insight'];
    console.log(`      ${icon} Added!`);

    learningNum++;
  }

  return learnings;
}

async function interactiveMode() {
  console.log('\n📝 Save Session - Interactive Mode\n');
  console.log('─'.repeat(50));

  // Capture git context automatically
  const gitContext = captureGitContext();
  if (gitContext) {
    console.log(`\n🔀 Git branch: ${gitContext.branch}`);
    if (gitContext.recentCommits.length > 0) {
      console.log(`   Recent commits: ${gitContext.recentCommits.length}`);
      for (const commit of gitContext.recentCommits.slice(0, 3)) {
        console.log(`     ${commit}`);
      }
      if (gitContext.recentCommits.length > 3) {
        console.log(`     ... and ${gitContext.recentCommits.length - 3} more`);
      }
    }
    if (gitContext.filesChanged.length > 0) {
      console.log(`   Files changed: ${gitContext.filesChanged.length}`);
    }
  }

  // Show recent sessions for context
  const recent = listSessionsFromDb({ limit: 2 });
  if (recent.length > 0) {
    console.log('\nRecent sessions:');
    for (const s of recent) {
      console.log(`  ${s.id}: ${s.summary?.substring(0, 50)}...`);
    }
    console.log('');
  }

  // Get summary
  if (!summary) {
    summary = await promptInput('Session summary (1-2 sentences): ');
    if (!summary) {
      console.log('Summary is required. Aborting.');
      process.exit(1);
    }
  }

  // Get tags
  if (tags.length === 0) {
    const tagsInput = await promptInput('Tags (comma-separated, optional): ');
    tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
  }

  // Get duration
  const durationInput = await promptInput('Duration in minutes (optional): ');
  const duration = durationInput ? parseInt(durationInput) : undefined;

  // Get commits count (auto-suggest from git)
  const suggestedCommits = gitContext?.recentCommits.length || 0;
  const commitsPrompt = suggestedCommits > 0
    ? `Commits count (detected ${suggestedCommits}, press enter to use): `
    : 'Commits count (optional): ';
  const commitsInput = await promptInput(commitsPrompt);
  const commits = commitsInput ? parseInt(commitsInput) : (suggestedCommits || undefined);

  // Get key decisions (important for context)
  console.log('\n📌 Key decisions made this session:');
  const keyDecisionsInput = await promptInput('   (comma-separated, e.g., "chose X over Y, implemented Z pattern"): ');
  const keyDecisions = keyDecisionsInput ? keyDecisionsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Get wins
  const winsInput = await promptInput('Wins? (comma-separated): ');
  const wins = winsInput ? winsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Get issues
  const issuesInput = await promptInput('Issues? (comma-separated): ');
  const issues = issuesInput ? issuesInput.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Get challenges
  const challengesInput = await promptInput('Challenges? (comma-separated): ');
  const challenges = challengesInput ? challengesInput.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Get next steps
  const nextStepsInput = await promptInput('Next steps? (comma-separated): ');
  const nextSteps = nextStepsInput ? nextStepsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Collect tasks
  const tasks = await collectTasks();

  return {
    summary,
    tags,
    duration,
    commits,
    tasks,
    fullContext: {
      wins: wins.length > 0 ? wins : undefined,
      issues: issues.length > 0 ? issues : undefined,
      key_decisions: keyDecisions.length > 0 ? keyDecisions : undefined,
      challenges: challenges.length > 0 ? challenges : undefined,
      next_steps: nextSteps.length > 0 ? nextSteps : undefined,
      // Git context (auto-captured)
      git_branch: gitContext?.branch,
      git_commits: gitContext?.recentCommits.length ? gitContext.recentCommits : undefined,
      files_changed: gitContext?.filesChanged.length ? gitContext.filesChanged : undefined,
      diff_summary: gitContext?.diffSummary || undefined,
    } as FullContext,
  };
}

async function quickMode() {
  // Auto-capture git context even in quick mode
  const gitContext = captureGitContext();

  console.log('\n📝 Quick Save Mode');
  if (gitContext) {
    console.log(`   🔀 Branch: ${gitContext.branch}`);
    if (gitContext.recentCommits.length > 0) {
      console.log(`   📦 Commits: ${gitContext.recentCommits.length}`);
    }
    if (gitContext.filesChanged.length > 0) {
      console.log(`   📄 Files: ${gitContext.filesChanged.length}`);
    }
  }

  return {
    summary,
    tags,
    duration: undefined,
    commits: gitContext?.recentCommits.length || undefined,
    tasks: [] as TaskInput[],
    fullContext: {
      git_branch: gitContext?.branch,
      git_commits: gitContext?.recentCommits.length ? gitContext.recentCommits : undefined,
      files_changed: gitContext?.filesChanged.length ? gitContext.filesChanged : undefined,
      diff_summary: gitContext?.diffSummary || undefined,
    } as FullContext,
  };
}

async function autoCaptureMode() {
  // Capture context from Claude Code files
  console.log('\n🔄 Auto-Capture Mode');

  let captured: CapturedContext;
  try {
    captured = captureFromClaudeCode(process.cwd());
    console.log(formatCapturedContext(captured));
  } catch (error) {
    console.log('   ⚠ Could not capture from Claude Code files');
    console.log(`   Error: ${error instanceof Error ? error.message : error}`);
    console.log('   Falling back to quick mode...\n');
    return quickMode();
  }

  // Also get git context for additional info
  const gitContext = captureGitContext();

  // Build user messages summary for search content
  const messagesSummary = captured.userMessages.length > 0
    ? `User topics: ${captured.userMessages.slice(-5).join('. ')}`
    : undefined;

  // Extract plan title if available
  const planTitle = captured.planContent
    ? captured.planContent.split('\n').find(l => l.startsWith('# '))?.replace('# ', '')
    : undefined;

  return {
    summary,
    tags,
    duration: captured.duration.minutes,
    commits: gitContext?.recentCommits.length || undefined,
    tasks: captured.tasks,
    fullContext: {
      // From Claude Code capture
      user_messages: captured.userMessages.slice(-10), // Last 10 messages
      plan_file: captured.planFile,
      plan_title: planTitle,
      claude_session_id: captured.sessionId,
      message_count: captured.messageCount,
      // From CLI flags (for distill to extract)
      wins: cliWins.length > 0 ? cliWins : undefined,
      challenges: cliChallenges.length > 0 ? cliChallenges : undefined,
      learnings: cliLearnings.length > 0 ? cliLearnings : undefined,
      next_steps: cliNextSteps.length > 0 ? cliNextSteps : undefined,
      // From git
      git_branch: gitContext?.branch,
      git_commits: gitContext?.recentCommits.length ? gitContext.recentCommits : undefined,
      files_changed: gitContext?.filesChanged.length ? gitContext.filesChanged : undefined,
      diff_summary: gitContext?.diffSummary || undefined,
    } as FullContext,
  };
}

async function saveCurrentSession() {
  // Initialize
  console.log('Initializing vector DB...');
  await initVectorDB();

  // Get session data based on mode
  let data;
  if (autoMode) {
    if (!summary) {
      console.error('Error: --auto mode requires a summary argument');
      console.error('Usage: bun memory save --auto "Your summary here"');
      process.exit(1);
    }
    data = await autoCaptureMode();
  } else if (summary) {
    data = await quickMode();
  } else {
    data = await interactiveMode();
  }

  const sessionId = `session_${Date.now()}`;
  const now = new Date().toISOString();

  const session: SessionRecord = {
    id: sessionId,
    summary: data.summary,
    full_context: data.fullContext,
    duration_mins: data.duration,
    commits_count: data.commits,
    tags: data.tags.length > 0 ? data.tags : undefined,
  };

  console.log('\n1. Saving to SQLite...');
  createSession(session);
  console.log(`   ✓ Session ${sessionId} saved to SQLite`);

  console.log('\n2. Saving to ChromaDB...');
  const searchContent = buildSearchContent(data.summary, data.tags, data.fullContext);
  await saveSessionToChroma(sessionId, searchContent, {
    tags: data.tags,
    created_at: now,
  });
  console.log('   ✓ Session indexed in ChromaDB');
  console.log(`   ℹ Search content: ${searchContent.substring(0, 100)}${searchContent.length > 100 ? '...' : ''}`);

  console.log('\n3. Finding similar sessions for auto-linking...');
  const { autoLinked, suggested } = await findSimilarSessions(searchContent, sessionId);

  if (autoLinked.length > 0) {
    console.log(`   ✓ Auto-linked to ${autoLinked.length} sessions:`);
    for (const link of autoLinked) {
      createSessionLink(sessionId, link.id, 'auto_strong', link.similarity);
      console.log(`     - ${link.id} (similarity: ${link.similarity.toFixed(3)})`);
    }
  } else {
    console.log('   ℹ No sessions similar enough for auto-linking');
  }

  if (suggested.length > 0) {
    console.log(`   ℹ Suggested links (${suggested.length}):`);
    for (const s of suggested.slice(0, 3)) {
      console.log(`     - ${s.id} (${s.similarity.toFixed(3)})`);
    }
  }

  // Prompt for learnings (always, even in quick mode)
  const learnings = await collectLearnings(sessionId);
  if (learnings.length > 0) {
    console.log('\n4. Saving learnings...');
    for (const learning of learnings) {
      // Save to SQLite
      const learningId = createLearning({
        category: learning.category,
        title: learning.title,
        context: learning.context,
        source_session_id: sessionId,
        confidence: 'medium', // User-confirmed during save = medium
        what_happened: learning.what_happened,
        lesson: learning.lesson,
        prevention: learning.prevention,
      });

      // Save to ChromaDB
      const searchContent = `${learning.title} ${learning.lesson || ''} ${learning.what_happened || learning.context || ''}`;
      await saveLearningToChroma(learningId, learning.title, learning.lesson || learning.context || '', {
        category: learning.category,
        confidence: 'medium',
        source_session_id: sessionId,
        created_at: now,
      });

      // Auto-link to similar learnings
      const searchText = `${learning.title} ${learning.context || ''}`;
      const { autoLinked } = await findSimilarLearnings(searchText, { excludeId: learningId });
      for (const link of autoLinked) {
        createLearningLink(learningId, parseInt(link.id), 'auto_strong', link.similarity);
      }

      const icon = CATEGORY_ICONS[learning.category];
      console.log(`   ${icon} Learning #${learningId}: ${learning.title.substring(0, 50)}${learning.title.length > 50 ? '...' : ''}`);
      if (autoLinked.length > 0) {
        console.log(`      🔗 Auto-linked to ${autoLinked.length} similar learning(s)`);
      }
    }
  }

  // Save tasks if provided
  const tasks = data.tasks || [];
  const taskStats = { done: 0, pending: 0, blocked: 0, in_progress: 0 };
  if (tasks.length > 0) {
    console.log('\n5. Saving tasks...');
    for (const task of tasks) {
      const taskId = createSessionTask({
        session_id: sessionId,
        description: task.description,
        status: task.status,
        notes: task.notes,
        completed_at: task.status === 'done' ? now : undefined,
      });

      // Embed task in vector DB for semantic search
      await embedSessionTask(taskId, task.description, {
        session_id: sessionId,
        status: task.status,
        notes: task.notes,
        created_at: now,
      });

      taskStats[task.status]++;
      const statusIcon = task.status === 'done' ? '✓' : task.status === 'blocked' ? '!' : '○';
      console.log(`   ${statusIcon} Task #${taskId}: ${task.description.substring(0, 50)}... [${task.status}]`);
    }
  }

  console.log('\n6. Session stats:');
  const stats = getSessionStats();
  console.log(`   Total sessions: ${stats.total_sessions}`);
  console.log(`   Average duration: ${stats.avg_duration_mins?.toFixed(1) || 'N/A'} mins`);
  console.log(`   Total commits: ${stats.total_commits}`);

  console.log('\n✅ Session saved successfully!');
  console.log(`   Session ID: ${sessionId}`);
  console.log(`   Summary: ${data.summary.substring(0, 60)}...`);
  if (data.tags.length > 0) {
    console.log(`   Tags: ${data.tags.join(', ')}`);
  }
  if (tasks.length > 0) {
    console.log(`   Tasks: ${taskStats.done} done, ${taskStats.pending} pending, ${taskStats.blocked} blocked, ${taskStats.in_progress} in progress`);
  }
  console.log(`   Auto-linked: ${autoLinked.length} sessions`);

  return sessionId;
}

saveCurrentSession().catch(console.error);
