#!/usr/bin/env bun
/**
 * /memory-status - Show matrix communication status at a glance
 */

import { db } from '../../src/db';
import { execSync } from 'child_process';
import { basename } from 'path';

function getMatrixId(): string {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    return basename(gitRoot);
  } catch {
    return basename(process.cwd());
  }
}

interface HubHealth {
  status: string;
  connectedMatrices: number;
  online: string[];
}

interface DaemonStatus {
  connected: boolean;
  matrix_id: string;
  hub_url: string;
  queued: number;
  inbox: number;
}

interface IndexerStatus {
  status: string;
  watcherActive: boolean;
  stats: {
    indexedFiles: number;
    totalDocuments?: number;
  };
  vectorStats?: {
    totalDocuments: number;
  };
}

async function checkHub(port: string): Promise<HubHealth | null> {
  try {
    const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      return await response.json() as HubHealth;
    }
  } catch {
    // Hub not running
  }
  return null;
}

async function checkDaemon(port: string): Promise<DaemonStatus | null> {
  try {
    const response = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      return await response.json() as DaemonStatus;
    }
  } catch {
    // Daemon not running
  }
  return null;
}

async function checkIndexer(port: string): Promise<IndexerStatus | null> {
  try {
    const response = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      return await response.json() as IndexerStatus;
    }
  } catch {
    // Indexer daemon not running
  }
  return null;
}

function getUnreadCount(): number {
  const matrixPath = process.cwd();
  const rows = db.query(`
    SELECT COUNT(*) as count
    FROM learnings
    WHERE category = 'insight'
      AND (title LIKE '[msg:broadcast]%' OR title LIKE '%[to:${matrixPath}]%')
      AND created_at > datetime('now', '-1 hour')
  `).get() as { count: number };
  return rows.count;
}

async function main() {
  const hubPort = process.env.MATRIX_HUB_PORT || '8081';
  const daemonPort = process.env.MATRIX_DAEMON_PORT || '37888';
  const indexerPort = process.env.INDEXER_DAEMON_PORT || '37889';
  const matrixId = getMatrixId();

  console.log('\n📊 System Status\n');
  console.log('─'.repeat(40));

  // Check hub
  const hub = await checkHub(hubPort);
  if (hub) {
    console.log(`  Hub:     ✅ Running (localhost:${hubPort})`);
  } else {
    console.log(`  Hub:     ❌ Not running`);
    console.log(`           Start: bun run src/matrix-hub.ts`);
  }

  // Check daemon
  const daemon = await checkDaemon(daemonPort);
  if (daemon) {
    const connStatus = daemon.connected ? '✅ Connected' : '⚠️  Disconnected';
    console.log(`  Daemon:  ${connStatus}`);
  } else {
    console.log(`  Daemon:  ❌ Not running`);
    console.log(`           Start: bun run src/matrix-daemon.ts start`);
  }

  // Check indexer daemon
  const indexer = await checkIndexer(indexerPort);
  if (indexer) {
    const watcherStatus = indexer.watcherActive ? '✅ Watching' : '⚠️  Idle';
    const docCount = indexer.vectorStats?.totalDocuments || indexer.stats?.indexedFiles || 0;
    console.log(`  Indexer: ${watcherStatus} (${docCount} docs)`);
  } else {
    console.log(`  Indexer: ❌ Not running`);
    console.log(`           Start: bun memory indexer start`);
  }

  // Matrix info
  console.log(`  Matrix:  ${matrixId}`);

  // Inbox
  const unread = getUnreadCount();
  console.log(`  Inbox:   ${unread} unread (last hour)`);

  console.log('─'.repeat(40));

  // Online matrices (deduplicated by short name)
  if (hub && hub.online.length > 0) {
    const seen = new Set<string>();
    const unique: { short: string; isSelf: boolean }[] = [];
    for (const m of hub.online) {
      const short = m.split('/').slice(-1)[0];
      if (!seen.has(short)) {
        seen.add(short);
        unique.push({ short, isSelf: short === matrixId || m.includes(matrixId) });
      }
    }
    console.log(`\n  Online matrices: ${unique.length}`);
    for (const { short, isSelf } of unique) {
      console.log(`    - ${short}${isSelf ? ' (you)' : ''}`);
    }
  }

  // Quick start hint if nothing running
  if (!hub && !daemon) {
    console.log(`\n  💡 Quick start: bun memory init`);
  }
  if (!indexer) {
    console.log(`  💡 For code search: bun memory indexer start --initial`);
  }

  console.log();
}

main().catch(console.error);
