#!/usr/bin/env bun
/**
 * Fast inbox check for Claude Code hooks
 * Only shows messages since last check - non-blocking
 */

import { db } from '../../src/db';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, basename } from 'path';
import { execSync } from 'child_process';

const STATE_FILE = '.claude/.inbox-state';

function getMatrixId(): string {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    return basename(gitRoot);
  } catch {
    return basename(process.cwd());
  }
}

const THIS_MATRIX = getMatrixId();
const THIS_MATRIX_PATH = process.cwd();

interface MessageRecord {
  id: number;
  title: string;
  created_at: string;
}

function getLastSeenId(): number {
  try {
    if (existsSync(STATE_FILE)) {
      return parseInt(readFileSync(STATE_FILE, 'utf8').trim(), 10) || 0;
    }
  } catch {}
  return 0;
}

function saveLastSeenId(id: number): void {
  try {
    const dir = dirname(STATE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STATE_FILE, String(id));
  } catch {}
}

function parseMessage(title: string): { type: 'broadcast' | 'direct'; from: string; content: string } | null {
  const broadcastMatch = title.match(/^\[msg:broadcast\] \[from:([^\]]+)\] (.+)$/);
  if (broadcastMatch) {
    return { type: 'broadcast', from: broadcastMatch[1]!, content: broadcastMatch[2]! };
  }
  const directMatch = title.match(/^\[msg:direct\] \[from:([^\]]+)\] \[to:[^\]]+\] (.+)$/);
  if (directMatch) {
    return { type: 'direct', from: directMatch[1]!, content: directMatch[2]! };
  }
  return null;
}

function formatFrom(from: string): string {
  return from.split('/').pop() || from;
}

function main() {
  const lastSeen = getLastSeenId();

  // Query new messages since lastSeen
  const rows = db.query(`
    SELECT id, title, created_at
    FROM learnings
    WHERE category = 'insight'
      AND id > ?
      AND (
        title LIKE '[msg:broadcast]%'
        OR title LIKE '%[to:${THIS_MATRIX_PATH}]%'
        OR title LIKE '%[to:${THIS_MATRIX}]%'
      )
    ORDER BY id ASC
    LIMIT 10
  `).all(lastSeen) as MessageRecord[];

  if (rows.length === 0) {
    // No new messages - silent exit (no JSON needed)
    process.exit(0);
  }

  // Build message context for Claude
  const messages: string[] = [];
  let maxId = lastSeen;

  for (const msg of rows) {
    const parsed = parseMessage(msg.title);
    if (parsed) {
      const icon = parsed.type === 'broadcast' ? '📢' : '✉️';
      const from = formatFrom(parsed.from);
      messages.push(`${icon} [${from}] ${parsed.content}`);
    }
    if (msg.id > maxId) maxId = msg.id;
  }

  // Update last seen
  saveLastSeenId(maxId);

  // Show clean summary to user on stderr (visible)
  const summary = messages.length === 1
    ? `📬 ${messages[0]}`
    : `📬 ${rows.length} messages: ${messages.map(m => m.split('] ')[1]).join(' | ')}`;
  console.error(summary);

  // Output hook JSON - additionalContext goes to Claude
  const hookOutput = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `📬 ${rows.length} new matrix message(s):\n${messages.join('\n')}\n\nRespond to these if relevant, or acknowledge receipt.`
    }
  };

  console.log(JSON.stringify(hookOutput));
}

main();
