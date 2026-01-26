/**
 * Indexer Daemon - Persistent file watcher for code indexing
 *
 * Runs as background process, maintains file watcher for automatic re-indexing.
 * CLI commands communicate with daemon via local HTTP API.
 *
 * Usage:
 *   bun run src/indexer/indexer-daemon.ts start   # Start daemon
 *   bun run src/indexer/indexer-daemon.ts stop    # Stop daemon
 *   bun run src/indexer/indexer-daemon.ts status  # Check status
 */

import { createServer, type Server } from 'http';
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { execSync } from 'child_process';
import { CodeIndexer, getDefaultIndexer } from './code-indexer';

// ============ Configuration ============

const ROOT_PATH = process.env.INDEXER_ROOT_PATH || process.cwd();

// Get matrix ID from config or folder name (same logic as status.ts)
function getMatrixId(): string {
  // Check for .matrix.json in git root or cwd
  const paths = [
    (() => {
      try {
        return join(execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(), '.matrix.json');
      } catch { return null; }
    })(),
    join(ROOT_PATH, '.matrix.json'),
    join(process.cwd(), '.matrix.json'),
  ].filter(Boolean) as string[];

  for (const configPath of paths) {
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        if (config.matrix_id) return config.matrix_id;
      } catch {}
    }
  }

  // Fall back to folder name
  try {
    return basename(execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim());
  } catch {
    return basename(ROOT_PATH);
  }
}

const MATRIX_ID = getMatrixId();

// Per-project port: hash matrix_id to get unique port in range 37890-38890
function getDefaultPort(): number {
  let hash = 0;
  for (let i = 0; i < MATRIX_ID.length; i++) {
    hash = ((hash << 5) - hash) + MATRIX_ID.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return 37890 + Math.abs(hash % 1000);
}

const DAEMON_PORT = parseInt(process.env.INDEXER_DAEMON_PORT || String(getDefaultPort()));

// Use home directory for persistence across reboots
const DEFAULT_DAEMON_DIR = join(process.env.HOME || '/tmp', '.indexer-daemon');
const DAEMON_DIR = process.env.INDEXER_DAEMON_DIR || DEFAULT_DAEMON_DIR;
// Per-project PID file (like matrix daemon)
const PID_FILE = join(DAEMON_DIR, `daemon-${MATRIX_ID}.pid`);

// ============ State ============

let indexer: CodeIndexer | null = null;
let httpServer: Server | null = null;
let startTime: Date | null = null;
let lastActivity: Date | null = null;
let filesIndexed = 0;
let filesWatched = 0;

// ============ Indexer Management ============

async function initializeIndexer(): Promise<void> {
  indexer = getDefaultIndexer(ROOT_PATH);
  await indexer.init();
}

async function startWatcher(withInitialIndex: boolean = false): Promise<void> {
  if (!indexer) {
    await initializeIndexer();
  }

  if (withInitialIndex) {
    console.log('[IndexerDaemon] Running initial index...');
    const stats = await indexer!.indexAll({
      onProgress: (current, total) => {
        process.stdout.write(`\r[IndexerDaemon] Indexing: ${current}/${total}`);
      },
    });
    filesIndexed = stats.indexedFiles;
    console.log(`\n[IndexerDaemon] Initial index complete: ${stats.indexedFiles} files`);
  }

  await indexer!.startWatcher();
  console.log('[IndexerDaemon] File watcher started');
}

async function stopWatcher(): Promise<void> {
  if (indexer) {
    await indexer.stopWatcher();
    console.log('[IndexerDaemon] File watcher stopped');
  }
}

// ============ HTTP API Server ============

function startHttpServer(): void {
  httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${DAEMON_PORT}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    // Health check / Status
    if (url.pathname === '/health' || url.pathname === '/status') {
      const stats = indexer?.getStats();
      const vectorStats = indexer ? await indexer.getVectorStats() : null;

      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'running',
        rootPath: ROOT_PATH,
        watcherActive: stats?.watcherActive ?? false,
        startTime: startTime?.toISOString(),
        lastActivity: lastActivity?.toISOString(),
        uptime: startTime ? Math.floor((Date.now() - startTime.getTime()) / 1000) : 0,
        stats: {
          totalFiles: stats?.totalFiles ?? 0,
          indexedFiles: stats?.indexedFiles ?? 0,
          skippedFiles: stats?.skippedFiles ?? 0,
          errors: stats?.errors ?? 0,
          lastIndexedAt: stats?.lastIndexedAt?.toISOString(),
        },
        vectorStats: vectorStats ? {
          totalDocuments: vectorStats.totalDocuments,
          languages: vectorStats.languages,
        } : null,
      }));
      return;
    }

    // Trigger re-index
    if (url.pathname === '/reindex' && req.method === 'POST') {
      const force = url.searchParams.get('force') === 'true';

      res.writeHead(202);
      res.end(JSON.stringify({ status: 'indexing', force }));

      // Run index in background
      if (indexer) {
        const stats = await indexer.indexAll({ force });
        filesIndexed = stats.indexedFiles;
        lastActivity = new Date();
      }
      return;
    }

    // Search (for testing/debugging)
    if (url.pathname === '/search' && req.method === 'GET') {
      const query = url.searchParams.get('q');
      const lang = url.searchParams.get('lang') || undefined;
      const limit = parseInt(url.searchParams.get('limit') || '10');

      if (!query) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing query parameter "q"' }));
        return;
      }

      if (indexer) {
        const results = await indexer.search(query, { language: lang, limit });
        res.writeHead(200);
        res.end(JSON.stringify({
          query,
          results: results.map(r => ({
            file: r.file_path,
            language: r.language,
            relevance: Math.round(r.relevance * 100),
            preview: r.content.slice(0, 200),
          })),
        }));
      } else {
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'Indexer not initialized' }));
      }
      return;
    }

    // Stop daemon
    if (url.pathname === '/stop' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'stopping' }));
      shutdown();
      return;
    }

    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(DAEMON_PORT, () => {
    console.log(`[IndexerDaemon] HTTP API listening on port ${DAEMON_PORT}`);
  });
}

// ============ Daemon Lifecycle ============

function writePidFile(): void {
  const pidDir = dirname(PID_FILE);
  if (!existsSync(pidDir)) {
    mkdirSync(pidDir, { recursive: true });
  }
  writeFileSync(PID_FILE, `${process.pid}\n${DAEMON_PORT}\n${ROOT_PATH}`);
}

function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {}
}

function isRunning(): { running: boolean; pid?: number; port?: number; rootPath?: string } {
  if (!existsSync(PID_FILE)) {
    return { running: false };
  }

  try {
    const content = readFileSync(PID_FILE, 'utf-8').trim().split('\n');
    const pid = parseInt(content[0] || '0');
    const port = parseInt(content[1] || '0');
    const rootPath = content[2] || '';

    // Check if process is running
    try {
      process.kill(pid, 0);
      return { running: true, pid, port, rootPath };
    } catch {
      // Process not running, clean up stale PID file
      removePidFile();
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

async function checkPortInUse(port: number): Promise<{ inUse: boolean; byOther: boolean }> {
  try {
    const response = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(2000)
    });
    if (response.ok) {
      const data = await response.json() as { rootPath?: string };
      // Port is in use - check if by another indexer
      const isOther = data.rootPath !== ROOT_PATH;
      return { inUse: true, byOther: isOther };
    }
    return { inUse: false, byOther: false };
  } catch {
    return { inUse: false, byOther: false };
  }
}

async function start(): Promise<void> {
  const status = isRunning();
  if (status.running) {
    console.log(`[IndexerDaemon] Already running (PID: ${status.pid}, Port: ${status.port})`);
    process.exit(0);
  }

  // Check if port is already in use by another daemon
  const portCheck = await checkPortInUse(DAEMON_PORT);
  if (portCheck.inUse) {
    if (portCheck.byOther) {
      console.error(`[IndexerDaemon] Port ${DAEMON_PORT} already in use by ANOTHER indexer daemon!`);
      console.error(`[IndexerDaemon]    Use a different port via INDEXER_DAEMON_PORT.`);
      process.exit(1);
    } else {
      console.log(`[IndexerDaemon] Port ${DAEMON_PORT} has an orphan daemon. Attempting takeover...`);
      try {
        await fetch(`http://localhost:${DAEMON_PORT}/stop`, { method: 'POST' });
        await new Promise(r => setTimeout(r, 1000));
      } catch {
        // Ignore - might already be dead
      }
    }
  }

  console.log(`[IndexerDaemon] Starting indexer daemon`);
  console.log(`[IndexerDaemon] Matrix ID: ${MATRIX_ID}`);
  console.log(`[IndexerDaemon] PID: ${process.pid}`);
  console.log(`[IndexerDaemon] API Port: ${DAEMON_PORT}`);
  console.log(`[IndexerDaemon] Root Path: ${ROOT_PATH}`);

  startTime = new Date();
  writePidFile();
  startHttpServer();

  // Check for --initial flag
  const withInitial = process.argv.includes('--initial');
  await startWatcher(withInitial);

  // Handle shutdown signals
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function shutdown(): void {
  console.log('[IndexerDaemon] Shutting down...');

  stopWatcher();

  if (httpServer) {
    httpServer.close();
  }

  removePidFile();
  process.exit(0);
}

async function stop(): Promise<void> {
  const status = isRunning();
  if (!status.running) {
    console.log('[IndexerDaemon] Not running');
    process.exit(0);
  }

  try {
    // Try graceful shutdown via API
    const response = await fetch(`http://localhost:${status.port}/stop`, { method: 'POST' });
    if (response.ok) {
      console.log('[IndexerDaemon] Stopped gracefully');
    }
  } catch {
    // Force kill
    try {
      process.kill(status.pid!, 'SIGTERM');
      console.log(`[IndexerDaemon] Sent SIGTERM to PID ${status.pid}`);
    } catch (e) {
      console.error('[IndexerDaemon] Failed to stop:', e);
    }
  }

  removePidFile();
}

async function showStatus(): Promise<void> {
  const status = isRunning();
  if (!status.running) {
    console.log('[IndexerDaemon] Status: Not running');
    process.exit(1);
  }

  try {
    const response = await fetch(`http://localhost:${status.port}/status`);
    const data = await response.json() as {
      status: string;
      rootPath: string;
      watcherActive: boolean;
      uptime: number;
      stats: {
        totalFiles: number;
        indexedFiles: number;
        skippedFiles: number;
        errors: number;
        lastIndexedAt?: string;
      };
      vectorStats?: {
        totalDocuments: number;
        languages: Record<string, number>;
      };
    };

    const watcherStatus = data.watcherActive ? 'Active' : 'Inactive';
    const uptimeMin = Math.floor(data.uptime / 60);
    const uptimeSec = data.uptime % 60;

    console.log(`[IndexerDaemon] Status: Running`);
    console.log(`  Matrix: ${MATRIX_ID}`);
    console.log(`  PID: ${status.pid}`);
    console.log(`  Port: ${status.port}`);
    console.log(`  Root: ${data.rootPath}`);
    console.log(`  Watcher: ${watcherStatus}`);
    console.log(`  Uptime: ${uptimeMin}m ${uptimeSec}s`);
    console.log('');
    console.log(`  Index Stats:`);
    console.log(`    Files indexed: ${data.stats.indexedFiles}`);
    console.log(`    Files skipped: ${data.stats.skippedFiles}`);
    console.log(`    Errors: ${data.stats.errors}`);
    if (data.stats.lastIndexedAt) {
      console.log(`    Last indexed: ${data.stats.lastIndexedAt}`);
    }

    if (data.vectorStats) {
      console.log('');
      console.log(`  Vector Stats:`);
      console.log(`    Total documents: ${data.vectorStats.totalDocuments}`);
      const langs = Object.entries(data.vectorStats.languages)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);
      if (langs.length > 0) {
        console.log(`    Top languages: ${langs.map(([l, c]) => `${l}(${c})`).join(', ')}`);
      }
    }
  } catch {
    console.log(`[IndexerDaemon] Status: Process exists but API not responding`);
    console.log(`  PID: ${status.pid}`);
    console.log(`  Port: ${status.port}`);
    console.log(`\n  Daemon may be zombie. Try: bun run src/indexer/indexer-daemon.ts restart`);
  }
}

// ============ CLI Entry Point ============

const command = process.argv[2];

switch (command) {
  case 'start':
    start();
    break;
  case 'stop':
    stop();
    break;
  case 'status':
    showStatus();
    break;
  case 'restart':
    stop().then(() => setTimeout(start, 1000));
    break;
  default:
    console.log(`
Indexer Daemon - Automatic code index updates

Usage:
  bun run src/indexer/indexer-daemon.ts start [--initial]  Start daemon
  bun run src/indexer/indexer-daemon.ts stop               Stop daemon
  bun run src/indexer/indexer-daemon.ts status             Check status
  bun run src/indexer/indexer-daemon.ts restart            Restart daemon

Options:
  --initial           Run full index before starting watcher

Environment:
  INDEXER_DAEMON_PORT  Local API port (default: 37889)
  INDEXER_ROOT_PATH    Root path to watch (default: current directory)

Example:
  bun run src/indexer/indexer-daemon.ts start --initial
`);
}
