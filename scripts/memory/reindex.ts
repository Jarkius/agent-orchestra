#!/usr/bin/env bun
/**
 * Re-index all SQLite data into ChromaDB
 *
 * Usage:
 *   bun memory reindex              - Re-index all collections
 *   bun memory reindex sessions     - Re-index only sessions
 *   bun memory reindex learnings    - Re-index only learnings
 *   bun memory reindex tasks        - Re-index only session tasks
 */

import {
  initVectorDB,
  resetVectorCollections,
  saveSession,
  saveLearning,
  embedSessionTask,
  getCollectionStats,
  ensureChromaRunning,
  checkChromaHealth,
} from "../../src/vector-db";

import {
  listSessionsFromDb,
  listLearningsFromDb,
  getAllSessionTasks,
  rebuildLearningsFTS,
} from "../../src/db";

const args = process.argv.slice(2);
const target = args[0]; // sessions, learnings, tasks, or undefined for all

// ANSI colors
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function header(text: string) {
  console.log(`\n${dim("─".repeat(40))}`);
  console.log(`  ${cyan(text)}`);
  console.log(dim("─".repeat(40)));
}

function progress(current: number, total: number, label: string) {
  const pct = Math.round((current / total) * 100);
  const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r  ${bar} ${pct}% ${label} (${current}/${total})`);
}

async function reindexSessions(): Promise<number> {
  const sessions = listSessionsFromDb({ limit: 10000 });
  if (sessions.length === 0) {
    console.log("  No sessions to index");
    return 0;
  }

  console.log(`  Found ${sessions.length} sessions`);

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!;
    progress(i + 1, sessions.length, "sessions");

    // Build enriched content for better semantic search
    const searchParts = [session.summary];
    if (session.tags) searchParts.push(Array.isArray(session.tags) ? session.tags.join(' ') : session.tags);

    // Parse full_context if available
    if (session.full_context) {
      try {
        const ctx = JSON.parse(session.full_context as string);
        if (ctx.wins?.length) searchParts.push(`Wins: ${ctx.wins.join(', ')}`);
        if (ctx.challenges?.length) searchParts.push(`Challenges: ${ctx.challenges.join(', ')}`);
        if (ctx.next_steps?.length) searchParts.push(`Next: ${ctx.next_steps.join(', ')}`);
        if (ctx.key_decisions?.length) searchParts.push(`Decisions: ${ctx.key_decisions.join(', ')}`);
      } catch {
        // Ignore parse errors
      }
    }

    await saveSession(session.id, searchParts.join(' '), {
      tags: session.tags || [],
      created_at: session.created_at || new Date().toISOString(),
      agent_id: session.agent_id,
      visibility: session.visibility || 'public',
    });
  }

  console.log(); // New line after progress
  return sessions.length;
}

async function reindexLearnings(): Promise<number> {
  const learnings = listLearningsFromDb({ limit: 10000 });
  if (learnings.length === 0) {
    console.log("  No learnings to index");
    return 0;
  }

  console.log(`  Found ${learnings.length} learnings`);

  for (let i = 0; i < learnings.length; i++) {
    const learning = learnings[i]!;
    progress(i + 1, learnings.length, "learnings");

    await saveLearning(learning.id!, learning.title, learning.description || '', {
      category: learning.category,
      confidence: learning.confidence || 'low',
      source_session_id: learning.source_session_id || '',
      created_at: learning.created_at || new Date().toISOString(),
      agent_id: learning.agent_id,
      visibility: learning.visibility || 'public',
    });
  }

  console.log(); // New line after progress
  return learnings.length;
}

async function reindexSessionTasks(): Promise<number> {
  const tasks = getAllSessionTasks(10000);
  if (tasks.length === 0) {
    console.log("  No session tasks to index");
    return 0;
  }

  console.log(`  Found ${tasks.length} session tasks`);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    progress(i + 1, tasks.length, "tasks");

    await embedSessionTask(task.id!, task.description, {
      session_id: task.session_id,
      status: task.status,
      priority: task.priority || 'normal',
      notes: task.notes || '',
      created_at: task.created_at || new Date().toISOString(),
    });
  }

  console.log(); // New line after progress
  return tasks.length;
}

async function main() {
  console.log("\n" + "═".repeat(50));
  console.log("  RE-INDEX VECTOR DATABASE");
  console.log("═".repeat(50));

  // Check ChromaDB health
  const healthy = await checkChromaHealth();
  if (!healthy) {
    console.log(yellow("  ChromaDB not running, starting..."));
    await ensureChromaRunning();
  }

  // Initialize vector DB
  await initVectorDB();
  console.log(green("  ✓ ChromaDB connected"));

  // Determine what to reindex
  const reindexAll = !target;
  const reindexSess = reindexAll || target === 'sessions';
  const reindexLearn = reindexAll || target === 'learnings';
  const reindexTasks = reindexAll || target === 'tasks';

  // Reset collections if doing full reindex
  if (reindexAll) {
    header("RESETTING COLLECTIONS");
    await resetVectorCollections();
    console.log(green("  ✓ Collections cleared"));
    // Re-initialize after reset
    await initVectorDB();
  }

  let totalIndexed = 0;

  // Reindex sessions
  if (reindexSess) {
    header("INDEXING SESSIONS");
    totalIndexed += await reindexSessions();
  }

  // Reindex learnings
  if (reindexLearn) {
    header("INDEXING LEARNINGS");
    totalIndexed += await reindexLearnings();

    // Also rebuild FTS index for keyword search
    console.log(`  Rebuilding FTS index...`);
    const ftsCount = rebuildLearningsFTS();
    console.log(green(`  ✓ FTS index: ${ftsCount} entries`));
  }

  // Reindex session tasks
  if (reindexTasks) {
    header("INDEXING SESSION TASKS");
    totalIndexed += await reindexSessionTasks();
  }

  // Show final stats
  header("FINAL STATS");
  const stats = await getCollectionStats();
  console.log(`  Sessions:      ${stats.orchestrator_sessions}`);
  console.log(`  Learnings:     ${stats.orchestrator_learnings}`);
  console.log(`  Session Tasks: ${stats.session_tasks}`);
  console.log();
  console.log(green(`  ✓ Re-indexed ${totalIndexed} records`));
  console.log();
}

main().catch(console.error);
