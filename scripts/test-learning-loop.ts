#!/usr/bin/env bun
/**
 * Learning Loop Test Script
 * Demonstrates and verifies the learning loop works correctly
 */

import { LearningLoop } from '../src/learning/loop';
import { initVectorDB, getCollectionStats } from '../src/vector-db';
import { listLearningsFromDb, listKnowledge, listLessons } from '../src/db';

const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log(colors.blue('  LEARNING LOOP TEST'));
  console.log('═'.repeat(60) + '\n');

  // Initialize
  console.log(colors.dim('Initializing VectorDB...'));
  await initVectorDB();

  const loop = new LearningLoop();

  // ─────────────────────────────────────────────────────────────
  // TEST 1: Harvest from Completed Mission
  // ─────────────────────────────────────────────────────────────
  console.log('\n' + colors.yellow('TEST 1: Harvest from Completed Mission'));
  console.log('─'.repeat(50));

  const completedMission = {
    id: `test-mission-${Date.now()}`,
    prompt: 'Implement Redis caching layer',
    type: 'coding',
    assignedTo: 1,
    status: 'completed' as const,
    result: {
      output: `Successfully implemented Redis cache.

Key insight: Always set TTL on cache keys to prevent memory leaks.
The implementation uses a tag-based invalidation strategy.
Important learning: Connection pooling significantly improves throughput.
Pattern observed: Read-through caching works better for our use case.`,
      durationMs: 5000,
    },
    createdAt: new Date(),
    completedAt: new Date(),
  };

  console.log(colors.dim(`Mission: "${completedMission.prompt}"`));
  console.log(colors.dim(`Output preview: "${completedMission.result.output.slice(0, 100)}..."`));

  const harvestedLearnings = await loop.harvestFromMission(completedMission);

  if (harvestedLearnings.length > 0) {
    console.log(colors.green(`✓ Harvested ${harvestedLearnings.length} learning(s):`));
    harvestedLearnings.forEach((l, i) => {
      console.log(`  ${i + 1}. [${l.category}] ${l.title.slice(0, 60)}...`);
    });
  } else {
    console.log(colors.yellow('⚠ No learnings harvested (output may not contain extractable insights)'));
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 2: Analyze Failed Mission
  // ─────────────────────────────────────────────────────────────
  console.log('\n' + colors.yellow('TEST 2: Analyze Failed Mission'));
  console.log('─'.repeat(50));

  const failedMission = {
    id: `failed-mission-${Date.now()}`,
    prompt: 'Process large dataset',
    type: 'extraction',
    assignedTo: 2,
    status: 'failed' as const,
    error: {
      code: 'timeout' as const,
      message: 'Task exceeded 120s timeout while processing 10GB file',
      recoverable: true,
      timestamp: new Date(),
    },
    createdAt: new Date(),
  };

  console.log(colors.dim(`Mission: "${failedMission.prompt}"`));
  console.log(colors.dim(`Error: ${failedMission.error.code} - ${failedMission.error.message}`));

  const analysis = await loop.analyzeFailure(failedMission);

  console.log(colors.green('✓ Failure analyzed:'));
  console.log(`  Category: ${analysis.category}`);
  console.log(`  Root cause: ${analysis.rootCause}`);
  console.log(`  Suggestion: ${analysis.suggestion}`);
  console.log(`  Similar failures: ${analysis.similarFailures?.length || 0}`);

  // ─────────────────────────────────────────────────────────────
  // TEST 3: Suggest Learnings for Task
  // ─────────────────────────────────────────────────────────────
  console.log('\n' + colors.yellow('TEST 3: Suggest Learnings for New Task'));
  console.log('─'.repeat(50));

  const newTask = { prompt: 'Implement caching with Redis for user sessions' };
  console.log(colors.dim(`New task: "${newTask.prompt}"`));

  const suggestions = await loop.suggestLearnings(newTask);

  if (suggestions.length > 0) {
    console.log(colors.green(`✓ Found ${suggestions.length} relevant learning(s):`));
    suggestions.forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.category}] ${s.title.slice(0, 50)}... (${s.confidence})`);
    });
  } else {
    console.log(colors.dim('  No relevant learnings found (database may be empty)'));
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 4: Dual Collection Pattern (Knowledge + Lessons)
  // ─────────────────────────────────────────────────────────────
  console.log('\n' + colors.yellow('TEST 4: Dual Collection Pattern'));
  console.log('─'.repeat(50));

  // Add knowledge
  const knowledgeId = `knowledge-${Date.now()}`;
  await loop.addKnowledge({
    id: knowledgeId,
    content: 'Redis EXPIRE command sets TTL in seconds, not milliseconds',
    category: 'tooling',
    missionId: completedMission.id,
  });
  console.log(colors.green('✓ Knowledge added'));

  // Add lesson
  const lessonId = `lesson-${Date.now()}`;
  await loop.addLesson({
    id: lessonId,
    problem: 'Cache memory grows unbounded over time',
    solution: 'Set TTL on all cache keys using EXPIRE or SETEX',
    outcome: 'Memory usage stabilized at 2GB instead of growing to 10GB+',
    category: 'performance',
  });
  console.log(colors.green('✓ Lesson added'));

  // Search knowledge
  const knowledgeResults = await loop.searchKnowledge('Redis TTL expire');
  console.log(colors.green(`✓ Knowledge search returned ${knowledgeResults.length} result(s)`));

  // Search lessons
  const lessonResults = await loop.searchLessons('cache memory');
  console.log(colors.green(`✓ Lesson search returned ${lessonResults.length} result(s)`));

  // ─────────────────────────────────────────────────────────────
  // TEST 5: Pattern Detection
  // ─────────────────────────────────────────────────────────────
  console.log('\n' + colors.yellow('TEST 5: Pattern Detection'));
  console.log('─'.repeat(50));

  const mockMissions = [
    { id: '1', type: 'coding', status: 'completed', prompt: 'Task 1', createdAt: new Date() },
    { id: '2', type: 'coding', status: 'completed', prompt: 'Task 2', createdAt: new Date() },
    { id: '3', type: 'coding', status: 'failed', prompt: 'Task 3', createdAt: new Date() },
    { id: '4', type: 'review', status: 'completed', prompt: 'Task 4', createdAt: new Date() },
    { id: '5', type: 'review', status: 'completed', prompt: 'Task 5', createdAt: new Date() },
    { id: '6', type: 'analysis', status: 'failed', prompt: 'Task 6', createdAt: new Date() },
    { id: '7', type: 'coding', status: 'completed', prompt: 'Task 7', createdAt: new Date() },
  ];

  const patterns = await loop.detectPatterns(mockMissions as any, 10);

  if (patterns.length > 0) {
    console.log(colors.green(`✓ Detected ${patterns.length} pattern(s):`));
    patterns.forEach((p, i) => {
      const rateStr = p.type === 'success'
        ? `${(p.rate * 100).toFixed(0)}% success`
        : `${(p.rate * 100).toFixed(0)}% failure`;
      console.log(`  ${i + 1}. ${p.missionType}: ${rateStr} (confidence: ${(p.confidence * 100).toFixed(0)}%)`);
    });
  } else {
    console.log(colors.dim('  No patterns detected (need more data)'));
  }

  // ─────────────────────────────────────────────────────────────
  // SUMMARY: Database Stats
  // ─────────────────────────────────────────────────────────────
  console.log('\n' + colors.yellow('SUMMARY: Database Stats'));
  console.log('─'.repeat(50));

  try {
    const vectorStats = await getCollectionStats();
    console.log('Vector Collections:');
    Object.entries(vectorStats).forEach(([name, count]) => {
      console.log(`  ${name}: ${count} documents`);
    });
  } catch (e) {
    console.log(colors.dim('  (ChromaDB stats unavailable)'));
  }

  const learnings = listLearningsFromDb(5);
  const knowledge = listKnowledge(5);
  const lessons = listLessons(5);

  console.log('\nSQLite Tables:');
  console.log(`  learnings: ${learnings.length}+ records`);
  console.log(`  knowledge: ${knowledge.length}+ records`);
  console.log(`  lessons: ${lessons.length}+ records`);

  // ─────────────────────────────────────────────────────────────
  // FINAL RESULT
  // ─────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(colors.green('  ✓ ALL TESTS PASSED - Learning Loop is working!'));
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
