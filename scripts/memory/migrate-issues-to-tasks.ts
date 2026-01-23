#!/usr/bin/env bun
/**
 * Migration: Convert debugging learnings to unified tasks
 *
 * This script migrates learnings with category='debugging' that look like issues
 * (title starting with [component]) to the unified_tasks table.
 *
 * Usage:
 *   bun scripts/memory/migrate-issues-to-tasks.ts           # Dry run
 *   bun scripts/memory/migrate-issues-to-tasks.ts --apply   # Apply changes
 */

import { db, createUnifiedTask, type UnifiedTaskCreate } from '../../src/db';

interface DebugLearning {
  id: number;
  title: string;
  description: string | null;
  lesson: string | null;
  prevention: string | null;
  source_url: string | null;
  created_at: string;
}

function parseIssueFromLearning(learning: DebugLearning): UnifiedTaskCreate | null {
  // Check if title matches issue pattern: [component] description
  const match = learning.title.match(/^\[(\w+)\]\s*(.+)$/);
  if (!match) return null;

  const component = match[1];
  const title = match[2];

  // Parse severity from lesson
  const severityMatch = learning.lesson?.match(/Severity:\s*(\w+)/i);
  let priority: 'critical' | 'high' | 'normal' | 'low' = 'normal';
  if (severityMatch) {
    const sev = severityMatch[1]?.toLowerCase();
    if (sev === 'critical') priority = 'critical';
    else if (sev === 'high') priority = 'high';
    else if (sev === 'low') priority = 'low';
  }

  // Parse repro steps from lesson
  const reproMatch = learning.lesson?.match(/Repro:\s*(.+?)(?:\||$)/);
  const repro = reproMatch?.[1]?.trim();

  // Parse fix from prevention
  const fixMatch = learning.prevention?.replace(/^Fix:\s*/i, '');
  const fix = fixMatch?.trim();

  // Determine status based on source_url (has GitHub = potentially done)
  const hasGitHub = learning.source_url?.includes('github.com');
  let status: 'open' | 'done' = 'open';

  // Parse GitHub issue number if present
  let githubIssueNumber: number | undefined;
  let githubIssueUrl: string | undefined;
  if (hasGitHub) {
    const ghMatch = learning.source_url?.match(/github\.com\/[^\/]+\/[^\/]+\/issues\/(\d+)/);
    if (ghMatch) {
      githubIssueNumber = parseInt(ghMatch[1]);
      githubIssueUrl = learning.source_url || undefined;
    }
  }

  return {
    title: `[${component}] ${title}`,
    domain: 'system',
    priority,
    component,
    repro_steps: repro,
    known_fix: fix,
    learning_id: learning.id,
    github_issue_number: githubIssueNumber,
    github_issue_url: githubIssueUrl,
  };
}

async function main() {
  const dryRun = !process.argv.includes('--apply');

  console.log('\n📦 Migration: Debugging Learnings → Unified Tasks');
  console.log('─'.repeat(50));

  if (dryRun) {
    console.log('Mode: DRY RUN (use --apply to execute)\n');
  } else {
    console.log('Mode: APPLYING CHANGES\n');
  }

  // Find debugging learnings with issue-like titles
  const learnings = db.query(`
    SELECT id, title, description, lesson, prevention, source_url, created_at
    FROM learnings
    WHERE category = 'debugging'
      AND title LIKE '[%]%'
    ORDER BY id ASC
  `).all() as DebugLearning[];

  if (learnings.length === 0) {
    console.log('No debugging learnings with [component] pattern found.\n');
    return;
  }

  console.log(`Found ${learnings.length} learnings to migrate:\n`);

  let migrated = 0;
  let skipped = 0;

  for (const learning of learnings) {
    const taskData = parseIssueFromLearning(learning);

    if (!taskData) {
      console.log(`  ⏭️  #${learning.id}: ${learning.title} (doesn't match pattern)`);
      skipped++;
      continue;
    }

    // Check if already migrated
    const existing = db.query(`
      SELECT id FROM unified_tasks WHERE learning_id = ?
    `).get(learning.id);

    if (existing) {
      console.log(`  ⏭️  #${learning.id}: ${learning.title} (already migrated)`);
      skipped++;
      continue;
    }

    console.log(`  ${dryRun ? '📋' : '✅'} #${learning.id}: ${learning.title}`);
    console.log(`      → Task: ${taskData.title}`);
    console.log(`      → Priority: ${taskData.priority}, Component: ${taskData.component}`);
    if (taskData.github_issue_number) {
      console.log(`      → GitHub #${taskData.github_issue_number}`);
    }

    if (!dryRun) {
      createUnifiedTask(taskData);
    }

    migrated++;
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Summary: ${migrated} migrated, ${skipped} skipped`);

  if (dryRun && migrated > 0) {
    console.log('\nRun with --apply to execute migration.\n');
  } else if (!dryRun) {
    console.log('\nMigration complete.\n');
  }
}

main().catch(console.error);
