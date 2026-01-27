#!/usr/bin/env bun
/**
 * Postinstall hook - runs after `bun install`
 *
 * Detects fresh clone and runs essential setup:
 * 1. Initialize SQLite database
 * 2. Start ChromaDB (if Docker available)
 * 3. Download embedding model
 * 4. Run health check
 */

import { existsSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join } from 'path';

const ROOT = process.cwd();
const DB_PATH = join(ROOT, 'agents.db');
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

  if (!isFreshClone) {
    success('Existing installation detected');
    log('Run `bun memory status` to check health');
    return;
  }

  console.log('');
  log('Fresh clone detected - running setup...');
  console.log('');

  // Step 1: Initialize SQLite database
  log('Initializing SQLite database...');
  try {
    // Import db module to trigger table creation
    await import('../src/db/index.ts');
    success('SQLite database initialized');
  } catch (e) {
    error(`Database init failed: ${e}`);
  }

  // Step 2: Check Docker and start ChromaDB
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

  // Step 3: Download embedding model (background)
  log('Embedding model will be downloaded on first use');
  log('(Run `bun run download-model` to pre-download)');

  // Step 4: Summary
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  success('Basic setup complete!');
  console.log('');
  console.log('Next steps:');
  console.log(`  ${BLUE}bun memory status${NC}    Check system health`);
  console.log(`  ${BLUE}bun memory init${NC}      Full initialization`);
  console.log(`  ${BLUE}./scripts/setup.sh${NC}   Complete setup (hub, daemon, index)`);
  console.log('');
}

main().catch(console.error);
