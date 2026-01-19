/**
 * Oracle Orchestrator Tests
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  OracleOrchestrator,
  getOracleOrchestrator,
  type WorkloadAnalysis,
  type RebalanceAction,
  type PriorityAdjustment,
  type Bottleneck,
} from '../orchestrator';

// Mock dependencies
const mockAgents = [
  { id: 1, name: 'agent-1', role: 'coder' as const, model: 'sonnet' as const, status: 'idle' as const, tasksCompleted: 5, tasksFailed: 1, createdAt: new Date() },
  { id: 2, name: 'agent-2', role: 'tester' as const, model: 'sonnet' as const, status: 'busy' as const, tasksCompleted: 3, tasksFailed: 0, createdAt: new Date(), currentTaskId: 'task_1' },
  { id: 3, name: 'agent-3', role: 'generalist' as const, model: 'haiku' as const, status: 'idle' as const, tasksCompleted: 0, tasksFailed: 0, createdAt: new Date() },
];

const mockMissions = [
  { id: 'mission_1', prompt: 'Test task', status: 'queued' as const, priority: 'normal' as const, type: 'analysis' as const, createdAt: new Date(), timeoutMs: 120000, maxRetries: 3, retryCount: 0 },
  { id: 'mission_2', prompt: 'Old task', status: 'queued' as const, priority: 'low' as const, createdAt: new Date(Date.now() - 3600000), timeoutMs: 120000, maxRetries: 3, retryCount: 0 },
  { id: 'mission_3', prompt: 'Blocking task', status: 'queued' as const, priority: 'normal' as const, createdAt: new Date(), dependsOn: undefined, timeoutMs: 120000, maxRetries: 3, retryCount: 0 },
];

describe('OracleOrchestrator', () => {
  describe('analyzeWorkload', () => {
    test('calculates agent metrics correctly', () => {
      const oracle = getOracleOrchestrator();
      const analysis = oracle.analyzeWorkload();

      expect(analysis).toHaveProperty('totalAgents');
      expect(analysis).toHaveProperty('activeAgents');
      expect(analysis).toHaveProperty('idleAgents');
      expect(analysis).toHaveProperty('agentMetrics');
      expect(analysis).toHaveProperty('roleDistribution');
      expect(analysis).toHaveProperty('modelDistribution');
      expect(analysis).toHaveProperty('averageSuccessRate');
      expect(analysis).toHaveProperty('bottleneckRoles');

      // Verify structure
      expect(typeof analysis.totalAgents).toBe('number');
      expect(typeof analysis.activeAgents).toBe('number');
      expect(typeof analysis.averageSuccessRate).toBe('number');
      expect(Array.isArray(analysis.agentMetrics)).toBe(true);
      expect(Array.isArray(analysis.bottleneckRoles)).toBe(true);
    });

    test('role distribution covers all roles', () => {
      const oracle = getOracleOrchestrator();
      const analysis = oracle.analyzeWorkload();

      const expectedRoles = ['coder', 'tester', 'analyst', 'reviewer', 'generalist', 'oracle', 'architect', 'debugger', 'researcher', 'scribe'];
      for (const role of expectedRoles) {
        expect(analysis.roleDistribution).toHaveProperty(role);
      }
    });

    test('model distribution covers all tiers', () => {
      const oracle = getOracleOrchestrator();
      const analysis = oracle.analyzeWorkload();

      expect(analysis.modelDistribution).toHaveProperty('haiku');
      expect(analysis.modelDistribution).toHaveProperty('sonnet');
      expect(analysis.modelDistribution).toHaveProperty('opus');
    });
  });

  describe('suggestRebalancing', () => {
    test('returns array of rebalance actions', () => {
      const oracle = getOracleOrchestrator();
      const suggestions = oracle.suggestRebalancing();

      expect(Array.isArray(suggestions)).toBe(true);

      for (const action of suggestions) {
        expect(action).toHaveProperty('type');
        expect(action).toHaveProperty('targetRole');
        expect(action).toHaveProperty('reason');
        expect(action).toHaveProperty('priority');
        expect(['spawn', 'reassign', 'retire']).toContain(action.type);
        expect(['high', 'normal', 'low']).toContain(action.priority);
      }
    });
  });

  describe('optimizeMissionQueue', () => {
    test('returns array of priority adjustments', () => {
      const oracle = getOracleOrchestrator();
      const adjustments = oracle.optimizeMissionQueue();

      expect(Array.isArray(adjustments)).toBe(true);

      for (const adj of adjustments) {
        expect(adj).toHaveProperty('missionId');
        expect(adj).toHaveProperty('currentPriority');
        expect(adj).toHaveProperty('suggestedPriority');
        expect(adj).toHaveProperty('reason');
      }
    });
  });

  describe('identifyBottlenecks', () => {
    test('returns array of bottlenecks', () => {
      const oracle = getOracleOrchestrator();
      const bottlenecks = oracle.identifyBottlenecks();

      expect(Array.isArray(bottlenecks)).toBe(true);

      for (const b of bottlenecks) {
        expect(b).toHaveProperty('type');
        expect(b).toHaveProperty('description');
        expect(b).toHaveProperty('severity');
        expect(b).toHaveProperty('affectedMissions');
        expect(b).toHaveProperty('suggestedAction');
        expect(['role_shortage', 'queue_backup', 'failure_spike', 'dependency_chain']).toContain(b.type);
        expect(['critical', 'high', 'medium', 'low']).toContain(b.severity);
      }
    });
  });

  describe('getEfficiencyInsights', () => {
    test('returns array of efficiency insights', async () => {
      const oracle = getOracleOrchestrator();
      const insights = await oracle.getEfficiencyInsights();

      expect(Array.isArray(insights)).toBe(true);

      for (const insight of insights) {
        expect(insight).toHaveProperty('category');
        expect(insight).toHaveProperty('title');
        expect(insight).toHaveProperty('description');
        expect(insight).toHaveProperty('impact');
        expect(insight).toHaveProperty('actionable');
        expect(['performance', 'resource', 'workflow']).toContain(insight.category);
        expect(['high', 'medium', 'low']).toContain(insight.impact);
      }
    });
  });

  describe('applyPriorityAdjustments', () => {
    test('applies adjustments and returns count', () => {
      const oracle = getOracleOrchestrator();

      // Create mock adjustments
      const adjustments: PriorityAdjustment[] = [
        { missionId: 'test_1', currentPriority: 'low', suggestedPriority: 'normal', reason: 'test' },
        { missionId: 'test_2', currentPriority: 'normal', suggestedPriority: 'high', reason: 'test' },
      ];

      const applied = oracle.applyPriorityAdjustments(adjustments);

      expect(typeof applied).toBe('number');
      expect(applied).toBe(2);
    });
  });
});

describe('Singleton', () => {
  test('getOracleOrchestrator returns same instance', () => {
    const oracle1 = getOracleOrchestrator();
    const oracle2 = getOracleOrchestrator();

    expect(oracle1).toBe(oracle2);
  });
});
