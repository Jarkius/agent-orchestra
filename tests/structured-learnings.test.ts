import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createLearning, getLearningById, type LearningRecord } from '../src/db';

describe('Structured Learning Fields', () => {
  let testLearningId: number;

  beforeAll(() => {
    // Create a test learning with all structured fields
    testLearningId = createLearning({
      category: 'testing',
      title: 'Test structured learning',
      description: 'Test description',
      what_happened: 'Test scenario: evaluated structured fields',
      lesson: 'Structured fields improve learning quality',
      prevention: 'Always include what_happened, lesson, and prevention',
      confidence: 'low',
    });
  });

  afterAll(async () => {
    // Clean up test learning
    const { db } = await import('../src/db');
    db.run('DELETE FROM learnings WHERE id = ?', [testLearningId]);
  });

  test('createLearning stores structured fields', () => {
    expect(testLearningId).toBeGreaterThan(0);
  });

  test('getLearningById returns structured fields', () => {
    const learning = getLearningById(testLearningId);

    expect(learning).not.toBeNull();
    expect(learning!.what_happened).toBe('Test scenario: evaluated structured fields');
    expect(learning!.lesson).toBe('Structured fields improve learning quality');
    expect(learning!.prevention).toBe('Always include what_happened, lesson, and prevention');
  });

  test('createLearning handles optional structured fields', () => {
    const minimalLearningId = createLearning({
      category: 'testing',
      title: 'Minimal learning without structured fields',
    });

    const learning = getLearningById(minimalLearningId);
    expect(learning).not.toBeNull();
    expect(learning!.what_happened).toBeNull();
    expect(learning!.lesson).toBeNull();
    expect(learning!.prevention).toBeNull();

    // Clean up
    const { db } = require('../src/db');
    db.run('DELETE FROM learnings WHERE id = ?', [minimalLearningId]);
  });

  test('LearningRecord interface includes structured fields', () => {
    const learning: LearningRecord = {
      category: 'architecture',
      title: 'Type test',
      what_happened: 'Verified types',
      lesson: 'Types are correct',
      prevention: 'Keep types updated',
    };

    expect(learning.what_happened).toBeDefined();
    expect(learning.lesson).toBeDefined();
    expect(learning.prevention).toBeDefined();
  });
});
