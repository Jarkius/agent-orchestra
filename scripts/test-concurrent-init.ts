#!/usr/bin/env bun
/**
 * Test concurrent database initialization
 * Runs 5 parallel processes that all try to initialize the DB simultaneously
 */

import { spawn } from 'bun';
import { existsSync, unlinkSync, rmSync } from 'fs';

const NUM_PROCESSES = 5;
const DB_PATH = './agents.db';
const DB_WAL = './agents.db-wal';
const DB_SHM = './agents.db-shm';
const LOCK_PATH = './agents.db.init.lock';

async function cleanupDb() {
  // Remove existing DB files to test fresh initialization
  for (const path of [DB_PATH, DB_WAL, DB_SHM, LOCK_PATH]) {
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {}
    }
  }
}

async function runWorker(id: number): Promise<{ id: number; success: boolean; error?: string }> {
  const proc = spawn({
    cmd: ['bun', '-e', `
      import { db, registerMatrix, getOrCreateEntity } from './src/db.ts';

      // Test basic queries
      try {
        db.query('SELECT COUNT(*) FROM agents').get();
        db.query('SELECT COUNT(*) FROM agent_tasks').get();
        db.query('SELECT COUNT(*) FROM sessions').get();
        db.query('SELECT COUNT(*) FROM learnings').get();
        db.query('SELECT COUNT(*) FROM matrix_registry').get();

        // Test upsert functions
        registerMatrix('test-matrix-${id}', 'Test Matrix ${id}');
        getOrCreateEntity('test-entity-${id}', 'concept');

        console.log('WORKER_${id}_SUCCESS');
      } catch (e) {
        console.error('WORKER_${id}_ERROR:', e.message);
        process.exit(1);
      }
    `],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return {
    id,
    success: exitCode === 0 && stdout.includes(`WORKER_${id}_SUCCESS`),
    error: exitCode !== 0 ? stderr || stdout : undefined,
  };
}

async function main() {
  console.log('🧪 Testing concurrent database initialization with', NUM_PROCESSES, 'processes\n');

  // Clean up first
  await cleanupDb();
  console.log('✓ Cleaned up existing database files\n');

  console.log('Starting', NUM_PROCESSES, 'workers simultaneously...\n');

  // Start all workers at once
  const startTime = Date.now();
  const results = await Promise.all(
    Array.from({ length: NUM_PROCESSES }, (_, i) => runWorker(i + 1))
  );
  const duration = Date.now() - startTime;

  // Report results
  let passed = 0;
  let failed = 0;

  for (const result of results) {
    if (result.success) {
      console.log(`✅ Worker ${result.id}: SUCCESS`);
      passed++;
    } else {
      console.log(`❌ Worker ${result.id}: FAILED - ${result.error}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed}/${NUM_PROCESSES} passed in ${duration}ms`);

  // Verify lock was cleaned up
  if (existsSync(LOCK_PATH)) {
    console.log('⚠️  Warning: Lock file still exists after test');
  } else {
    console.log('✓ Lock file cleaned up properly');
  }

  // Verify all matrices were registered
  const { db } = await import('../src/db.ts');
  const matrices = db.query('SELECT COUNT(*) as count FROM matrix_registry WHERE matrix_id LIKE ?').get('test-matrix-%') as { count: number };
  console.log(`✓ Registered ${matrices.count} test matrices`);

  const entities = db.query('SELECT COUNT(*) as count FROM entities WHERE name LIKE ?').get('test-entity-%') as { count: number };
  console.log(`✓ Created ${entities.count} test entities`);

  if (failed > 0) {
    console.log('\n❌ TEST FAILED: Some workers encountered errors');
    process.exit(1);
  } else {
    console.log('\n✅ TEST PASSED: All workers initialized successfully');
    process.exit(0);
  }
}

main().catch(console.error);
