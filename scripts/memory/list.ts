#!/usr/bin/env bun
/**
 * /list - List recent sessions or learnings
 * Usage: bun scripts/memory/list.ts [sessions|learnings]
 */

import { listSessionsFromDb, listLearningsFromDb, getSessionTaskStats } from '../../src/db';

const type = process.argv[2] || 'sessions';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ANSI color codes
const CYAN = '\u001b[36m';
const RESET = '\u001b[0m';

/**
 * Convert UTC timestamp to local time display (dd Mon yyyy HH:mm)
 */
function toLocalTime(utcString?: string): string {
  if (!utcString) return 'unknown';
  const date = new Date(utcString + (utcString.endsWith('Z') ? '' : 'Z'));
  const day = date.getDate().toString().padStart(2, '0');
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  return `${day} ${month} ${year} ${hours}:${mins}`;
}

async function list() {
  if (type === 'sessions' || type === 's') {
    console.log('\n📅 Recent Sessions\n');
    console.log('─'.repeat(60));

    const sessions = listSessionsFromDb({ limit: 10 });

    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }

    for (const s of sessions) {
      const duration = s.duration_mins ? `${s.duration_mins} mins` : '-';
      const commits = s.commits_count || 0;
      const created = toLocalTime(s.created_at);

      console.log(`\n${created} │ Duration: ${duration} │ Commits: ${commits}`);
      console.log(`  ${CYAN}${s.id}${RESET}`);
      console.log(`  ${s.summary?.substring(0, 80)}${s.summary && s.summary.length > 80 ? '...' : ''}`);

      if (s.tags && s.tags.length > 0) {
        console.log(`  Tags: ${s.tags.join(', ')}`);
      }

      // Show task stats
      const taskStats = getSessionTaskStats(s.id);
      const totalTasks = taskStats.done + taskStats.pending + taskStats.blocked + taskStats.in_progress;
      if (totalTasks > 0) {
        const parts: string[] = [];
        if (taskStats.done > 0) parts.push(`${taskStats.done} done`);
        if (taskStats.pending > 0) parts.push(`${taskStats.pending} pending`);
        if (taskStats.blocked > 0) parts.push(`${taskStats.blocked} blocked`);
        if (taskStats.in_progress > 0) parts.push(`${taskStats.in_progress} in progress`);
        console.log(`  Tasks: ${parts.join(', ')}`);
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`Total: ${sessions.length} sessions shown\n`);

  } else if (type === 'learnings' || type === 'l') {
    console.log('\n🧠 Recent Learnings\n');
    console.log('─'.repeat(60));

    const learnings = listLearningsFromDb({ limit: 15 });

    if (learnings.length === 0) {
      console.log('No learnings found.');
      return;
    }

    // Group by category for display
    const byCategory: Record<string, typeof learnings> = {};
    for (const l of learnings) {
      if (!byCategory[l.category]) {
        byCategory[l.category] = [];
      }
      byCategory[l.category].push(l);
    }

    for (const [category, items] of Object.entries(byCategory)) {
      console.log(`\n## ${category.toUpperCase()}`);
      for (const l of items) {
        const badge = l.confidence === 'proven' ? '⭐' : l.confidence === 'high' ? '✓' : '○';
        const validated = l.times_validated && l.times_validated > 1 ? ` (${l.times_validated}x)` : '';
        const timestamp = toLocalTime(l.created_at);
        console.log(`  ${badge} #${l.id} ${l.title}${validated}`);
        console.log(`    Created: ${timestamp}`);
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`Total: ${learnings.length} learnings shown\n`);

  } else {
    console.log('Usage: bun scripts/memory/list.ts [sessions|learnings]');
    console.log('  Aliases: s = sessions, l = learnings');
  }
}

list().catch(console.error);
