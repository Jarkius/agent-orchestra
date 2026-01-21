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
    // No new messages - silent exit
    process.exit(0);
  }

  // Show new messages
  console.log(`\n📬 ${rows.length} new message(s):\n`);

  let maxId = lastSeen;
  for (const msg of rows) {
    const parsed = parseMessage(msg.title);
    if (parsed) {
      const icon = parsed.type === 'broadcast' ? '📢' : '✉️';
      const from = formatFrom(parsed.from);
      // Truncate long messages
      const content = parsed.content.length > 80
        ? parsed.content.slice(0, 77) + '...'
        : parsed.content;
      console.log(`  ${icon} [${from}] ${content}`);
    }
    if (msg.id > maxId) maxId = msg.id;
  }

  console.log(`\n  Run 'bun memory message --inbox' for full inbox\n`);

  // Update last seen
  saveLastSeenId(maxId);
}

main();
