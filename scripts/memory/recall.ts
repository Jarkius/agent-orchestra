#!/usr/bin/env bun
/**
 * /recall - Quick semantic search for past sessions and learnings
 * Usage: bun scripts/memory/recall.ts "your search query"
 */

import { initVectorDB, searchSessions, searchLearnings, searchSessionTasks } from '../../src/vector-db';
import { getSessionById, getLearningById, getSessionTasks, getSessionTaskStats } from '../../src/db';

const query = process.argv[2];

if (!query) {
  console.log('Usage: bun scripts/memory/recall.ts "search query"');
  console.log('');
  console.log('Examples:');
  console.log('  bun scripts/memory/recall.ts "embedding performance"');
  console.log('  bun scripts/memory/recall.ts "docker chromadb"');
  process.exit(1);
}

async function recall() {
  console.log(`\n🔍 Searching for: "${query}"\n`);

  await initVectorDB();

  // Search sessions
  console.log('━━━ Sessions ━━━');
  const sessionResults = await searchSessions(query, 3);

  if (sessionResults.ids[0]?.length) {
    for (let i = 0; i < sessionResults.ids[0].length; i++) {
      const id = sessionResults.ids[0][i];
      const distance = sessionResults.distances?.[0]?.[i] || 0;
      const relevance = (1 - distance).toFixed(3);
      const session = getSessionById(id);

      console.log(`\n  [${relevance}] ${id}`);
      console.log(`  ${session?.summary?.substring(0, 100)}...`);
      console.log(`  Tags: ${session?.tags?.join(', ') || 'none'}`);

      // Show tasks for this session
      const tasks = getSessionTasks(id);
      if (tasks.length > 0) {
        console.log('  📋 Tasks:');
        for (const task of tasks.slice(0, 5)) {
          const icon = task.status === 'done' ? '✓' : task.status === 'blocked' ? '!' : task.status === 'in_progress' ? '→' : '○';
          console.log(`     ${icon} ${task.description.substring(0, 60)}${task.description.length > 60 ? '...' : ''}`);
        }
        if (tasks.length > 5) {
          console.log(`     ... and ${tasks.length - 5} more tasks`);
        }
      }
    }
  } else {
    console.log('  No matching sessions found');
  }

  // Search learnings
  console.log('\n━━━ Learnings ━━━');
  const learningResults = await searchLearnings(query, 5);

  if (learningResults.ids[0]?.length) {
    for (let i = 0; i < learningResults.ids[0].length; i++) {
      const id = learningResults.ids[0][i];
      const numId = parseInt(id.replace('learning_', ''));
      const distance = learningResults.distances?.[0]?.[i] || 0;
      const relevance = (1 - distance).toFixed(3);
      const learning = getLearningById(numId);

      if (learning) {
        const badge = learning.confidence === 'proven' ? '**' : learning.confidence === 'high' ? '*' : '';
        console.log(`\n  [${relevance}] #${learning.id} ${badge}${learning.title}${badge}`);
        console.log(`  Category: ${learning.category} | Confidence: ${learning.confidence}`);
        if (learning.description) {
          console.log(`  ${learning.description.substring(0, 80)}...`);
        }
      }
    }
  } else {
    console.log('  No matching learnings found');
  }

  // Search tasks directly
  console.log('\n━━━ Tasks ━━━');
  const taskResults = await searchSessionTasks(query, 5);

  if (taskResults.length > 0) {
    for (const task of taskResults) {
      const icon = task.status === 'done' ? '✓' : task.status === 'blocked' ? '!' : task.status === 'in_progress' ? '→' : '○';
      console.log(`\n  [${task.similarity.toFixed(3)}] Task #${task.id} in ${task.session_id}`);
      console.log(`  ${icon} "${task.description}" [${task.status}]`);
      if (task.notes) {
        console.log(`  Notes: ${task.notes.substring(0, 60)}...`);
      }
      // Get session context
      const session = getSessionById(task.session_id);
      if (session) {
        console.log(`  Session: ${session.summary?.substring(0, 60)}...`);
      }
    }
  } else {
    console.log('  No matching tasks found');
  }

  console.log('\n');
}

recall().catch(console.error);
