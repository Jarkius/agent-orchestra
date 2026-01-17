#!/usr/bin/env bun
/**
 * Interactive Session Save
 * Save current session with full context to SQLite + ChromaDB
 *
 * Usage:
 *   bun memory save                    # Interactive mode
 *   bun memory save "summary" --tags tag1,tag2
 */

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
}

// Parse arguments
const args = process.argv.slice(2);
let summary = '';
let tags: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tags' && args[i + 1]) {
    tags = args[i + 1].split(',').map(t => t.trim());
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

    const context = await promptInput('      Context (optional): ');

    learnings.push({
      title,
      category: ALL_CATEGORIES.includes(category) ? category : 'insight',
      context: context || undefined,
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
    const tagsInput = await promptInput('Tags (comma-separated): ');
    tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
  }

  // Get duration
  const durationInput = await promptInput('Duration in minutes (optional): ');
  const duration = durationInput ? parseInt(durationInput) : undefined;

  // Get commits
  const commitsInput = await promptInput('Commits count (optional): ');
  const commits = commitsInput ? parseInt(commitsInput) : undefined;

  // Get what worked
  const whatWorkedInput = await promptInput('What worked? (comma-separated, optional): ');
  const whatWorked = whatWorkedInput ? whatWorkedInput.split(',').map(t => t.trim()) : [];

  // Get what didn't work
  const whatDidntInput = await promptInput('What didn\'t work? (comma-separated, optional): ');
  const whatDidnt = whatDidntInput ? whatDidntInput.split(',').map(t => t.trim()) : [];

  // Note: Learnings are now captured AFTER save with proper category selection

  // Collect tasks
  const tasks = await collectTasks();

  return {
    summary,
    tags,
    duration,
    commits,
    tasks,
    fullContext: {
      what_worked: whatWorked.length > 0 ? whatWorked : undefined,
      what_didnt_work: whatDidnt.length > 0 ? whatDidnt : undefined,
      // learnings removed - now captured as proper learnings after save
    } as FullContext,
  };
}

async function quickMode() {
  return {
    summary,
    tags,
    duration: undefined,
    commits: undefined,
    tasks: [] as TaskInput[],
    fullContext: {} as FullContext,
  };
}

async function saveCurrentSession() {
  // Initialize
  console.log('Initializing vector DB...');
  await initVectorDB();

  // Get session data
  const data = summary ? await quickMode() : await interactiveMode();

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
  const searchContent = `${data.summary} ${data.tags.join(' ')}`;
  await saveSessionToChroma(sessionId, searchContent, {
    tags: data.tags,
    created_at: now,
  });
  console.log('   ✓ Session indexed in ChromaDB');

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
      });

      // Save to ChromaDB
      await saveLearningToChroma(learningId, learning.title, learning.context || '', {
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
