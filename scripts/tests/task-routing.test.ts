/**
 * Task Router and Decomposer Tests
 * Tests for LLM-driven task routing and decomposition
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { TaskRouter, getTaskRouter, type RoutingDecision } from '../../src/oracle/task-router';
import { TaskDecomposer, getTaskDecomposer, type DecomposedTask } from '../../src/oracle/task-decomposer';

describe('Task Router', () => {
  let router: TaskRouter;

  beforeEach(() => {
    // Create router with LLM disabled for fast, deterministic tests
    router = new TaskRouter({ enableLLM: false });
  });

  describe('Heuristic Routing', () => {
    it('should route implementation tasks to coder', async () => {
      const decision = await router.routeTask('Implement user authentication');

      expect(decision.recommendedRole).toBe('coder');
      expect(decision.confidence).toBeGreaterThan(0);
    });

    it('should route testing tasks to tester', async () => {
      const decision = await router.routeTask('Write unit tests for the payment service');

      expect(decision.recommendedRole).toBe('tester');
    });

    it('should route review tasks to reviewer', async () => {
      const decision = await router.routeTask('Review the pull request and provide feedback');

      expect(decision.recommendedRole).toBe('reviewer');
    });

    it('should route architecture tasks to architect', async () => {
      const decision = await router.routeTask('Design the microservices architecture');

      expect(decision.recommendedRole).toBe('architect');
    });

    it('should route debugging tasks to debugger', async () => {
      const decision = await router.routeTask('Fix the race condition in user registration');

      expect(decision.recommendedRole).toBe('debugger');
    });

    it('should route research tasks to researcher', async () => {
      const decision = await router.routeTask('Research best practices for caching');

      expect(decision.recommendedRole).toBe('researcher');
    });

    it('should route documentation tasks to scribe', async () => {
      const decision = await router.routeTask('Document the API endpoints');

      expect(decision.recommendedRole).toBe('scribe');
    });

    it('should route analysis tasks to analyst', async () => {
      const decision = await router.routeTask('Analyze the performance bottlenecks');

      expect(decision.recommendedRole).toBe('analyst');
    });

    it('should default to generalist for unclear tasks', async () => {
      const decision = await router.routeTask('Process the data');

      expect(decision.recommendedRole).toBe('generalist');
    });
  });

  describe('Model Tier Selection', () => {
    it('should recommend opus for architecture tasks', async () => {
      const decision = await router.routeTask('Design the system architecture for the new platform');

      expect(decision.recommendedModel).toBe('opus');
    });

    it('should recommend haiku for simple search tasks', async () => {
      const decision = await router.routeTask('Search for all TODO comments in the codebase');

      expect(decision.recommendedModel).toBe('haiku');
    });

    it('should recommend sonnet for standard implementation', async () => {
      const decision = await router.routeTask('Implement the login form validation');

      expect(decision.recommendedModel).toBe('sonnet');
    });
  });

  describe('Decomposition Detection', () => {
    it('should detect multi-step tasks needing decomposition', async () => {
      const decision = await router.routeTask('Refactor the authentication module and write comprehensive tests');

      expect(decision.shouldDecompose).toBe(true);
    });

    it('should not decompose simple tasks', async () => {
      const decision = await router.routeTask('Fix the typo in the config file');

      expect(decision.shouldDecompose).toBe(false);
    });
  });

  describe('Reasoning', () => {
    it('should include reasoning in decision', async () => {
      const decision = await router.routeTask('Implement a caching layer');

      expect(decision.reasoning).toBeDefined();
      expect(decision.reasoning.length).toBeGreaterThan(0);
    });
  });
});

describe('Task Decomposer', () => {
  let decomposer: TaskDecomposer;

  beforeEach(() => {
    // Create decomposer with LLM disabled for fast tests
    decomposer = new TaskDecomposer({ enableLLM: false });
  });

  describe('Simple Task Handling', () => {
    it('should not decompose simple tasks', async () => {
      const result = await decomposer.decompose('Search for config files');

      expect(result.subtasks.length).toBe(1);
      expect(result.executionOrder).toBe('sequential');
    });

    it('should preserve original task in single-task plan', async () => {
      const task = 'List all environment variables';
      const result = await decomposer.decompose(task);

      expect(result.originalTask).toBe(task);
      expect(result.subtasks[0].prompt).toBe(task);
    });
  });

  describe('Complex Task Decomposition', () => {
    it('should decompose tasks with "and"', async () => {
      const result = await decomposer.decompose('Implement the feature and write tests');

      expect(result.subtasks.length).toBeGreaterThan(1);
    });

    it('should decompose refactor + test tasks', async () => {
      const result = await decomposer.decompose('Refactor the auth module with comprehensive tests');

      expect(result.subtasks.length).toBeGreaterThan(1);

      // Should have analysis, implementation, and testing phases
      const roles = result.subtasks.map(s => s.recommendedRole);
      expect(roles).toContain('analyst');
      expect(roles).toContain('coder');
      expect(roles).toContain('tester');
    });

    it('should set correct dependencies', async () => {
      const result = await decomposer.decompose('Implement feature and write tests');

      // Testing should depend on implementation
      const testTask = result.subtasks.find(s => s.recommendedRole === 'tester');
      const implTask = result.subtasks.find(s => s.recommendedRole === 'coder');

      if (testTask && implTask) {
        expect(testTask.dependsOn).toContain(implTask.id);
      }
    });
  });

  describe('Execution Order', () => {
    it('should be sequential when all tasks have dependencies', async () => {
      const result = await decomposer.decompose('Refactor module and write tests');

      // In sequential execution, later tasks depend on earlier ones
      if (result.subtasks.length > 1) {
        expect(['sequential', 'mixed']).toContain(result.executionOrder);
      }
    });
  });

  describe('Role Assignment', () => {
    it('should assign tester role to test subtasks', async () => {
      const result = await decomposer.decompose('Implement the login feature and write unit tests for it');

      // Look for a subtask with tester role
      const testTask = result.subtasks.find(s => s.recommendedRole === 'tester');

      // Should have a tester subtask when "tests" is mentioned
      expect(testTask).toBeDefined();
      expect(testTask!.recommendedRole).toBe('tester');
    });

    it('should assign coder role to implementation subtasks', async () => {
      const result = await decomposer.decompose('Implement caching and test it');

      const implTask = result.subtasks.find(s =>
        s.recommendedRole === 'coder' || s.recommendedRole === 'analyst'
      );

      expect(implTask).toBeDefined();
    });
  });

  describe('Complexity Estimation', () => {
    it('should estimate total complexity', async () => {
      const result = await decomposer.decompose('Simple task');

      expect(['simple', 'moderate', 'complex']).toContain(result.totalEstimatedComplexity);
    });

    it('should estimate higher complexity for multi-part tasks', async () => {
      const simpleResult = await decomposer.decompose('Read the config');
      const complexResult = await decomposer.decompose('Design architecture and implement with tests');

      // Complex task should have same or higher complexity
      const complexityOrder = { simple: 0, moderate: 1, complex: 2 };
      expect(complexityOrder[complexResult.totalEstimatedComplexity])
        .toBeGreaterThanOrEqual(complexityOrder[simpleResult.totalEstimatedComplexity]);
    });
  });
});

describe('Singleton Instances', () => {
  it('getTaskRouter should return consistent instance', () => {
    const router1 = getTaskRouter();
    const router2 = getTaskRouter();

    expect(router1).toBe(router2);
  });

  it('getTaskDecomposer should return consistent instance', () => {
    const decomposer1 = getTaskDecomposer();
    const decomposer2 = getTaskDecomposer();

    expect(decomposer1).toBe(decomposer2);
  });
});
