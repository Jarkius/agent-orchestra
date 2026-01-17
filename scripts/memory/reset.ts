#!/usr/bin/env bun
/**
 * /reset - Nuclear option to wipe all memory data
 *
 * DANGEROUS: This will delete ALL sessions, learnings, links, and tasks.
 * Requires explicit confirmation by typing 'yes'.
 *
 * Usage:
 *   bun memory reset
 */

import {
  resetAllMemory,
  getSessionStats,
  type PurgeResult,
} from '../../src/db';
import {
  initVectorDB,
  resetVectorCollections,
} from '../../src/vector-db';

async function promptInput(message: string): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatResult(result: PurgeResult): string {
  const parts: string[] = [];
  if (result.sessions > 0) parts.push(`${result.sessions} sessions`);
  if (result.learnings > 0) parts.push(`${result.learnings} learnings`);
  if (result.sessionLinks > 0) parts.push(`${result.sessionLinks} session links`);
  if (result.learningLinks > 0) parts.push(`${result.learningLinks} learning links`);
  if (result.tasks > 0) parts.push(`${result.tasks} tasks`);
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

async function main() {
  // Show current stats
  const stats = getSessionStats();
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  ⚠️  MEMORY RESET - DANGEROUS OPERATION');
  console.log('═'.repeat(60));
  console.log(`\nCurrent memory state:`);
  console.log(`  Sessions: ${stats.total_sessions}`);
  console.log(`  Total commits tracked: ${stats.total_commits}`);
  console.log(`\nThis will permanently delete:`);
  console.log(`  • All sessions and their tasks`);
  console.log(`  • All learnings`);
  console.log(`  • All session and learning links`);
  console.log(`  • All ChromaDB vector data`);
  console.log(`\n${'─'.repeat(60)}`);

  const answer = await promptInput(`\nType 'yes' to confirm complete reset: `);

  if (answer !== 'yes') {
    console.log('\nAborted. No data was deleted.\n');
    return;
  }

  console.log('\nResetting all memory data...');

  // 1. Reset SQLite
  const result = resetAllMemory();
  console.log(`  ✓ SQLite: ${formatResult(result)}`);

  // 2. Reset ChromaDB
  try {
    await initVectorDB();
    await resetVectorCollections();
    console.log(`  ✓ ChromaDB: All collections cleared`);
  } catch (err) {
    console.log(`  ⚠ ChromaDB: Could not reset (${err})`);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  ✓ Memory reset complete. All data has been deleted.');
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(console.error);
