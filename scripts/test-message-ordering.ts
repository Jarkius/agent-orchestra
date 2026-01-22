#!/usr/bin/env bun
/**
 * Test message ordering with sequence numbers
 * Verifies that parallel messages get sequential sequence numbers
 */

import { db, saveMatrixMessage, getNextSequenceNumber } from '../src/db';

const TEST_MATRIX = 'test-ordering-matrix';
const NUM_MESSAGES = 10;

async function cleanupTestData() {
  // Clean up any previous test data
  db.run(`DELETE FROM matrix_messages WHERE from_matrix = ?`, [TEST_MATRIX]);
  db.run(`DELETE FROM matrix_sequence_counters WHERE matrix_id = ?`, [TEST_MATRIX]);
}

async function testSequentialOrdering() {
  console.log('📬 Test 1: Sequential message ordering\n');

  const results: { id: string; seq: number }[] = [];

  // Send messages sequentially
  for (let i = 1; i <= NUM_MESSAGES; i++) {
    const messageId = `seq-test-${Date.now()}-${i}`;
    const saved = saveMatrixMessage({
      messageId,
      fromMatrix: TEST_MATRIX,
      content: `Message ${i}`,
      messageType: 'broadcast',
    });
    results.push({ id: messageId, seq: saved.sequenceNumber });
  }

  // Verify sequence numbers are monotonically increasing
  let passed = true;
  for (let i = 0; i < results.length; i++) {
    const expected = i + 1;
    const actual = results[i].seq;
    if (actual !== expected) {
      console.log(`  ❌ Message ${i + 1}: expected seq ${expected}, got ${actual}`);
      passed = false;
    } else {
      console.log(`  ✅ Message ${i + 1}: seq ${actual}`);
    }
  }

  return passed;
}

async function testParallelOrdering() {
  console.log('\n📬 Test 2: Parallel message ordering\n');

  // Reset sequence counter for a new test matrix
  const parallelMatrix = 'test-parallel-matrix';
  db.run(`DELETE FROM matrix_messages WHERE from_matrix = ?`, [parallelMatrix]);
  db.run(`DELETE FROM matrix_sequence_counters WHERE matrix_id = ?`, [parallelMatrix]);

  // Send messages in parallel
  const promises = Array.from({ length: NUM_MESSAGES }, (_, i) => {
    return new Promise<{ id: string; seq: number }>((resolve) => {
      const messageId = `par-test-${Date.now()}-${i + 1}`;
      const saved = saveMatrixMessage({
        messageId,
        fromMatrix: parallelMatrix,
        content: `Parallel Message ${i + 1}`,
        messageType: 'broadcast',
      });
      resolve({ id: messageId, seq: saved.sequenceNumber });
    });
  });

  const results = await Promise.all(promises);

  // Check that all sequence numbers are unique
  const seqNumbers = new Set(results.map(r => r.seq));
  const allUnique = seqNumbers.size === NUM_MESSAGES;

  // Check that sequence numbers range from 1 to NUM_MESSAGES
  const sortedSeqs = [...seqNumbers].sort((a, b) => a - b);
  const expectedSeqs = Array.from({ length: NUM_MESSAGES }, (_, i) => i + 1);
  const correctRange = JSON.stringify(sortedSeqs) === JSON.stringify(expectedSeqs);

  console.log(`  Sequence numbers: ${[...seqNumbers].sort((a, b) => a - b).join(', ')}`);
  console.log(`  All unique: ${allUnique ? '✅' : '❌'}`);
  console.log(`  Correct range (1-${NUM_MESSAGES}): ${correctRange ? '✅' : '❌'}`);

  return allUnique && correctRange;
}

async function testQueryOrdering() {
  console.log('\n📬 Test 3: Query ordering by sequence\n');

  // Insert messages with known sequence numbers in random order
  const orderMatrix = 'test-order-query-matrix';
  db.run(`DELETE FROM matrix_messages WHERE from_matrix = ?`, [orderMatrix]);
  db.run(`DELETE FROM matrix_sequence_counters WHERE matrix_id = ?`, [orderMatrix]);

  // Create messages with specific sequence numbers in scrambled order
  for (const seq of [5, 2, 8, 1, 10, 3, 7, 4, 9, 6]) {
    // Insert directly to control sequence numbers
    db.run(`
      INSERT INTO matrix_messages (message_id, from_matrix, content, message_type, status, sequence_number, delivered_at)
      VALUES (?, ?, ?, 'broadcast', 'delivered', ?, CURRENT_TIMESTAMP)
    `, [`order-test-${seq}`, orderMatrix, `Content for seq ${seq}`, seq]);
  }

  // Query messages and verify they come back in sequence order
  const messages = db.query(`
    SELECT message_id, sequence_number
    FROM matrix_messages
    WHERE from_matrix = ?
    ORDER BY from_matrix ASC, sequence_number ASC
  `).all(orderMatrix) as { message_id: string; sequence_number: number }[];

  console.log('  Retrieved order:');
  let passed = true;
  for (let i = 0; i < messages.length; i++) {
    const expected = i + 1;
    const actual = messages[i].sequence_number;
    const status = actual === expected ? '✅' : '❌';
    console.log(`    ${status} Position ${i + 1}: seq ${actual} (expected ${expected})`);
    if (actual !== expected) passed = false;
  }

  return passed;
}

async function main() {
  console.log('🧪 Testing message ordering with sequence numbers\n');
  console.log('=' .repeat(50));

  await cleanupTestData();

  const test1 = await testSequentialOrdering();
  const test2 = await testParallelOrdering();
  const test3 = await testQueryOrdering();

  console.log('\n' + '='.repeat(50));
  console.log('\n📊 Results:');
  console.log(`  Test 1 (Sequential): ${test1 ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  Test 2 (Parallel): ${test2 ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  Test 3 (Query order): ${test3 ? '✅ PASSED' : '❌ FAILED'}`);

  const allPassed = test1 && test2 && test3;
  console.log(`\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
