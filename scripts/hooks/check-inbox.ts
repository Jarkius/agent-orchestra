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
const DEFAULT_LIMIT = 5;

// Get limit from environment, .matrix.json config, or default
function getMessageLimit(): number {
  // Check environment variable first
  const envLimit = process.env.MATRIX_HOOK_LIMIT;
  if (envLimit) {
    const parsed = parseInt(envLimit, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // Check .matrix.json config
  try {
    if (existsSync('.matrix.json')) {
      const config = JSON.parse(readFileSync('.matrix.json', 'utf8'));
      if (config.hook_limit && typeof config.hook_limit === 'number' && config.hook_limit > 0) {
        return config.hook_limit;
      }
    }
  } catch {}

  return DEFAULT_LIMIT;
}

function getMatrixId(): string {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    return basename(gitRoot);
  } catch {
    return basename(process.cwd());
  }
}

const THIS_MATRIX = getMatrixId();
const MESSAGE_LIMIT = getMessageLimit();

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

function markMessagesAsRead(messageIds: number[]): void {
  if (messageIds.length === 0) return;
  try {
    const placeholders = messageIds.map(() => '?').join(',');
    db.run(`
      UPDATE matrix_messages
      SET read_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
    `, messageIds);
  } catch {}
}

function main() {
  const lastSeen = getLastSeenId();

  // First, count total unread messages to show pagination hint
  const countResult = db.query(`
    SELECT COUNT(*) as total
    FROM matrix_messages
    WHERE id > ?
      AND from_matrix != ?
      AND status = 'delivered'
  `).get(lastSeen, THIS_MATRIX) as { total: number };

  const totalUnread = countResult?.total || 0;

  if (totalUnread === 0) {
    // No new messages - silent exit (no JSON needed)
    process.exit(0);
  }

  // Query new INCOMING messages with configurable limit
  // Order by (from_matrix, sequence_number) to preserve send order per matrix
  const rows = db.query(`
    SELECT id, from_matrix, content, message_type, created_at
    FROM matrix_messages
    WHERE id > ?
      AND from_matrix != ?
      AND status = 'delivered'
    ORDER BY from_matrix ASC, sequence_number ASC, id ASC
    LIMIT ?
  `).all(lastSeen, THIS_MATRIX, MESSAGE_LIMIT) as MatrixMessage[];

  // Build message context for Claude
  const messages: string[] = [];
  let maxId = lastSeen;
  const messageIds: number[] = [];

  for (const msg of rows) {
    const icon = msg.message_type === 'direct' ? '✉️' : '📢';
    const from = formatFrom(msg.from_matrix);
    const content = truncate(msg.content.replace(/\n/g, ' '), 100);
    messages.push(`${icon} [${from}] ${content}`);
    if (msg.id > maxId) maxId = msg.id;
    messageIds.push(msg.id);
  }

  // Update last seen
  saveLastSeenId(maxId);

  // Mark these messages as read
  markMessagesAsRead(messageIds);

  // Calculate remaining messages
  const remaining = totalUnread - rows.length;
  const paginationHint = remaining > 0
    ? `\n\n... and ${remaining} more message(s). Use \`bun memory message --inbox\` for full list.`
    : '';

  // Show clean summary to user on stderr (visible)
  const summaryText = remaining > 0
    ? `📬 ${rows.length} new matrix message(s) (${remaining} more in queue)`
    : `📬 ${rows.length} new matrix message(s)`;
  console.error(summaryText);

  // Output hook JSON - additionalContext goes to Claude with FULL content
  const fullMessages = rows.map(msg => {
    const icon = msg.message_type === 'direct' ? '✉️' : '📢';
    const from = formatFrom(msg.from_matrix);
    return `${icon} [${from}] ${msg.content}`;
  });

  const hookOutput = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `📬 ${rows.length} new matrix message(s):\n${fullMessages.join('\n\n')}${paginationHint}\n\nRespond to these if relevant, or acknowledge receipt.`
    }
  };

  console.log(JSON.stringify(hookOutput));
}

main();
