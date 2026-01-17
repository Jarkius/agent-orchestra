#!/usr/bin/env bun
/**
 * /purge - Selectively purge memory data
 *
 * Usage:
 *   bun memory purge sessions           # Purge all sessions
 *   bun memory purge learnings          # Purge all learnings
 *   bun memory purge --before "2025-01-01"  # Purge old data
 *   bun memory purge --keep 10          # Keep last N, purge rest
 *   bun memory purge sessions --yes     # Skip confirmation
 */

import {
  purgeSessions,
  purgeLearnings,
  getSessionStats,
  type PurgeResult,
} from '../../src/db';
import { initVectorDB } from '../../src/vector-db';

const args = process.argv.slice(2);

async function promptConfirm(message: string): Promise<boolean> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

function parseArgs() {
  let target: 'sessions' | 'learnings' | null = null;
  let before: string | undefined;
  let keep: number | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'sessions' || arg === 's') {
      target = 'sessions';
    } else if (arg === 'learnings' || arg === 'l') {
      target = 'learnings';
    } else if (arg === '--before' && args[i + 1]) {
      before = args[i + 1];
      i++;
    } else if (arg === '--keep' && args[i + 1]) {
      keep = parseInt(args[i + 1]);
      i++;
    } else if (arg === '--yes' || arg === '-y') {
      force = true;
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  return { target, before, keep, force };
}

function showHelp() {
  console.log(`
Usage: bun memory purge <target> [options]

Targets:
  sessions, s     Purge sessions (and related tasks/links)
  learnings, l    Purge learnings (and related links)

Options:
  --before DATE   Purge items created before this date (ISO format)
  --keep N        Keep the last N items, purge the rest
  --yes, -y       Skip confirmation prompt

Examples:
  bun memory purge sessions                    # Purge all sessions
  bun memory purge learnings --yes             # Purge all learnings without prompt
  bun memory purge sessions --keep 10          # Keep last 10 sessions
  bun memory purge sessions --before 2025-01-01  # Purge sessions before 2025
`);
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
  const { target, before, keep, force } = parseArgs();

  if (!target) {
    console.log('Error: Please specify a target (sessions or learnings)');
    showHelp();
    process.exit(1);
  }

  // Show current stats
  const stats = getSessionStats();
  console.log(`\nCurrent memory state:`);
  console.log(`  Sessions: ${stats.total_sessions}`);
  console.log(`  Learnings: ${stats.total_learnings || 'N/A'}`);

  // Build description
  let description = `all ${target}`;
  if (before) description = `${target} before ${before}`;
  if (keep !== undefined) description = `${target} except last ${keep}`;

  // Confirm
  if (!force) {
    const confirmed = await promptConfirm(`\n⚠️  Purge ${description}? [y/N] `);
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
  }

  console.log(`\nPurging ${description}...`);

  // Initialize ChromaDB for cleanup
  await initVectorDB();

  let result: PurgeResult;
  if (target === 'sessions') {
    result = purgeSessions({ before, keep });
  } else {
    result = purgeLearnings({ before, keep });
  }

  console.log(`\n✓ Purged: ${formatResult(result)}`);

  // Show new stats
  const newStats = getSessionStats();
  console.log(`\nNew memory state:`);
  console.log(`  Sessions: ${newStats.total_sessions}`);
  console.log(`  Learnings: ${newStats.total_learnings || 'N/A'}\n`);
}

main().catch(console.error);
