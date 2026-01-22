#!/usr/bin/env bun
/**
 * Fast inbox check for Claude Code hooks
 * Queries matrix_messages table for new incoming messages
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

interface MatrixMessage {
  id: number;
  from_matrix: string;
  content: string;
  message_type: string;
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

function formatFrom(from: string): string {
  return from.split('/').pop() || from;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '...';
}

function main() {
  const lastSeen = getLastSeenId();

  // Query new INCOMING messages from matrix_messages table
  // Incoming = status 'delivered' and NOT from this matrix
  const rows = db.query(`
    SELECT id, from_matrix, content, message_type, created_at
    FROM matrix_messages
    WHERE id > ?
      AND from_matrix != ?
      AND status = 'delivered'
    ORDER BY id ASC
    LIMIT 5
  `).all(lastSeen, THIS_MATRIX) as MatrixMessage[];

  if (rows.length === 0) {
    // No new messages - silent exit (no JSON needed)
    process.exit(0);
  }

  // Build message context for Claude
  const messages: string[] = [];
  let maxId = lastSeen;

  for (const msg of rows) {
    const icon = msg.message_type === 'direct' ? '✉️' : '📢';
    const from = formatFrom(msg.from_matrix);
    const content = truncate(msg.content.replace(/\n/g, ' '), 100);
    messages.push(`${icon} [${from}] ${content}`);
    if (msg.id > maxId) maxId = msg.id;
  }

  // Update last seen
  saveLastSeenId(maxId);

  // Show clean summary to user on stderr (visible)
  console.error(`📬 ${rows.length} new matrix message(s)`);

  // Output hook JSON - additionalContext goes to Claude with FULL content
  const fullMessages = rows.map(msg => {
    const icon = msg.message_type === 'direct' ? '✉️' : '📢';
    const from = formatFrom(msg.from_matrix);
    return `${icon} [${from}] ${msg.content}`;
  });

  const hookOutput = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `📬 ${rows.length} new matrix message(s):\n${fullMessages.join('\n\n')}\n\nRespond to these if relevant, or acknowledge receipt.`
    }
  };

  console.log(JSON.stringify(hookOutput));
}

main();
