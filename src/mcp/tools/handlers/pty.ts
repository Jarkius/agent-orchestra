/**
 * PTY Orchestration Tools
 * Consolidated MCP tools for agent and mission management
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler, MCPResponse } from '../../types';
import { jsonResponse, errorResponse } from '../../utils/response';
import { AgentSpawner, getAgentSpawner } from '../../../pty/spawner';
import { MissionQueue, getMissionQueue } from '../../../pty/mission-queue';
import { getPTYManager } from '../../../pty/manager';
import { getWorktreeManager } from '../../../pty/worktree-manager';
import { getLearningLoop } from '../../../learning';
import { getOracleOrchestrator } from '../../../oracle/orchestrator';
import { selectModel, ROLE_PROMPTS } from '../../../interfaces/spawner';
import type { AgentRole, ModelTier, Task } from '../../../interfaces/spawner';
import type { Priority } from '../../../interfaces/mission';

// ============ Schemas ============

const ROLES = ['coder', 'tester', 'analyst', 'reviewer', 'generalist', 'oracle', 'architect', 'debugger', 'researcher', 'scribe'] as const;
const MODELS = ['haiku', 'sonnet', 'opus'] as const;

const AgentSchema = z.object({
  action: z.enum(['spawn', 'spawn_pool', 'kill', 'restart', 'health', 'health_all', 'status']),
  agent_id: z.number().optional(),
  role: z.enum(ROLES).optional(),
  model: z.enum(MODELS).optional(),
  system_prompt: z.string().optional(),
  auto_restart: z.boolean().optional(),
  count: z.number().min(1).max(10).optional(),
});

const MissionSchema = z.object({
  action: z.enum(['distribute', 'complete', 'fail', 'cancel', 'status', 'optimize', 'rebalance', 'bottlenecks', 'auto_optimize', 'execute_rebalance']),
  mission_id: z.string().optional(),
  prompt: z.string().optional(),
  context: z.string().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  type: z.enum(['extraction', 'analysis', 'synthesis', 'review', 'general']).optional(),
  timeout_ms: z.number().optional(),
  max_retries: z.number().optional(),
  depends_on: z.array(z.string()).optional(),
  output: z.string().optional(),
  duration_ms: z.number().optional(),
  token_usage: z.object({ input: z.number(), output: z.number() }).optional(),
  error_code: z.enum(['timeout', 'crash', 'validation', 'resource', 'auth', 'rate_limit', 'unknown']).optional(),
  message: z.string().optional(),
  recoverable: z.boolean().optional(),
  apply: z.boolean().optional(), // For optimize action - apply suggested changes
});

// ============ Tool Definitions ============

export const ptyTools: ToolDefinition[] = [
  {
    name: 'agent',
    description: 'Agent ops',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['spawn', 'spawn_pool', 'kill', 'restart', 'health', 'health_all', 'status'] },
        agent_id: { type: 'number' },
        role: { type: 'string', enum: [...ROLES] },
        model: { type: 'string', enum: [...MODELS] },
        system_prompt: { type: 'string' },
        auto_restart: { type: 'boolean' },
        count: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'mission',
    description: 'Mission ops',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['distribute', 'complete', 'fail', 'cancel', 'status', 'optimize', 'rebalance', 'bottlenecks', 'auto_optimize', 'execute_rebalance'] },
        mission_id: { type: 'string' },
        prompt: { type: 'string' },
        context: { type: 'string' },
        priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
        type: { type: 'string', enum: ['extraction', 'analysis', 'synthesis', 'review', 'general'] },
        timeout_ms: { type: 'number' },
        max_retries: { type: 'number' },
        depends_on: { type: 'array', items: { type: 'string' } },
        output: { type: 'string' },
        error_code: { type: 'string', enum: ['timeout', 'crash', 'validation', 'resource', 'auth', 'rate_limit', 'unknown'] },
        message: { type: 'string' },
        apply: { type: 'boolean' },
      },
      required: ['action'],
    },
  },
];

// ============ Agent Handler ============

async function handleAgent(args: unknown): Promise<MCPResponse> {
  const parsed = AgentSchema.parse(args);
  const { action, agent_id } = parsed;

  // Validate agent_id requirement
  if (['kill', 'restart', 'health'].includes(action) && agent_id === undefined) {
    return errorResponse(`agent_id required for action: ${action}`);
  }

  try {
    switch (action) {
      case 'spawn': {
        const spawner = getAgentSpawner();
        const agent = await spawner.spawnAgent({
          role: parsed.role as AgentRole,
          model: parsed.model as ModelTier,
          systemPrompt: parsed.system_prompt,
          autoRestart: parsed.auto_restart,
        });
        return jsonResponse({
          agent_id: agent.id,
          name: agent.name,
          role: agent.role,
          model: agent.model,
          status: agent.status,
          created_at: agent.createdAt.toISOString(),
        });
      }

      case 'spawn_pool': {
        const count = parsed.count || 1;
        const spawner = getAgentSpawner();
        const agents = await spawner.spawnPool(count, {
          role: parsed.role as AgentRole,
          model: parsed.model as ModelTier,
        });
        return jsonResponse({
          spawned: agents.length,
          agents: agents.map(a => ({
            agent_id: a.id,
            name: a.name,
            role: a.role,
            model: a.model,
            status: a.status,
          })),
        });
      }

      case 'kill': {
        const ptyManager = getPTYManager();
        await ptyManager.kill(agent_id!);
        return jsonResponse({ killed: true, agent_id });
      }

      case 'restart': {
        const ptyManager = getPTYManager();
        const handle = await ptyManager.restart(agent_id!);
        return jsonResponse({
          restarted: true,
          agent_id,
          new_pid: handle.pid,
          pane_id: handle.paneId,
        });
      }

      case 'health': {
        const ptyManager = getPTYManager();
        const health = await ptyManager.healthCheck(agent_id!);
        return jsonResponse({
          agent_id,
          ...health,
          last_heartbeat: health.lastHeartbeat.toISOString(),
        });
      }

      case 'health_all': {
        const ptyManager = getPTYManager();
        const handles = ptyManager.getAllHandles();
        const healthResults: Record<number, any> = {};

        for (const handle of handles) {
          try {
            const health = await ptyManager.healthCheck(handle.agentId);
            healthResults[handle.agentId] = {
              ...health,
              last_heartbeat: health.lastHeartbeat.toISOString(),
            };
          } catch (error) {
            healthResults[handle.agentId] = {
              alive: false,
              responsive: false,
              error: String(error),
            };
          }
        }
        return jsonResponse({ agent_count: handles.length, health: healthResults });
      }

      case 'status': {
        const spawner = getAgentSpawner();
        const agents = spawner.getAllAgents();
        return jsonResponse({
          total_agents: agents.length,
          active_agents: spawner.getActiveAgents().length,
          agents: agents.map(a => ({
            id: a.id,
            name: a.name,
            role: a.role,
            model: a.model,
            status: a.status,
            current_task: a.currentTaskId,
            tasks_completed: a.tasksCompleted,
            tasks_failed: a.tasksFailed,
            success_rate: a.tasksCompleted + a.tasksFailed > 0
              ? (a.tasksCompleted / (a.tasksCompleted + a.tasksFailed) * 100).toFixed(1) + '%'
              : 'N/A',
            created_at: a.createdAt.toISOString(),
          })),
          by_role: Object.fromEntries(
            ROLES.map(role => [role, spawner.getSpecialists(role as AgentRole).length])
          ),
          by_model: {
            haiku: spawner.getAgentsByModel('haiku').length,
            sonnet: spawner.getAgentsByModel('sonnet').length,
            opus: spawner.getAgentsByModel('opus').length,
          },
        });
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (error) {
    return errorResponse(`Agent ${action} failed: ${error}`);
  }
}

// ============ Mission Handler ============

async function handleMission(args: unknown): Promise<MCPResponse> {
  const parsed = MissionSchema.parse(args);
  const { action } = parsed;

  try {
    switch (action) {
      case 'distribute': {
        if (!parsed.prompt) {
          return errorResponse('prompt required for distribute action');
        }
        const queue = getMissionQueue();
        const spawner = getAgentSpawner();

        const task: Task = {
          id: `task_${Date.now()}`,
          prompt: parsed.prompt,
          context: parsed.context,
          priority: (parsed.priority || 'normal') as Priority,
          type: parsed.type,
        };

        const modelTier = selectModel(task);

        // Suggest relevant learnings for context enrichment
        let suggestedLearnings: string[] = [];
        try {
          const loop = getLearningLoop();
          const learnings = await loop.suggestLearnings({ prompt: parsed.prompt });
          suggestedLearnings = learnings.map(l => l.title);
        } catch { /* Learning suggestions are best-effort */ }

        const missionId = queue.enqueue({
          prompt: parsed.prompt,
          context: parsed.context,
          priority: (parsed.priority || 'normal') as Priority,
          type: parsed.type,
          timeoutMs: parsed.timeout_ms || 120000,
          maxRetries: parsed.max_retries || 3,
          dependsOn: parsed.depends_on,
        });

        let assignedAgent = null;
        let selectionMethod = 'none';
        try {
          // Use Oracle for intelligent agent selection
          const oracle = getOracleOrchestrator();
          const agent = oracle.recommendAgentForTask(parsed.type, task.priority);

          if (agent) {
            selectionMethod = 'oracle';
            const mission = queue.dequeue(agent.id);
            if (mission) {
              assignedAgent = {
                id: agent.id,
                name: agent.name,
                role: agent.role,
                model: agent.model,
              };
            }
          }
        } catch { /* No agents available */ }

        return jsonResponse({
          mission_id: missionId,
          model_tier: modelTier,
          status: assignedAgent ? 'assigned' : 'queued',
          assigned_agent: assignedAgent,
          selection_method: assignedAgent ? selectionMethod : undefined,
          queue_length: queue.getQueueLength(),
          suggested_learnings: suggestedLearnings.length > 0 ? suggestedLearnings : undefined,
        });
      }

      case 'complete': {
        if (!parsed.mission_id || !parsed.output) {
          return errorResponse('mission_id and output required for complete action');
        }
        const queue = getMissionQueue();
        const spawner = getAgentSpawner();

        const mission = queue.getMission(parsed.mission_id);
        if (!mission) {
          return errorResponse(`Mission not found: ${parsed.mission_id}`);
        }

        queue.complete(parsed.mission_id, {
          output: parsed.output,
          durationMs: parsed.duration_ms || 0,
          tokenUsage: parsed.token_usage,
        });

        if (mission.assignedTo) {
          spawner.completeTask(parsed.mission_id, true);

          // Auto-merge worktree if agent has one
          try {
            const worktreeManager = getWorktreeManager();
            const worktree = worktreeManager.getWorktree(mission.assignedTo);
            if (worktree && worktree.status === 'active') {
              const mergeResult = await worktreeManager.merge(mission.assignedTo);
              if (mergeResult.success) {
                await worktreeManager.cleanup(mission.assignedTo);
              }
            }
          } catch { /* Worktree merge is best-effort */ }
        }

        // Harvest learnings from completed mission
        let harvestedLearnings: number = 0;
        try {
          const loop = getLearningLoop();
          const completedMission = {
            ...mission,
            status: 'completed' as const,
            result: { output: parsed.output, durationMs: parsed.duration_ms || 0 },
            completedAt: new Date(),
          };
          const learnings = await loop.harvestFromMission(completedMission);
          harvestedLearnings = learnings.length;
        } catch { /* Learning harvest is best-effort */ }

        return jsonResponse({
          completed: true,
          mission_id: parsed.mission_id,
          agent_id: mission.assignedTo,
          harvested_learnings: harvestedLearnings > 0 ? harvestedLearnings : undefined,
        });
      }

      case 'fail': {
        if (!parsed.mission_id || !parsed.error_code || !parsed.message) {
          return errorResponse('mission_id, error_code, and message required for fail action');
        }
        const queue = getMissionQueue();
        const spawner = getAgentSpawner();

        const mission = queue.getMission(parsed.mission_id);
        if (!mission) {
          return errorResponse(`Mission not found: ${parsed.mission_id}`);
        }

        const { isRecoverable } = await import('../../../interfaces/mission');
        const recoverable = parsed.recoverable ?? isRecoverable(parsed.error_code);

        queue.fail(parsed.mission_id, {
          code: parsed.error_code,
          message: parsed.message,
          recoverable,
          timestamp: new Date(),
        });

        if (mission.assignedTo) {
          spawner.completeTask(parsed.mission_id, false);
        }

        // Analyze failure and extract lessons
        let failureAnalysis: { rootCause: string; category: string; suggestion: string; similarFailures: string[] } | null = null;
        try {
          const loop = getLearningLoop();
          const failedMission = {
            id: mission.id,
            prompt: mission.prompt,
            type: mission.type,
            assignedTo: mission.assignedTo,
            status: 'failed' as const,
            error: {
              code: parsed.error_code!,
              message: parsed.message!,
              recoverable,
              timestamp: new Date(),
            },
            createdAt: mission.createdAt,
          };
          failureAnalysis = await loop.analyzeFailure(failedMission);
        } catch { /* Analysis is best-effort */ }

        const updatedMission = queue.getMission(parsed.mission_id);

        return jsonResponse({
          failed: updatedMission?.status === 'failed',
          retrying: updatedMission?.status === 'retrying',
          mission_id: parsed.mission_id,
          retry_count: updatedMission?.retryCount || 0,
          max_retries: mission.maxRetries,
          failure_analysis: failureAnalysis ? {
            root_cause: failureAnalysis.rootCause,
            category: failureAnalysis.category,
            suggestion: failureAnalysis.suggestion,
            similar_failures: failureAnalysis.similarFailures?.length || 0,
          } : undefined,
        });
      }

      case 'cancel': {
        if (!parsed.mission_id) {
          return errorResponse('mission_id required for cancel action');
        }
        const queue = getMissionQueue();
        const mission = queue.getMission(parsed.mission_id);
        if (!mission) {
          return errorResponse(`Mission not found: ${parsed.mission_id}`);
        }
        if (mission.status === 'completed' || mission.status === 'failed') {
          return errorResponse(`Cannot cancel ${mission.status} mission`);
        }
        queue.updateStatus(parsed.mission_id, 'cancelled');
        return jsonResponse({
          cancelled: true,
          mission_id: parsed.mission_id,
          previous_status: mission.status,
        });
      }

      case 'status': {
        const queue = getMissionQueue();
        const missions = queue.getAllMissions();

        const byStatus = {
          pending: missions.filter(m => m.status === 'pending').length,
          queued: missions.filter(m => m.status === 'queued').length,
          running: missions.filter(m => m.status === 'running').length,
          completed: missions.filter(m => m.status === 'completed').length,
          failed: missions.filter(m => m.status === 'failed').length,
          retrying: missions.filter(m => m.status === 'retrying').length,
          blocked: missions.filter(m => m.status === 'blocked').length,
        };

        return jsonResponse({
          queue_length: queue.getQueueLength(),
          average_wait_time_ms: queue.getAverageWaitTime(),
          by_status: byStatus,
          blocked_missions: queue.getBlocked().map(m => ({
            id: m.id,
            prompt: m.prompt.substring(0, 50) + (m.prompt.length > 50 ? '...' : ''),
            depends_on: m.dependsOn,
          })),
        });
      }

      case 'optimize': {
        const oracle = getOracleOrchestrator();
        const adjustments = oracle.optimizeMissionQueue();
        const insights = await oracle.getEfficiencyInsights();

        let applied = 0;
        if (parsed.apply && adjustments.length > 0) {
          applied = oracle.applyPriorityAdjustments(adjustments);
        }

        return jsonResponse({
          priority_adjustments: adjustments.map(a => ({
            mission_id: a.missionId,
            current: a.currentPriority,
            suggested: a.suggestedPriority,
            reason: a.reason,
          })),
          efficiency_insights: insights.map(i => ({
            category: i.category,
            title: i.title,
            description: i.description,
            impact: i.impact,
            actionable: i.actionable,
          })),
          applied: parsed.apply ? applied : undefined,
          hint: !parsed.apply && adjustments.length > 0
            ? 'Use apply: true to apply suggested priority adjustments'
            : undefined,
        });
      }

      case 'rebalance': {
        const oracle = getOracleOrchestrator();
        const analysis = oracle.analyzeWorkload();
        const suggestions = oracle.suggestRebalancing();

        return jsonResponse({
          workload: {
            total_agents: analysis.totalAgents,
            active: analysis.activeAgents,
            idle: analysis.idleAgents,
            overloaded: analysis.overloadedAgents,
            underutilized: analysis.underutilizedAgents,
            average_success_rate: `${(analysis.averageSuccessRate * 100).toFixed(1)}%`,
            bottleneck_roles: analysis.bottleneckRoles,
          },
          role_distribution: analysis.roleDistribution,
          model_distribution: analysis.modelDistribution,
          suggestions: suggestions.map(s => ({
            type: s.type,
            agent_id: s.agentId,
            target_role: s.targetRole,
            reason: s.reason,
            priority: s.priority,
          })),
          agent_metrics: analysis.agentMetrics.map(m => ({
            agent_id: m.agentId,
            name: m.name,
            role: m.role,
            model: m.model,
            status: m.status,
            success_rate: `${(m.successRate * 100).toFixed(1)}%`,
            utilization: `${(m.utilizationScore * 100).toFixed(0)}%`,
          })),
        });
      }

      case 'bottlenecks': {
        const oracle = getOracleOrchestrator();
        const bottlenecks = oracle.identifyBottlenecks();

        return jsonResponse({
          count: bottlenecks.length,
          bottlenecks: bottlenecks.map(b => ({
            type: b.type,
            description: b.description,
            severity: b.severity,
            affected_missions: b.affectedMissions.length,
            suggested_action: b.suggestedAction,
          })),
          summary: bottlenecks.length === 0
            ? 'No bottlenecks detected'
            : `${bottlenecks.filter(b => b.severity === 'critical').length} critical, ${bottlenecks.filter(b => b.severity === 'high').length} high severity`,
        });
      }

      case 'auto_optimize': {
        const oracle = getOracleOrchestrator();
        const result = await oracle.autoOptimize();

        return jsonResponse({
          success: true,
          summary: {
            bottlenecks_found: result.bottlenecksFound,
            critical_bottlenecks: result.criticalBottlenecks,
            priorities_adjusted: result.prioritiesAdjusted,
            agents_spawned: result.agentsSpawned,
            agents_reassigned: result.agentsReassigned,
            agents_retired: result.agentsRetired,
            actions_failed: result.actionsFailed,
          },
          insights: result.insights.map(i => ({
            category: i.category,
            title: i.title,
            impact: i.impact,
          })),
          message: result.agentsSpawned + result.agentsReassigned > 0
            ? `Auto-optimized: spawned ${result.agentsSpawned}, reassigned ${result.agentsReassigned} agents`
            : 'No immediate actions needed',
        });
      }

      case 'execute_rebalance': {
        const oracle = getOracleOrchestrator();
        const result = await oracle.executeRebalancing();

        return jsonResponse({
          success: result.failed.length === 0,
          spawned: result.spawned.map(s => ({
            agent_id: s.agentId,
            role: s.role,
            model: s.model,
          })),
          reassigned: result.reassigned.map(r => ({
            agent_id: r.agentId,
            new_role: r.newRole,
          })),
          retired: result.retired.map(r => ({
            agent_id: r.agentId,
            role: r.role,
            reason: r.reason,
          })),
          failed: result.failed.map(f => ({
            action_type: f.action.type,
            target_role: f.action.targetRole,
            error: f.error,
          })),
          summary: `Spawned: ${result.spawned.length}, Reassigned: ${result.reassigned.length}, Retired: ${result.retired.length}, Failed: ${result.failed.length}`,
        });
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (error) {
    return errorResponse(`Mission ${action} failed: ${error}`);
  }
}

// ============ Export ============

export const ptyHandlers: Record<string, ToolHandler> = {
  agent: handleAgent,
  mission: handleMission,
};
