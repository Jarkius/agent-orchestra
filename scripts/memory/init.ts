#!/usr/bin/env bun
/**
 * /memory-init - Single command to set up all services
 *
 * Usage:
 *   bun memory init              # Start all services
 *   bun memory init --pin <PIN>  # Start with specific PIN
 *
 * 1. Start hub if not running (with PIN if provided)
 * 2. Start daemon if not running (with same PIN)
 * 3. Verify connection (prompt for PIN if auth fails)
 * 4. Start indexer if not running
 * 5. Show status
 */

import { spawn, execSync } from 'child_process';
import { basename, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

interface MatrixConfig {
  matrix_id?: string;
  daemon_port?: number;
  hub_url?: string;
  hub_pin?: string;
}

// Parse --pin flag from CLI args
function parseArgs(): { pin: string | null } {
  const args = process.argv.slice(2);
  const pinIdx = args.indexOf('--pin');
  const pin = pinIdx !== -1 && args[pinIdx + 1] ? args[pinIdx + 1] : null;
  return { pin };
}

// Prompt user for PIN interactively
async function promptForPin(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
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

function checkDockerRunning(): boolean {
  try {
    execSync('docker info', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkDockerInstalled(): boolean {
  try {
    execSync('which docker', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const config = loadMatrixConfig();
  const { pin: cliPin } = parseArgs();
  const hubPort = process.env.MATRIX_HUB_PORT || '8081';
  const daemonPort = process.env.MATRIX_DAEMON_PORT || config.daemon_port?.toString() || '37888';
  const indexerPort = process.env.INDEXER_DAEMON_PORT || '37889';
  const matrixId = config.matrix_id || getMatrixId();
  const projectRoot = process.cwd();

  // PIN priority: CLI > env > config
  let pin = cliPin || process.env.MATRIX_HUB_PIN || config.hub_pin || null;

  console.log('\n🚀 Initializing Matrix Communication\n');

  // Pre-flight check: Docker
  process.stdout.write('  0. Docker... ');
  if (!checkDockerInstalled()) {
    console.log('❌ Not installed');
    console.log('     Docker is required for ChromaDB (vector database).');
    console.log('     Install: https://docs.docker.com/get-docker/');
    return;
  }
  if (!checkDockerRunning()) {
    console.log('❌ Not running');
    console.log('     Docker Desktop is installed but not running.');
    console.log('     Please start Docker Desktop and run this command again.');
    return;
  }
  console.log('✅ Running');

  // Step 1: Check/Start Hub
  process.stdout.write('  1. Hub... ');
  let hubRunning = await checkHub(hubPort);

  if (!hubRunning) {
    // Start hub in background with PIN if provided
    const hubScript = join(projectRoot, 'src/matrix-hub.ts');
    const hubEnv = { ...process.env };
    if (pin) {
      hubEnv.MATRIX_HUB_PIN = pin;
    }
    const hub = spawn('bun', ['run', hubScript], {
      detached: true,
      stdio: 'ignore',
      cwd: projectRoot,
      env: hubEnv,
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
    // Start daemon with PIN if provided
    const daemonScript = join(projectRoot, 'src/matrix-daemon.ts');
    const daemonArgs = ['run', daemonScript, 'start'];
    if (pin) {
      daemonArgs.push('--pin', pin);
    }
    const daemon = spawn('bun', daemonArgs, {
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

  interface DaemonStatus {
    connected: boolean;
    authFailureCount?: number;
    authStopped?: boolean;
    lastAuthError?: string;
  }

  let connected = false;
  let authFailed = false;

  // Check connection with auth failure detection
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await fetch(`http://localhost:${daemonPort}/status`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const status = await response.json() as DaemonStatus;
        if (status.connected) {
          connected = true;
          break;
        }
        // Check if auth is failing
        if (status.authFailureCount && status.authFailureCount > 0) {
          authFailed = true;
          break;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  if (connected) {
    console.log('✅ Connected');
  } else if (authFailed) {
    console.log('❌ Auth failed - wrong PIN');
    // Prompt for PIN
    console.log('\n  Hub requires PIN authentication.');
    const newPin = await promptForPin('  Enter hub PIN (shown in hub console): ');
    if (newPin) {
      console.log('  Retrying with new PIN...');
      // Reset daemon auth and retry with new PIN
      try {
        await fetch(`http://localhost:${daemonPort}/auth-reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: newPin }),
          signal: AbortSignal.timeout(5000),
        });
        // Wait for reconnection
        connected = await waitFor(async () => {
          const response = await fetch(`http://localhost:${daemonPort}/status`, { signal: AbortSignal.timeout(2000) });
          if (response.ok) {
            const status = await response.json() as DaemonStatus;
            return status.connected;
          }
          return false;
        }, 10, 500);
        if (connected) {
          console.log('  ✅ Connected with new PIN');
        } else {
          console.log('  ⚠️  Still not connected. Check PIN and try again.');
        }
      } catch {
        console.log('  ⚠️  Failed to reset auth');
      }
    }
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
