/**
 * Oracle Consultation Tests
 * Tests for agent-to-Oracle consultation during task execution
 */

import { describe, it, expect, beforeEach, beforeAll } from 'bun:test';
import { oracleConsultHandlers } from '../../src/mcp/tools/handlers/oracle-consult';

describe('Oracle Consultation', () => {
  describe('Input Validation', () => {
    it('should require agent_id', async () => {
      await expect(
        oracleConsultHandlers.oracle_consult({
          question: 'How do I fix this?',
          question_type: 'stuck',
        })
      ).rejects.toThrow();
    });

    it('should require question', async () => {
      await expect(
        oracleConsultHandlers.oracle_consult({
          agent_id: 1,
          question_type: 'approach',
        })
      ).rejects.toThrow();
    });

    it('should require question_type', async () => {
      await expect(
        oracleConsultHandlers.oracle_consult({
          agent_id: 1,
          question: 'How do I implement this feature?',
        })
      ).rejects.toThrow();
    });

    it('should require minimum question length', async () => {
      await expect(
        oracleConsultHandlers.oracle_consult({
          agent_id: 1,
          question: 'Hi',
          question_type: 'approach',
        })
      ).rejects.toThrow(/at least 5 characters/);
    });

    it('should validate question_type enum', async () => {
      await expect(
        oracleConsultHandlers.oracle_consult({
          agent_id: 1,
          question: 'How do I fix this?',
          question_type: 'invalid_type',
        })
      ).rejects.toThrow();
    });
  });

  describe('Approach Consultation', () => {
    it('should provide guidance for approach questions', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'How should I implement user authentication?',
        question_type: 'approach',
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('Guidance');
      expect(result.content[0].text).toContain('complexity');
    });

    it('should include suggested approach for approach questions', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'How should I implement a caching layer?',
        question_type: 'approach',
      });

      expect(result.content[0].text).toContain('Suggested Approach');
    });

    it('should detect complex tasks', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'Design the system architecture for microservices platform',
        question_type: 'approach',
      });

      expect(result.content[0].text).toContain('complex');
      expect(result.content[0].text).toContain('opus');
    });
  });

  describe('Stuck Consultation', () => {
    it('should provide unblocking strategies', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'I cannot figure out why the test is failing',
        question_type: 'stuck',
        context: 'I tried adding console.log but the error persists',
      });

      expect(result.content[0].text).toContain('Unblocking strategies');
      expect(result.content[0].text).toContain('Simplify');
    });

    it('should provide error-specific guidance when context mentions errors', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'The function keeps throwing exceptions',
        question_type: 'stuck',
        context: 'Getting "TypeError: undefined is not a function" error',
      });

      expect(result.content[0].text).toContain('Error-specific');
    });

    it('should provide test-specific guidance when context mentions tests', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'Unit test keeps timing out',
        question_type: 'stuck',
        context: 'The test was passing before, now its failing intermittently',
      });

      expect(result.content[0].text).toContain('Test-specific');
    });

    it('should recommend escalation for complex stuck scenarios', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'Need to debug the complex distributed system architecture spanning multiple services',
        question_type: 'stuck',
        context: 'Tried multiple approaches including analyzing logs, tracing requests, checking database queries, reviewing service mesh configuration, examining kubernetes pod logs, checking network policies, and verifying authentication tokens across services. Still unable to identify the root cause.',
      });

      // Complex stuck scenarios with long context may trigger escalation
      expect(result.content[0].text).toMatch(/Escalation|complex/i);
    });
  });

  describe('Review Consultation', () => {
    it('should provide review checklist', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'Can you review my implementation approach?',
        question_type: 'review',
        context: 'I implemented the feature using async/await pattern',
      });

      expect(result.content[0].text).toContain('Review checklist');
      expect(result.content[0].text).toContain('requirements');
    });
  });

  describe('Escalate Consultation', () => {
    it('should confirm escalation request', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'This task requires deep architectural analysis, requesting escalation',
        question_type: 'escalate',
      });

      expect(result.content[0].text).toContain('Escalation');
      expect(result.content[0].text).toContain('Recommended');
    });

    it('should include complexity analysis in escalation', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'Architect new payment system requiring security audit',
        question_type: 'escalate',
      });

      expect(result.content[0].text).toContain('complexity');
      expect(result.content[0].text).toMatch(/haiku|sonnet|opus/);
    });
  });

  describe('Response Structure', () => {
    it('should include agent ID in response', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 42,
        question: 'How should I proceed with this task?',
        question_type: 'approach',
      });

      expect(result.content[0].text).toContain('Agent 42');
    });

    it('should include question type in response', async () => {
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question: 'How should I proceed?',
        question_type: 'stuck',
      });

      expect(result.content[0].text).toContain('Question Type');
      expect(result.content[0].text).toContain('stuck');
    });

    it('should echo the question in response', async () => {
      const question = 'How do I implement the feature with tests?';
      const result = await oracleConsultHandlers.oracle_consult({
        agent_id: 1,
        question,
        question_type: 'approach',
      });

      expect(result.content[0].text).toContain(question);
    });
  });
});
