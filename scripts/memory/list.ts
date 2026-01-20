#!/usr/bin/env bun
/**
 * /list - List recent sessions or learnings
 * Usage: bun scripts/memory/list.ts [sessions|learnings] [-i|--interactive]
 */

import { listSessionsFromDb, listLearningsFromDb, getSessionTaskStats, getSessionById } from '../../src/db';
import Enquirer from 'enquirer';

// Parse arguments
// When invoked via index.ts, args includes "list" as first arg, so filter it out
const rawArgs = process.argv.slice(2);
const args = rawArgs.filter(a => a !== 'list');
const interactive = args.includes('-i') || args.includes('--interactive');
const typeArg = args.find(a => !a.startsWith('-')) || 'sessions';
const type = typeArg;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ANSI color codes
const RESET = '\u001b[0m';
const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const CYAN = '\u001b[36m';
const YELLOW = '\u001b[33m';
const GREEN = '\u001b[32m';
const WHITE = '\u001b[37m';

import { spawnSync } from 'child_process';

/**
 * Copy text to clipboard (cross-platform)
 */
function copyToClipboard(text: string): boolean {
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      spawnSync('pbcopy', { input: text });
    } else if (platform === 'linux') {
      // Try xclip first, then xsel
      const xclip = spawnSync('xclip', ['-selection', 'clipboard'], { input: text });
      if (xclip.error) {
        spawnSync('xsel', ['--clipboard', '--input'], { input: text });
      }
    } else if (platform === 'win32') {
      spawnSync('clip', { input: text, shell: true });
    }
    return true;
  } catch {
    return false;
  }
}

// Box drawing characters
const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  leftT: '├',
  rightT: '┤',
  topT: '┬',
  bottomT: '┴',
  cross: '┼',
};

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

/**
 * Show detailed view of a single session
 */
function showSessionDetail(sessionId: string): void {
  const session = getSessionById(sessionId);
  if (!session) {
    console.log(`${YELLOW}Session not found${RESET}`);
    return;
  }

  console.log('\n' + BOX.horizontal.repeat(60));
  console.log(`${BOLD}${CYAN}Session: ${session.id}${RESET}`);
  console.log(BOX.horizontal.repeat(60));

  console.log(`\n${BOLD}Summary:${RESET}`);
  console.log(`  ${session.summary || 'No summary'}`);

  console.log(`\n${BOLD}Details:${RESET}`);
  console.log(`  Created:  ${toLocalTime(session.created_at)}`);
  console.log(`  Duration: ${session.duration_mins ? `${session.duration_mins} mins` : '-'}`);
  console.log(`  Commits:  ${session.commits_count || 0}`);

  if (session.tags && session.tags.length > 0) {
    console.log(`  Tags:     ${GREEN}${session.tags.join(', ')}${RESET}`);
  }

  // Task stats
  const taskStats = getSessionTaskStats(session.id);
  const totalTasks = taskStats.done + taskStats.pending + taskStats.blocked + taskStats.in_progress;
  if (totalTasks > 0) {
    console.log(`\n${BOLD}Tasks:${RESET}`);
    if (taskStats.done > 0) console.log(`  ${GREEN}✓ ${taskStats.done} done${RESET}`);
    if (taskStats.pending > 0) console.log(`  ${YELLOW}○ ${taskStats.pending} pending${RESET}`);
    if (taskStats.in_progress > 0) console.log(`  ${CYAN}▶ ${taskStats.in_progress} in progress${RESET}`);
    if (taskStats.blocked > 0) console.log(`  ✗ ${taskStats.blocked} blocked`);
  }

  // Git context if available
  if (session.full_context) {
    try {
      const ctx = typeof session.full_context === 'string'
        ? JSON.parse(session.full_context)
        : session.full_context;
      if (ctx.git) {
        console.log(`\n${BOLD}Git Context:${RESET}`);
        if (ctx.git.branch) console.log(`  Branch: ${GREEN}${ctx.git.branch}${RESET}`);
        if (ctx.git.commits && ctx.git.commits.length > 0) {
          console.log(`  Recent commits:`);
          ctx.git.commits.slice(0, 5).forEach((c: string) => {
            console.log(`    ${DIM}${c}${RESET}`);
          });
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  console.log('\n' + BOX.horizontal.repeat(60) + '\n');
}

/**
 * Interactive session browser
 */
async function interactiveSessionList(): Promise<void> {
  const sessions = listSessionsFromDb({ limit: 20 });

  if (sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  // Calculate available width for summary in interactive mode
  const termWidth = process.stdout.columns || 120;
  const prefixWidth = 20 + 3 + 13 + 3; // date + separator + id + separator
  const interactiveSummaryWidth = Math.max(50, termWidth - prefixWidth - 5);

  while (true) {
    const choices = sessions.map(s => ({
      name: s.id,
      message: `${toLocalTime(s.created_at)} │ ${CYAN}${s.id.replace('session_', '').substring(0, 13)}${RESET} │ ${(s.summary || 'No summary').substring(0, interactiveSummaryWidth)}`,
      value: s.id,
    }));

    choices.push({ name: '__quit', message: `${DIM}[q] Quit${RESET}`, value: '__quit' });

    try {
      const prompt = new (Enquirer as any).Select({
        name: 'session',
        message: '📅 Select a session (↑↓ to navigate, Enter to view details)',
        choices,
        pointer: '▶',
      });

      const selected = await prompt.run();

      if (selected === '__quit') {
        console.log(`${DIM}Goodbye!${RESET}`);
        break;
      }

      showSessionDetail(selected);

      // After showing details, ask what to do next
      const actionPrompt = new (Enquirer as any).Select({
        name: 'action',
        message: 'What next?',
        choices: [
          { name: 'copy', message: `📋 Copy ID (${selected})` },
          { name: 'back', message: 'Back to list' },
          { name: 'quit', message: 'Quit' },
        ],
      });

      const action = await actionPrompt.run();
      if (action === 'copy') {
        if (copyToClipboard(selected)) {
          console.log(`${GREEN}✓ Copied to clipboard: ${selected}${RESET}`);
        } else {
          console.log(`${YELLOW}Could not copy to clipboard. ID: ${selected}${RESET}`);
        }
        // Stay in the loop to allow further actions
        continue;
      }
      if (action === 'quit') {
        console.log(`${DIM}Goodbye!${RESET}`);
        break;
      }
    } catch (e) {
      // User cancelled (Ctrl+C)
      console.log(`\n${DIM}Cancelled${RESET}`);
      break;
    }
  }
}

async function list() {
  if (type === 'sessions' || type === 's') {
    // Interactive mode
    if (interactive) {
      await interactiveSessionList();
      return;
    }

    console.log('\n📅 Recent Sessions\n');

    const sessions = listSessionsFromDb({ limit: 10 });

    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }

    // Column widths - summary expands to fill terminal
    const fixedCols = { created: 18, duration: 8, commits: 7, sessionId: 15 };
    const fixedWidth = fixedCols.created + fixedCols.duration + fixedCols.commits + fixedCols.sessionId + 14; // +14 for borders/padding
    const termWidth = process.stdout.columns || 120;
    const summaryWidth = Math.max(50, termWidth - fixedWidth - 4); // -4 for final border padding
    const COL = { ...fixedCols, summary: summaryWidth };

    // Build table
    const hLine = (left: string, mid: string, right: string) =>
      `${left}${BOX.horizontal.repeat(COL.created + 2)}${mid}${BOX.horizontal.repeat(COL.duration + 2)}${mid}${BOX.horizontal.repeat(COL.commits + 2)}${mid}${BOX.horizontal.repeat(COL.sessionId + 2)}${mid}${BOX.horizontal.repeat(COL.summary + 2)}${right}`;

    // Header
    console.log(hLine(BOX.topLeft, BOX.topT, BOX.topRight));
    console.log(
      `${BOX.vertical} ${BOLD}${WHITE}${'Created'.padEnd(COL.created)}${RESET} ` +
      `${BOX.vertical} ${BOLD}${WHITE}${'Duration'.padEnd(COL.duration)}${RESET} ` +
      `${BOX.vertical} ${BOLD}${WHITE}${'Commits'.padEnd(COL.commits)}${RESET} ` +
      `${BOX.vertical} ${BOLD}${WHITE}${'Session ID'.padEnd(COL.sessionId)}${RESET} ` +
      `${BOX.vertical} ${BOLD}${WHITE}${'Summary'.padEnd(COL.summary)}${RESET} ${BOX.vertical}`
    );
    console.log(hLine(BOX.leftT, BOX.cross, BOX.rightT));

    for (const s of sessions) {
      const durationMins = s.duration_mins || 0;
      const duration = durationMins ? `${durationMins} mins` : '-';
      const durationColor = durationMins > 30 ? YELLOW : '';
      const commits = (s.commits_count || 0).toString();
      const created = toLocalTime(s.created_at);
      const sessionId = s.id.replace('session_', '').substring(0, COL.sessionId);
      const summary = s.summary || '';

      console.log(
        `${BOX.vertical} ${created.padEnd(COL.created)} ` +
        `${BOX.vertical} ${durationColor}${duration.padEnd(COL.duration)}${durationColor ? RESET : ''} ` +
        `${BOX.vertical} ${commits.padEnd(COL.commits)} ` +
        `${BOX.vertical} ${CYAN}${sessionId.padEnd(COL.sessionId)}${RESET} ` +
        `${BOX.vertical} ${summary.substring(0, COL.summary).padEnd(COL.summary)} ${BOX.vertical}`
      );

      // Show tags and tasks on separate lines if present
      const extras: string[] = [];
      if (s.tags && s.tags.length > 0) {
        extras.push(`${GREEN}Tags:${RESET} ${s.tags.join(', ')}`);
      }
      const taskStats = getSessionTaskStats(s.id);
      const totalTasks = taskStats.done + taskStats.pending + taskStats.blocked + taskStats.in_progress;
      if (totalTasks > 0) {
        const parts: string[] = [];
        if (taskStats.done > 0) parts.push(`${GREEN}${taskStats.done} done${RESET}`);
        if (taskStats.pending > 0) parts.push(`${YELLOW}${taskStats.pending} pending${RESET}`);
        if (taskStats.blocked > 0) parts.push(`${taskStats.blocked} blocked`);
        if (taskStats.in_progress > 0) parts.push(`${CYAN}${taskStats.in_progress} in progress${RESET}`);
        extras.push(`Tasks: ${parts.join(', ')}`);
      }
      if (extras.length > 0) {
        const extraPad = COL.created + COL.duration + COL.commits + COL.sessionId + 12;
        const totalWidth = fixedWidth + COL.summary + 2;
        console.log(`${BOX.vertical} ${DIM}${''.padEnd(extraPad)}${extras.join(' │ ')}${RESET}`.padEnd(totalWidth) + ` ${BOX.vertical}`);
      }
    }

    console.log(hLine(BOX.bottomLeft, BOX.bottomT, BOX.bottomRight));
    console.log(`\n${DIM}Total: ${sessions.length} sessions${RESET}\n`);

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
      byCategory[l.category]!.push(l);
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
    console.log('Usage: bun scripts/memory/list.ts [sessions|learnings] [-i|--interactive]');
    console.log('  Aliases: s = sessions, l = learnings');
    console.log('  Flags:   -i, --interactive  Browse sessions interactively');
  }
}

list().catch(console.error);
