#!/usr/bin/env bun
/**
 * Postinstall hook - runs after `bun install`
 *
 * Detects fresh clone and runs essential setup:
 * 1. Initialize SQLite database
 * 2. Start ChromaDB (if Docker available)
 * 3. Create .matrix.json with unique daemon port
 * 4. Show next steps
 */

import { existsSync, writeFileSync, readFileSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join, basename } from 'path';
import { createHash } from 'crypto';

const ROOT = process.cwd();
const DB_PATH = join(ROOT, 'agents.db');
const MATRIX_CONFIG = join(ROOT, '.matrix.json');
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

// Colors
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RED = '\x1b[31m';
const NC = '\x1b[0m';

function log(msg: string) {
  console.log(`${BLUE}[postinstall]${NC} ${msg}`);
}

function success(msg: string) {
  console.log(`${GREEN}✓${NC} ${msg}`);
}

function warn(msg: string) {
  console.log(`${YELLOW}⚠${NC} ${msg}`);
}

function error(msg: string) {
  console.log(`${RED}✗${NC} ${msg}`);
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function dockerRunning(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a unique daemon port based on project path
 * Range: 37900-38899 (1000 ports)
 */
function generateDaemonPort(projectPath: string): number {
  const hash = createHash('md5').update(projectPath).digest('hex');
  const portOffset = parseInt(hash.slice(0, 4), 16) % 1000;
  return 37900 + portOffset;
}

/**
 * Get matrix ID from folder name
 */
function getMatrixId(): string {
  return basename(ROOT);
}

async function main() {
  console.log('');
  log('Running postinstall checks...');
  console.log('');

  // Skip in CI environments
  if (IS_CI) {
    warn('CI environment detected - skipping interactive setup');
    warn('Run ./scripts/setup.sh manually after clone');
    return;
  }

  const isFreshClone = !existsSync(DB_PATH);
  const hasMatrixConfig = existsSync(MATRIX_CONFIG);

  if (!isFreshClone && hasMatrixConfig) {
    success('Existing installation detected');
    log('Run `bun memory status` to check health');
    return;
  }

  console.log('');
  log('Fresh clone detected - running setup...');
  console.log('');

  // Step 1: Create .matrix.json with unique port
  const matrixId = getMatrixId();
  const daemonPort = generateDaemonPort(ROOT);

  if (!hasMatrixConfig) {
    log('Creating .matrix.json with unique daemon port...');
    const config = {
      matrix_id: matrixId,
      daemon_port: daemonPort,
      hub_url: 'ws://localhost:8081',
      // hub_pin will be added when user runs `bun memory init` with --pin
    };
    writeFileSync(MATRIX_CONFIG, JSON.stringify(config, null, 2) + '\n');
    success(`Matrix config created: ${matrixId} on port ${daemonPort}`);
  } else {
    // Read existing config
    try {
      const existing = JSON.parse(readFileSync(MATRIX_CONFIG, 'utf-8'));
      success(`Matrix config exists: ${existing.matrix_id} on port ${existing.daemon_port}`);
    } catch {
      warn('Could not read existing .matrix.json');
    }
  }

  // Step 2: Initialize SQLite database
  if (!existsSync(DB_PATH)) {
    log('Initializing SQLite database...');
    try {
      // Import db module to trigger table creation
      await import('../src/db/index.ts');
      success('SQLite database initialized');
    } catch (e) {
      error(`Database init failed: ${e}`);
    }
  }

  // Step 3: Check Docker and start ChromaDB
  if (commandExists('docker') && dockerRunning()) {
    log('Starting ChromaDB container...');
    try {
      // Check if container exists
      const result = spawnSync('docker', ['ps', '-a', '--filter', 'name=chromadb', '--format', '{{.Names}}'], {
        encoding: 'utf-8'
      });

      if (result.stdout?.includes('chromadb')) {
        // Container exists, start it
        execSync('docker start chromadb', { stdio: 'ignore' });
        success('ChromaDB container started');
      } else {
        // Create new container
        execSync(
          'docker run -d --name chromadb -p 8100:8000 -v chromadb_data:/chroma/chroma chromadb/chroma:latest',
          { stdio: 'ignore' }
        );
        success('ChromaDB container created and started');
      }
    } catch (e) {
      warn('ChromaDB setup skipped - run ./scripts/setup.sh for full setup');
    }
  } else {
    warn('Docker not available - ChromaDB must be started manually');
  }

  // Step 4: Summary
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  success('Basic setup complete!');
  console.log('');
  console.log(`  Matrix ID:    ${BLUE}${matrixId}${NC}`);
  console.log(`  Daemon Port:  ${BLUE}${daemonPort}${NC} (unique per project)`);
  console.log('');
  console.log('Next steps:');
  console.log(`  ${BLUE}bun memory status${NC}    Check system health`);
  console.log(`  ${BLUE}bun memory init${NC}      Start daemon & connect to hub`);
  console.log('');
  console.log('If hub requires PIN:');
  console.log(`  ${BLUE}bun memory init --pin <PIN>${NC}`);
  console.log('');
}

main().catch(console.error);
