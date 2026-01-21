#!/usr/bin/env bun
/**
 * /memory-message - Cross-matrix communication
 *
 * Usage:
 *   bun memory message "Hello all"                    # Broadcast to all
 *   bun memory message "Hello" --to /path/to/clone   # Direct to specific matrix
 *   bun memory message --inbox                        # Check messages for this matrix
 *
 * Phase 3: Now supports WebSocket real-time delivery via matrix hub
 */

import { createLearning, db, getInboxMessages, getUnreadCount as dbGetUnreadCount, type MatrixMessageRecord } from '../../src/db';
import { connectToHub, sendMessage as sendViaHub, sendDirect, broadcast, isConnected, disconnect, waitForFlush } from '../../src/matrix-client';
import { execSync } from 'child_process';
import { basename, join } from 'path';
import { existsSync, readFileSync } from 'fs';

// Load .matrix.json config if it exists
function loadMatrixConfig(): Record<string, any> {
  const configPath = join(process.cwd(), '.matrix.json');
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

const matrixConfig = loadMatrixConfig();

function getMatrixId(): string {
  if (matrixConfig.matrix_id) return matrixConfig.matrix_id;
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    return basename(gitRoot);
  } catch {
    return basename(process.cwd());
  }
}

const THIS_MATRIX = getMatrixId();
const THIS_MATRIX_PATH = process.cwd();

function formatLocalTime(utcString: string): string {
  // SQLite stores UTC without 'Z' suffix - add it for proper parsing
  const isoString = utcString.includes('Z') || utcString.includes('+') ? utcString : utcString.replace(' ', 'T') + 'Z';
  const date = new Date(isoString);
  return date.toLocaleString('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

interface MessageRecord {
  id: number;
  title: string;
  context: string;
  lesson: string;
  created_at: string;
}

function parseMessage(title: string): { type: 'broadcast' | 'direct'; from: string; to?: string; content: string } | null {
  // Format: [msg:broadcast|direct] [from:path] [to:path]? content
  const broadcastMatch = title.match(/^\[msg:broadcast\] \[from:([^\]]+)\] (.+)$/);
  if (broadcastMatch) {
    return { type: 'broadcast', from: broadcastMatch[1]!, content: broadcastMatch[2]! };
  }

  const directMatch = title.match(/^\[msg:direct\] \[from:([^\]]+)\] \[to:([^\]]+)\] (.+)$/);
  if (directMatch) {
    return { type: 'direct', from: directMatch[1]!, to: directMatch[2]!, content: directMatch[3]! };
  }

  return null;
}

function getInbox(): MatrixMessageRecord[] {
  // Get messages from the new matrix_messages table
  return getInboxMessages(THIS_MATRIX, 50);
}

function getUnreadCount(): number {
  // Use the db function to get actual unread count
  return dbGetUnreadCount(THIS_MATRIX);
}

function printHelp() {
  console.log(`
📡 Memory Message - Cross-Matrix Communication

Usage:
  bun memory message "Hello all"                     # Broadcast to all matrices
  bun memory message "Hello" --to /path/to/clone    # Direct message to specific matrix
  bun memory message --inbox                         # Check your inbox
  bun memory message --unread                        # Count unread (last hour)

This Matrix: ${THIS_MATRIX}

Examples:
  bun memory message "Index rebuilt, ready for testing"
  bun memory message "Can you test the new feature?" --to /Users/dev/clone-project
  bun memory message --inbox
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  // Check inbox
  if (args[0] === '--inbox' || args[0] === '-i') {
    const messages = getInbox();
    if (messages.length === 0) {
      console.log('\n📭 Inbox empty\n');
      return;
    }
    console.log(`\n📬 Inbox (${messages.length} messages)\n`);
    console.log('─'.repeat(80));
    for (const msg of messages) {
      const icon = msg.message_type === 'broadcast' ? '📢' : '✉️';
      const unread = msg.read_at ? '' : ' [NEW]';
      console.log(`  ${icon} #${msg.id}${unread} [${msg.from_matrix}] ${formatLocalTime(msg.created_at)}`);
      console.log(`     ${msg.content}`);
      console.log('');
    }
    return;
  }

  // Check unread count
  if (args[0] === '--unread' || args[0] === '-u') {
    const count = getUnreadCount();
    console.log(`\n📬 ${count} message(s) in last hour\n`);
    return;
  }

  // Parse message args
  let content = '';
  let to: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '--to' || arg === '-t') {
      if (next) {
        to = next;
        i++;
      }
    } else if (!content && !arg.startsWith('-')) {
      content = arg;
    }
  }

  if (!content) {
    console.error('❌ Message content required\n');
    printHelp();
    process.exit(1);
  }

  // Build message title (use full path for routing)
  const type = to ? 'direct' : 'broadcast';
  let title: string;
  if (to) {
    title = `[msg:direct] [from:${THIS_MATRIX_PATH}] [to:${to}] ${content}`;
  } else {
    title = `[msg:broadcast] [from:${THIS_MATRIX_PATH}] ${content}`;
  }

  // Try delivery: Daemon first → Direct hub fallback → SQLite persistence
  let delivered = false;
  const daemonPort = process.env.MATRIX_DAEMON_PORT || matrixConfig.daemon_port || '37888';
  const hubUrl = process.env.MATRIX_HUB_URL || matrixConfig.hub_url || 'ws://localhost:8081';

  // Try 1: Daemon API (persistent connection)
  let daemonAvailable = false;
  try {
    const endpoint = to ? '/send' : '/broadcast';
    const body = to ? { content, to } : { content };
    const response = await fetch(`http://localhost:${daemonPort}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      daemonAvailable = true;
      const result = await response.json() as { sent: boolean; queued: boolean };
      delivered = result.sent;
      if (result.queued) {
        console.log('  📤 Queued in daemon (hub reconnecting...)');
      }
    }
  } catch {
    // Daemon not running
  }

  // Try 2: Direct hub connection (only if daemon is NOT available)
  // Skip this if daemon is running - it will queue and handle delivery
  // Direct connection kicks daemon off the hub, breaking SSE watch
  if (!delivered && !daemonAvailable) {
    try {
      const connected = await connectToHub(hubUrl);
      if (connected) {
        if (to) {
          delivered = sendDirect(to, content);
        } else {
          delivered = broadcast(content);
        }
        await waitForFlush(); // Wait for message to actually transmit
        disconnect();
      }
    } catch {
      // Hub not available
    }
  }

  // Show helpful message if no real-time delivery
  if (!delivered && !daemonAvailable) {
    console.log('  ⚠️  No real-time delivery. Start with: bun memory init');
  }

  // Always persist to SQLite (source of truth + fallback)
  const msgId = createLearning({
    category: 'insight',
    title,
    confidence: 'low',
    agent_id: null,
    visibility: 'public',
  });

  const icon = type === 'broadcast' ? '📢' : '✉️';
  console.log(`\n${icon} Message #${msgId} sent\n`);
  console.log(`  Type: ${type}`);
  console.log(`  From: ${THIS_MATRIX}`);
  if (to) console.log(`  To:   ${to}`);
  console.log(`  Content: ${content}`);
  if (delivered) {
    console.log(`  ✨ Delivered in real-time via hub`);
  } else {
    console.log(`  📦 Saved to SQLite (recipient will see on next poll)`);
  }
  console.log();
}

main().catch(console.error);
