/**
 * AgentSpawner Tests
 * Tests for role-based agent spawning and task distribution
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { AgentSpawner } from '../spawner';
import { selectModel, ROLE_PROMPTS } from '../../interfaces/spawner';
import type { Task, AgentRole, ModelTier } from '../../interfaces/spawner';

describe('AgentSpawner', () => {
  let spawner: AgentSpawner;

  beforeEach(() => {
    spawner = new AgentSpawner(`test-spawner-${Date.now()}`);
  });

  afterEach(async () => {
    try {
      await spawner.shutdown();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Agent Queries (No Spawn)', () => {
    it('should return null for non-existent agent', () => {
      const agent = spawner.getAgent(999);
      expect(agent).toBeNull();
    });

    it('should return empty array when no agents', () => {
      expect(spawner.getAllAgents()).toEqual([]);
      expect(spawner.getActiveAgents()).toEqual([]);
    });

    it('should return empty specialists when no agents', () => {
      const specialists = spawner.getSpecialists('coder');
      expect(specialists).toEqual([]);
    });

    it('should return empty agents by model when no agents', () => {
      const agents = spawner.getAgentsByModel('sonnet');
      expect(agents).toEqual([]);
    });

    it('should return null for available agent when none exist', () => {
      const agent = spawner.getAvailableAgent();
      expect(agent).toBeNull();
    });

    it('should return null for least busy agent when none exist', () => {
      const agent = spawner.getLeastBusyAgent();
      expect(agent).toBeNull();
    });
  });

  describe('Task Distribution (No Agents)', () => {
    it('should throw when distributing to no agents', async () => {
      const task: Task = {
        id: 'task-1',
        prompt: 'Test task',
        priority: 'normal',
      };

      await expect(spawner.distributeTask(task)).rejects.toThrow(
        'No agents available'
      );
    });
  });

  describe('Complete Task', () => {
    it('should handle completing non-existent task gracefully', () => {
      // Should not throw
      expect(() => spawner.completeTask('non-existent', true)).not.toThrow();
    });
  });

  describe('PTY Manager Access', () => {
    it('should provide access to underlying PTY manager', () => {
      const ptyManager = spawner.getPTYManager();
      expect(ptyManager).toBeDefined();
      expect(typeof ptyManager.spawn).toBe('function');
    });
  });
});

describe('Model Selection', () => {
  it('should select opus for critical tasks', () => {
    const task: Task = {
      id: 'test',
      prompt: 'Critical task',
      priority: 'critical',
    };
    expect(selectModel(task)).toBe('opus');
  });

  it('should select opus for synthesis tasks', () => {
    const task: Task = {
      id: 'test',
      prompt: 'Synthesize findings',
      type: 'synthesis',
      priority: 'normal',
    };
    expect(selectModel(task)).toBe('opus');
  });

  it('should select sonnet for analysis tasks', () => {
    const task: Task = {
      id: 'test',
      prompt: 'Analyze code',
      type: 'analysis',
      priority: 'normal',
    };
    expect(selectModel(task)).toBe('sonnet');
  });

  it('should select sonnet for review tasks', () => {
    const task: Task = {
      id: 'test',
      prompt: 'Review PR',
      type: 'review',
      priority: 'normal',
    };
    expect(selectModel(task)).toBe('sonnet');
  });

  it('should select haiku for general tasks', () => {
    const task: Task = {
      id: 'test',
      prompt: 'General task',
      type: 'general',
      priority: 'normal',
    };
    expect(selectModel(task)).toBe('haiku');
  });

  it('should select haiku for extraction tasks', () => {
    const task: Task = {
      id: 'test',
      prompt: 'Extract data',
      type: 'extraction',
      priority: 'low',
    };
    expect(selectModel(task)).toBe('haiku');
  });
});

describe('Role Prompts', () => {
  const roles: AgentRole[] = [
    'coder',
    'tester',
    'analyst',
    'reviewer',
    'generalist',
    'oracle',
    'architect',
    'debugger',
    'researcher',
    'scribe',
  ];

  it('should have prompts for all roles', () => {
    for (const role of roles) {
      expect(ROLE_PROMPTS[role]).toBeDefined();
      expect(typeof ROLE_PROMPTS[role]).toBe('string');
      expect(ROLE_PROMPTS[role].length).toBeGreaterThan(0);
    }
  });

  it('should have meaningful prompts', () => {
    expect(ROLE_PROMPTS.coder).toContain('coding');
    expect(ROLE_PROMPTS.tester).toContain('testing');
    expect(ROLE_PROMPTS.oracle).toContain('orchestrator');
  });
});
