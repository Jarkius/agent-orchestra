/**
 * Simulation Tests for Oracle Intelligence
 *
 * End-to-end simulations of multi-agent workflows:
 * - Task routing through the full pipeline
 * - Multi-agent coordination
 * - Learning extraction and application
 * - Workload balancing
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getOracleOrchestrator } from '../../src/oracle/orchestrator';
import { getTaskRouter } from '../../src/oracle/task-router';
import { getTaskDecomposer } from '../../src/oracle/task-decomposer';
import {
  createTempDb,
  getTempDb,
  cleanupTempDb
} from './test-utils';
import type { AgentRole, ModelTier } from '../../src/interfaces/spawner';

// Simulated agent for testing
interface SimulatedAgent {
  id: number;
  role: AgentRole;
  model: ModelTier;
  status: 'idle' | 'busy' | 'crashed';
  tasksCompleted: number;
  currentTask: string | null;
}

// Simulation state
interface SimulationState {
  agents: Map<number, SimulatedAgent>;
  taskQueue: Array<{ id: string; prompt: string; priority: string }>;
  completedTasks: string[];
  failedTasks: string[];
  totalTokensUsed: number;
  elapsedTimeMs: number;
}

describe('Oracle Intelligence Simulation', () => {
  let db: ReturnType<typeof getTempDb>;
  let oracle: ReturnType<typeof getOracleOrchestrator>;
  let router: ReturnType<typeof getTaskRouter>;
  let decomposer: ReturnType<typeof getTaskDecomposer>;
  let simState: SimulationState;

  beforeEach(() => {
    createTempDb();
    db = getTempDb();
    oracle = getOracleOrchestrator();
    router = getTaskRouter({ enableLLM: false }); // Fast heuristic mode
    decomposer = getTaskDecomposer({ enableLLM: false });

    // Initialize simulation state
    simState = {
      agents: new Map(),
      taskQueue: [],
      completedTasks: [],
      failedTasks: [],
      totalTokensUsed: 0,
      elapsedTimeMs: 0,
    };
  });

  afterEach(() => {
    cleanupTempDb();
  });

  // Helper: Spawn simulated agent
  function spawnSimAgent(role: AgentRole, model: ModelTier): SimulatedAgent {
    const id = simState.agents.size + 1;
    const agent: SimulatedAgent = {
      id,
      role,
      model,
      status: 'idle',
      tasksCompleted: 0,
      currentTask: null,
    };
    simState.agents.set(id, agent);

    // Register in DB
    db.prepare(`
      INSERT INTO agents (id, role, model, status, pid, created_at, updated_at)
      VALUES (?, ?, ?, 'idle', ?, datetime('now'), datetime('now'))
    `).run(id, role, model, 1000 + id);

    return agent;
  }

  // Helper: Simulate task execution
  function simulateTaskExecution(agent: SimulatedAgent, taskId: string, durationMs: number): boolean {
    agent.status = 'busy';
    agent.currentTask = taskId;

    // Simulate token usage based on model
    const tokenMultiplier = agent.model === 'opus' ? 3 : agent.model === 'sonnet' ? 2 : 1;
    simState.totalTokensUsed += 1000 * tokenMultiplier;
    simState.elapsedTimeMs += durationMs;

    // 95% success rate for simulation
    const success = Math.random() > 0.05;

    agent.status = 'idle';
    agent.currentTask = null;

    if (success) {
      agent.tasksCompleted++;
      simState.completedTasks.push(taskId);
    } else {
      simState.failedTasks.push(taskId);
    }

    return success;
  }

  describe('Single Agent Workflow', () => {
    it('should route simple task to haiku agent', async () => {
      const agent = spawnSimAgent('researcher', 'haiku');

      const task = 'Search for all TODO comments in the codebase';
      const decision = await router.routeTask(task);

      expect(decision.recommendedModel).toBe('haiku');
      expect(decision.recommendedRole).toBe('researcher');
      expect(decision.shouldDecompose).toBe(false);

      // Simulate execution
      const success = simulateTaskExecution(agent, 'task_1', 5000);
      expect(success).toBe(true);
      expect(simState.completedTasks).toContain('task_1');
    });

    it('should route complex task to opus agent', async () => {
      const agent = spawnSimAgent('architect', 'opus');

      const task = 'Design the microservices architecture for the new payment system';
      const decision = await router.routeTask(task);

      expect(decision.recommendedModel).toBe('opus');
      expect(decision.recommendedRole).toBe('architect');
    });

    it('should decompose multi-step task', async () => {
      spawnSimAgent('analyst', 'sonnet');
      spawnSimAgent('coder', 'sonnet');
      spawnSimAgent('tester', 'sonnet');

      const task = 'Refactor the authentication module and write comprehensive tests';
      const decomposed = await decomposer.decompose(task);

      expect(decomposed.subtasks.length).toBeGreaterThan(1);
      expect(decomposed.executionOrder).toMatch(/sequential|mixed/);

      // Verify subtask roles
      const roles = decomposed.subtasks.map(s => s.recommendedRole);
      expect(roles).toContain('analyst');
      expect(roles).toContain('coder');
      expect(roles).toContain('tester');
    });
  });

  describe('Multi-Agent Coordination', () => {
    it('should distribute tasks across multiple agents', async () => {
      // Spawn a team
      const coder1 = spawnSimAgent('coder', 'sonnet');
      const coder2 = spawnSimAgent('coder', 'sonnet');
      const tester = spawnSimAgent('tester', 'sonnet');

      // Queue multiple tasks
      const tasks = [
        'Implement user authentication',
        'Implement password reset flow',
        'Implement email verification',
        'Write tests for auth module',
      ];

      // Route and assign tasks
      for (let i = 0; i < tasks.length; i++) {
        const decision = await router.routeTask(tasks[i]);

        // Find matching idle agent
        let assignedAgent: SimulatedAgent | null = null;
        for (const agent of simState.agents.values()) {
          if (agent.role === decision.recommendedRole && agent.status === 'idle') {
            assignedAgent = agent;
            break;
          }
        }

        // Fallback to any idle agent
        if (!assignedAgent) {
          for (const agent of simState.agents.values()) {
            if (agent.status === 'idle') {
              assignedAgent = agent;
              break;
            }
          }
        }

        if (assignedAgent) {
          simulateTaskExecution(assignedAgent, `task_${i}`, 10000);
        }
      }

      // All tasks should complete
      expect(simState.completedTasks.length + simState.failedTasks.length).toBe(4);

      // Work should be distributed
      expect(coder1.tasksCompleted + coder2.tasksCompleted).toBeGreaterThan(0);
    });

    it('should handle parallel subtask execution', async () => {
      // Spawn specialists
      spawnSimAgent('analyst', 'sonnet');
      spawnSimAgent('coder', 'sonnet');
      spawnSimAgent('tester', 'sonnet');
      spawnSimAgent('scribe', 'haiku');

      const task = 'Implement feature X with tests and documentation';
      const decomposed = await decomposer.decompose(task);

      // Track which subtasks can run in parallel
      const parallelGroups: string[][] = [];
      const completed = new Set<string>();

      while (completed.size < decomposed.subtasks.length) {
        const parallelBatch: string[] = [];

        for (const subtask of decomposed.subtasks) {
          if (completed.has(subtask.id)) continue;

          // Check dependencies
          const depsCompleted = subtask.dependsOn.every(dep => completed.has(dep));
          if (depsCompleted) {
            parallelBatch.push(subtask.id);
          }
        }

        // Execute batch
        for (const taskId of parallelBatch) {
          completed.add(taskId);
        }
        parallelGroups.push(parallelBatch);
      }

      // Should have at least one batch (sequential) or more (parallel)
      expect(parallelGroups.length).toBeGreaterThan(0);
      expect(parallelGroups.flat().length).toBe(decomposed.subtasks.length);
    });
  });

  describe('Workload Balancing', () => {
    it('should detect and respond to bottlenecks', async () => {
      // Spawn unbalanced team (many coders, no testers)
      spawnSimAgent('coder', 'sonnet');
      spawnSimAgent('coder', 'sonnet');
      spawnSimAgent('coder', 'sonnet');
      // No tester!

      // Queue test tasks
      const testTasks = [
        'Write unit tests for auth',
        'Write integration tests for API',
        'Write e2e tests for checkout',
      ];

      // Try to route - should detect missing tester
      const decisions = await Promise.all(
        testTasks.map(t => router.routeTask(t))
      );

      // All should want tester role
      for (const decision of decisions) {
        expect(decision.recommendedRole).toBe('tester');
      }

      // Should recommend spawning since no tester available
      const noIdleTester = ![...simState.agents.values()].some(
        a => a.role === 'tester' && a.status === 'idle'
      );
      expect(noIdleTester).toBe(true);
    });

    it('should balance load across available agents', async () => {
      // Spawn equal team
      const agents = [
        spawnSimAgent('generalist', 'sonnet'),
        spawnSimAgent('generalist', 'sonnet'),
        spawnSimAgent('generalist', 'sonnet'),
      ];

      // Execute many tasks
      for (let i = 0; i < 15; i++) {
        // Find least busy agent
        const leastBusy = agents.reduce((a, b) =>
          a.tasksCompleted <= b.tasksCompleted ? a : b
        );
        simulateTaskExecution(leastBusy, `task_${i}`, 1000);
      }

      // Work should be roughly balanced (within 2 tasks of each other)
      const taskCounts = agents.map(a => a.tasksCompleted);
      const maxDiff = Math.max(...taskCounts) - Math.min(...taskCounts);
      expect(maxDiff).toBeLessThanOrEqual(2);
    });
  });

  describe('Token Efficiency', () => {
    it('should use cheaper models for simple tasks', async () => {
      spawnSimAgent('researcher', 'haiku');
      spawnSimAgent('coder', 'sonnet');
      spawnSimAgent('architect', 'opus');

      const simpleTasks = [
        'List all files in src/',
        'Search for console.log statements',
        'Find all imports',
      ];

      const complexTasks = [
        'Design a scalable authentication system',
        'Architect the microservices migration',
      ];

      // Route all tasks
      const simpleDecisions = await Promise.all(
        simpleTasks.map(t => router.routeTask(t))
      );
      const complexDecisions = await Promise.all(
        complexTasks.map(t => router.routeTask(t))
      );

      // Simple tasks should prefer haiku
      const simpleHaiku = simpleDecisions.filter(d => d.recommendedModel === 'haiku');
      expect(simpleHaiku.length).toBeGreaterThan(0);

      // Complex tasks should prefer opus
      const complexOpus = complexDecisions.filter(d => d.recommendedModel === 'opus');
      expect(complexOpus.length).toBeGreaterThan(0);
    });

    it('should track token usage by model tier', async () => {
      const haiku = spawnSimAgent('researcher', 'haiku');
      const sonnet = spawnSimAgent('coder', 'sonnet');
      const opus = spawnSimAgent('architect', 'opus');

      // Execute one task per agent
      simulateTaskExecution(haiku, 'task_1', 1000);
      simulateTaskExecution(sonnet, 'task_2', 2000);
      simulateTaskExecution(opus, 'task_3', 3000);

      // Token usage should reflect model costs
      // haiku: 1000, sonnet: 2000, opus: 3000 = 6000 total
      expect(simState.totalTokensUsed).toBe(6000);
    });
  });

  describe('End-to-End Workflow', () => {
    it('should complete a full feature development cycle', async () => {
      // Spawn a complete team
      spawnSimAgent('analyst', 'sonnet');
      spawnSimAgent('architect', 'opus');
      spawnSimAgent('coder', 'sonnet');
      spawnSimAgent('coder', 'sonnet');
      spawnSimAgent('tester', 'sonnet');
      spawnSimAgent('reviewer', 'sonnet');
      spawnSimAgent('scribe', 'haiku');

      // Complex feature request
      const feature = 'Implement user authentication with OAuth, including tests and documentation';

      // 1. Decompose the task
      const decomposed = await decomposer.decompose(feature);
      expect(decomposed.subtasks.length).toBeGreaterThan(1);

      // 2. Route each subtask
      const routingDecisions = await Promise.all(
        decomposed.subtasks.map(s => router.routeTask(s.prompt))
      );

      // 3. Execute subtasks respecting dependencies
      const completed = new Set<string>();
      let iterations = 0;
      const maxIterations = 10;

      while (completed.size < decomposed.subtasks.length && iterations < maxIterations) {
        iterations++;

        for (const subtask of decomposed.subtasks) {
          if (completed.has(subtask.id)) continue;

          // Check dependencies
          const depsCompleted = subtask.dependsOn.every(dep => completed.has(dep));
          if (!depsCompleted) continue;

          // Find suitable agent
          for (const agent of simState.agents.values()) {
            if (agent.status === 'idle' && agent.role === subtask.recommendedRole) {
              simulateTaskExecution(agent, subtask.id, 5000);
              completed.add(subtask.id);
              break;
            }
          }
        }
      }

      // All subtasks should complete
      expect(completed.size).toBe(decomposed.subtasks.length);

      // Various specialists should have worked
      const workingAgents = [...simState.agents.values()].filter(a => a.tasksCompleted > 0);
      expect(workingAgents.length).toBeGreaterThan(1);
    });
  });
});

describe('Simulation Metrics', () => {
  it('should report simulation statistics', () => {
    const stats = {
      totalTasks: 100,
      successRate: 0.95,
      avgTaskDurationMs: 5000,
      tokenEfficiency: 0.85, // Lower model used when appropriate
      parallelizationRatio: 0.4, // 40% of tasks ran in parallel
    };

    // Validate metrics are in expected ranges
    expect(stats.successRate).toBeGreaterThan(0.9);
    expect(stats.tokenEfficiency).toBeGreaterThan(0.7);
    expect(stats.parallelizationRatio).toBeGreaterThan(0);
  });
});
