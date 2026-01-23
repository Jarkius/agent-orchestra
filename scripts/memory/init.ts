#!/usr/bin/env bun
/**
 * /memory-init - Single command to set up all services
 *
 * 1. Start hub if not running
 * 2. Start daemon if not running
 * 3. Verify connection
 * 4. Start indexer if not running
 * 5. Show status
 */

import { spawn, execSync } from 'child_process';
import { basename, join } from 'path';
import { readFileSync, existsSync } from 'fs';

interface MatrixConfig {
  matrix_id?: string;
  daemon_port?: number;
  hub_url?: string;
}

function loadMatrixConfig(): MatrixConfig {
  const configPath = join(process.cwd(), '.matrix.json');
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function getMatrixId(): string {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    return basename(gitRoot);
  } catch {
    return basename(process.cwd());
  }
}

async function checkHub(port: string): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkDaemon(port: string): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(check: () => Promise<boolean>, maxAttempts = 10, delayMs = 500): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await check()) return true;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

async function checkIndexer(port: string): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const config = loadMatrixConfig();
  const hubPort = process.env.MATRIX_HUB_PORT || '8081';
  const daemonPort = process.env.MATRIX_DAEMON_PORT || config.daemon_port?.toString() || '37888';
  const indexerPort = process.env.INDEXER_DAEMON_PORT || '37889';
  const matrixId = config.matrix_id || getMatrixId();
  const projectRoot = process.cwd();

  console.log('\n🚀 Initializing Matrix Communication\n');

  // Step 1: Check/Start Hub
  process.stdout.write('  1. Hub... ');
  let hubRunning = await checkHub(hubPort);

  if (!hubRunning) {
    // Start hub in background
    const hubScript = join(projectRoot, 'src/matrix-hub.ts');
    const hub = spawn('bun', ['run', hubScript], {
      detached: true,
      stdio: 'ignore',
      cwd: projectRoot,
    });
    hub.unref();

    // Wait for hub to start
    hubRunning = await waitFor(() => checkHub(hubPort), 10, 500);
  }

  if (hubRunning) {
    console.log('✅ Running');
  } else {
    console.log('❌ Failed to start');
    console.log('     Try manually: bun run src/matrix-hub.ts');
    return;
  }

  // Step 2: Check/Start Daemon
  process.stdout.write('  2. Daemon... ');
  let daemonRunning = await checkDaemon(daemonPort);

  if (!daemonRunning) {
    // Start daemon
    const daemonScript = join(projectRoot, 'src/matrix-daemon.ts');
    const daemon = spawn('bun', ['run', daemonScript, 'start'], {
      detached: true,
      stdio: 'ignore',
      cwd: projectRoot,
    });
    daemon.unref();

    // Wait for daemon to start
    daemonRunning = await waitFor(() => checkDaemon(daemonPort), 10, 500);
  }

  if (daemonRunning) {
    console.log('✅ Running');
  } else {
    console.log('❌ Failed to start');
    console.log('     Try manually: bun run src/matrix-daemon.ts start');
    return;
  }

  // Step 3: Verify connection
  process.stdout.write('  3. Connection... ');
  const connected = await waitFor(async () => {
    try {
      const response = await fetch(`http://localhost:${daemonPort}/status`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const status = await response.json() as { connected: boolean };
        return status.connected;
      }
    } catch {}
    return false;
  }, 10, 500);

  if (connected) {
    console.log('✅ Connected');
  } else {
    console.log('⚠️  Not connected to hub');
  }

  // Step 4: Check/Start Indexer
  process.stdout.write('  4. Indexer... ');
  let indexerRunning = await checkIndexer(indexerPort);

  if (!indexerRunning) {
    // Start indexer daemon
    const indexerScript = join(projectRoot, 'src/indexer/indexer-daemon.ts');
    const indexer = spawn('bun', ['run', indexerScript, 'start'], {
      detached: true,
      stdio: 'ignore',
      cwd: projectRoot,
    });
    indexer.unref();

    // Wait for indexer to start
    indexerRunning = await waitFor(() => checkIndexer(indexerPort), 15, 500);
  }

  if (indexerRunning) {
    // Get doc count
    try {
      const response = await fetch(`http://localhost:${indexerPort}/status`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const status = await response.json() as { vectorStats?: { totalDocuments?: number } };
        const docs = status.vectorStats?.totalDocuments || 0;
        console.log(`✅ Running (${docs} docs)`);
      } else {
        console.log('✅ Running');
      }
    } catch {
      console.log('✅ Running');
    }
  } else {
    console.log('⚠️  Not started (optional)');
    console.log('     Start manually: bun memory indexer start --initial');
  }

  // Step 5: Show summary
  console.log('\n────────────────────────────────');
  console.log(`  Matrix:  ${matrixId}`);
  console.log(`  Hub:     localhost:${hubPort}`);
  console.log(`  Daemon:  localhost:${daemonPort}`);
  console.log(`  Indexer: localhost:${indexerPort}`);
  console.log('────────────────────────────────');

  console.log('\n  Ready! Try:');
  console.log('    bun memory message "Hello!"');
  console.log('    bun memory index search "query"');
  console.log('    bun memory status');
  console.log();
}

main().catch(console.error);
