#!/usr/bin/env bun
/**
 * /memory-status - Show matrix communication status at a glance
 */

import { db } from '../../src/db';
import { execSync } from 'child_process';
import { basename, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';

// Load .matrix.json config
function loadMatrixConfig(): Record<string, unknown> {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    const configPath = join(gitRoot, '.matrix.json');
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, 'utf8'));
    }
  } catch {}
  const cwdConfig = join(process.cwd(), '.matrix.json');
  if (existsSync(cwdConfig)) {
    try {
      return JSON.parse(readFileSync(cwdConfig, 'utf8'));
    } catch {}
  }
  return {};
}

// Read actual daemon port from PID file (daemon may use different port if default is busy)
// PID file is per-matrix: daemon-{matrix_id}.pid
function getDaemonPort(): string | null {
  const matrixId = getMatrixId();
  const config = loadMatrixConfig();
  const daemonDir = config.daemon_dir
    ? String(config.daemon_dir).replace('~', homedir())
    : join(homedir(), '.matrix-daemon');
  const pidFile = join(daemonDir, `daemon-${matrixId}.pid`);
  if (existsSync(pidFile)) {
    try {
      const content = readFileSync(pidFile, 'utf-8').trim().split('\n');
      const pid = parseInt(content[0] || '0');
      const port = content[1] || null;
      // Verify process is still running
      if (pid > 0 && port) {
        try {
          process.kill(pid, 0); // Check if process exists
          return port;
        } catch {
          // Process not running
        }
      }
    } catch {
      // Can't read PID file
    }
  }
  return null;
}

// Read actual indexer daemon port from PID file (per-project)
// PID file is per-matrix: daemon-{matrix_id}.pid
function getIndexerPort(): string | null {
  const matrixId = getMatrixId();
  const indexerDir = join(homedir(), '.indexer-daemon');
  const pidFile = join(indexerDir, `daemon-${matrixId}.pid`);
  if (existsSync(pidFile)) {
    try {
      const content = readFileSync(pidFile, 'utf-8').trim().split('\n');
      const pid = parseInt(content[0] || '0');
      const port = content[1] || null;
      // Verify process is still running
      if (pid > 0 && port) {
        try {
          process.kill(pid, 0); // Check if process exists
          return port;
        } catch {
          // Process not running
        }
      }
    } catch {
      // Can't read PID file
    }
  }
  return null;
}

function getMatrixId(): string {
  // Prefer .matrix.json config if it exists
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    const configPath = join(gitRoot, '.matrix.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      if (config.matrix_id) {
        return config.matrix_id;
      }
    }
    // Fall back to folder name
    return basename(gitRoot);
  } catch {
    // Check cwd for .matrix.json
    const cwdConfig = join(process.cwd(), '.matrix.json');
    if (existsSync(cwdConfig)) {
      try {
        const config = JSON.parse(readFileSync(cwdConfig, 'utf8'));
        if (config.matrix_id) {
          return config.matrix_id;
        }
      } catch {
        // Invalid JSON, fall through
      }
    }
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
  // Auth failure tracking
  authFailureCount?: number;
  lastAuthError?: string | null;
  authStopped?: boolean;
  nextRetryIn?: number | null;
}

interface IndexerStatus {
  status: string;
  watcherActive: boolean;
  rootPath?: string;  // What directory the indexer is watching
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
  // Prefer actual daemon port from PID file, fall back to config/env
  const config = loadMatrixConfig();
  const configDaemonPort = config.daemon_port ? String(config.daemon_port) : (process.env.MATRIX_DAEMON_PORT || '37888');
  const daemonPort = getDaemonPort() || configDaemonPort;
  // Prefer actual indexer port from PID file, fall back to env/default
  const indexerPort = getIndexerPort() || process.env.INDEXER_DAEMON_PORT || '37889';
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
    if (daemon.authStopped) {
      // Auth stopped - max failures reached
      console.log(`  Daemon:  ❌ Auth stopped (${daemon.authFailureCount || 0} failures)`);
      console.log(`           ${daemon.lastAuthError || 'PIN authentication failed'}`);
      console.log(`           Fix PIN: bun run src/matrix-daemon.ts start --pin <PIN>`);
    } else if (daemon.authFailureCount && daemon.authFailureCount > 0) {
      // Auth failing but still retrying
      const retryIn = daemon.nextRetryIn ? `${daemon.nextRetryIn}s` : 'soon';
      console.log(`  Daemon:  ⚠️  Auth failed (${daemon.authFailureCount}/5) - wrong PIN?`);
      console.log(`           Next retry in ${retryIn}`);
    } else if (daemon.connected) {
      console.log(`  Daemon:  ✅ Connected`);
    } else {
      console.log(`  Daemon:  ⚠️  Disconnected (reconnecting...)`);
    }
  } else {
    console.log(`  Daemon:  ❌ Not running`);
    console.log(`           Start: bun run src/matrix-daemon.ts start`);
  }

  // Check indexer daemon
  const indexer = await checkIndexer(indexerPort);
  if (indexer) {
    // Check if indexer is watching the CURRENT project
    let gitRoot: string | null = null;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    } catch {}
    const currentRoot = gitRoot || process.cwd();
    const isWrongProject = indexer.rootPath && indexer.rootPath !== currentRoot;

    if (isWrongProject) {
      console.log(`  Indexer: ⚠️  WRONG PROJECT`);
      console.log(`           Watching: ${indexer.rootPath}`);
      console.log(`           Current:  ${currentRoot}`);
      console.log(`           Fix: bun memory indexer stop && bun memory indexer start`);
    } else {
      const watcherStatus = indexer.watcherActive ? '✅ Watching' : '⚠️  Idle';
      const docCount = indexer.vectorStats?.totalDocuments || indexer.stats?.indexedFiles || 0;
      console.log(`  Indexer: ${watcherStatus} (${docCount} docs)`);
    }
  } else {
    console.log(`  Indexer: ❌ Not running`);
    console.log(`           Start: bun memory indexer start`);
  }

  // Check ChromaDB
  const chromaPort = process.env.CHROMA_PORT || '8100';
  let chromaOk = false;
  try {
    const chromaRes = await fetch(`http://localhost:${chromaPort}/api/v2/heartbeat`, { signal: AbortSignal.timeout(2000) });
    chromaOk = chromaRes.ok;
  } catch {}
  if (chromaOk) {
    console.log(`  ChromaDB: ✅ Running (:${chromaPort})`);
  } else {
    console.log(`  ChromaDB: ❌ Not running`);
    console.log(`           Start: docker start chromadb`);
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
