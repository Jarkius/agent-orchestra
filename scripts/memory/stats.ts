#!/usr/bin/env bun
/**
 * /stats - Show session and learning statistics
 * Usage: bun scripts/memory/stats.ts
 */

import { getSessionStats, getImprovementReport, listSessionsFromDb } from '../../src/db';

async function showStats() {
  console.log('\n📊 Memory System Statistics\n');
  console.log('═'.repeat(50));

  // Session stats
  const sessionStats = getSessionStats();
  console.log('\n📅 SESSIONS\n');
  console.log(`  Total sessions:      ${sessionStats.total_sessions}`);
  console.log(`  This week:           ${sessionStats.sessions_this_week}`);
  console.log(`  This month:          ${sessionStats.sessions_this_month}`);
  console.log(`  Avg duration:        ${sessionStats.avg_duration_mins?.toFixed(1) || 'N/A'} mins`);
  console.log(`  Total commits:       ${sessionStats.total_commits}`);

  if (sessionStats.top_tags.length > 0) {
    console.log('\n  Top tags:');
    for (const tag of sessionStats.top_tags.slice(0, 5)) {
      console.log(`    - ${tag.tag} (${tag.count})`);
    }
  }

  if (sessionStats.sessions_by_month.length > 0) {
    console.log('\n  Sessions by month:');
    for (const m of sessionStats.sessions_by_month.slice(0, 6)) {
      const bar = '█'.repeat(Math.min(m.count, 20));
      console.log(`    ${m.month}: ${bar} ${m.count}`);
    }
  }

  // Learning stats
  const report = getImprovementReport();
  console.log('\n' + '═'.repeat(50));
  console.log('\n🧠 LEARNINGS\n');
  console.log(`  Total learnings:     ${report.total_learnings}`);

  if (report.by_confidence.length > 0) {
    console.log('\n  By confidence:');
    for (const conf of report.by_confidence) {
      const emoji = conf.confidence === 'proven' ? '⭐' : conf.confidence === 'high' ? '✓' : '○';
      console.log(`    ${emoji} ${conf.confidence.padEnd(8)}: ${conf.count}`);
    }
  }

  if (report.by_category.length > 0) {
    console.log('\n  By category:');
    for (const cat of report.by_category) {
      console.log(`    - ${cat.category.padEnd(12)}: ${cat.count}`);
    }
  }

  if (report.proven_learnings.length > 0) {
    console.log('\n  ⭐ Proven learnings:');
    for (const l of report.proven_learnings.slice(0, 5)) {
      console.log(`    - ${l.title} (validated ${l.times_validated}x)`);
    }
  }

  if (report.recently_validated.length > 0) {
    console.log('\n  Recently validated:');
    for (const l of report.recently_validated.slice(0, 3)) {
      console.log(`    - [${l.confidence}] ${l.title}`);
    }
  }

  // Recent sessions
  const recentSessions = listSessionsFromDb({ limit: 3 });
  if (recentSessions.length > 0) {
    console.log('\n' + '═'.repeat(50));
    console.log('\n📝 RECENT SESSIONS\n');
    for (const s of recentSessions) {
      console.log(`  ${s.id}`);
      console.log(`  ${s.summary?.substring(0, 70)}...`);
      console.log(`  Tags: ${s.tags?.join(', ') || 'none'}`);
      console.log('');
    }
  }

  console.log('═'.repeat(50));
  console.log('');
}

showStats().catch(console.error);
