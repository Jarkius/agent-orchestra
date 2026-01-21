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

import { createLearning, db } from '../../src/db';
import { connectToHub, sendMessage as sendViaHub, sendDirect, broadcast, isConnected, disconnect } from '../../src/matrix-client';

const THIS_MATRIX = process.cwd();

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

function getInbox(): MessageRecord[] {
  // Get broadcasts + direct messages to this matrix
  const rows = db.query(`
    SELECT id, title, context, lesson, created_at
    FROM learnings
    WHERE category = 'insight'
      AND (
        title LIKE '[msg:broadcast]%'
        OR title LIKE '%[to:${THIS_MATRIX}]%'
      )
    ORDER BY created_at DESC
    LIMIT 20
  `).all() as MessageRecord[];
  return rows;
}

function getUnreadCount(): number {
  // Simple heuristic: messages in last hour
  const rows = db.query(`
    SELECT COUNT(*) as count
    FROM learnings
    WHERE category = 'insight'
      AND (title LIKE '[msg:broadcast]%' OR title LIKE '%[to:${THIS_MATRIX}]%')
      AND created_at > datetime('now', '-1 hour')
  `).get() as { count: number };
  return rows.count;
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
      const parsed = parseMessage(msg.title);
      if (parsed) {
        const icon = parsed.type === 'broadcast' ? '📢' : '✉️';
        const fromShort = parsed.from.split('/').slice(-2).join('/');
        console.log(`  ${icon} #${msg.id} [${fromShort}] ${parsed.content}`);
        if (msg.lesson) console.log(`     ${msg.lesson}`);
        console.log(`     ${msg.created_at}`);
        console.log('');
      }
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

  // Build message title
  const type = to ? 'direct' : 'broadcast';
  let title: string;
  if (to) {
    title = `[msg:direct] [from:${THIS_MATRIX}] [to:${to}] ${content}`;
  } else {
    title = `[msg:broadcast] [from:${THIS_MATRIX}] ${content}`;
  }

  // Try delivery: Daemon first → Direct hub fallback → SQLite persistence
  let delivered = false;
  const daemonPort = process.env.MATRIX_DAEMON_PORT || '37888';
  const hubUrl = process.env.MATRIX_HUB_URL || 'ws://localhost:8081';

  // Try 1: Daemon API (persistent connection)
  try {
    const endpoint = to ? '/send' : '/broadcast';
    const body = to ? { content, to } : { content };
    const response = await fetch(`http://localhost:${daemonPort}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const result = await response.json() as { sent: boolean; queued: boolean };
      delivered = result.sent;
      if (result.queued) {
        console.log('  📤 Queued in daemon (hub reconnecting...)');
      }
    }
  } catch {
    // Daemon not running, try direct connection
  }

  // Try 2: Direct hub connection (creates new connection)
  if (!delivered) {
    try {
      const connected = await connectToHub(hubUrl);
      if (connected) {
        if (to) {
          delivered = sendDirect(to, content);
        } else {
          delivered = broadcast(content);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        disconnect();
      }
    } catch {
      // Hub not available
    }
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
