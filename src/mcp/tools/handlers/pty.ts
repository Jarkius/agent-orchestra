/**
 * PTY Orchestration Tools
 * MCP tools for Expert Multi-Agent Orchestration System
 *
 * Provides:
 * - spawn_agent: Spawn a new agent with role and model tier
 * - spawn_pool: Spawn multiple agents
 * - kill_agent: Terminate an agent
 * - restart_agent: Restart a crashed agent
 * - get_agent_health: Check agent health status
 * - distribute_mission: Distribute a mission to best agent
 * - get_agent_status: Get status of all agents
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler, MCPResponse } from '../../types';
import { jsonResponse, errorResponse } from '../../utils/response';
import { AgentSpawner, getAgentSpawner } from '../../../pty/spawner';
import { MissionQueue, getMissionQueue } from '../../../pty/mission-queue';
import { getPTYManager } from '../../../pty/manager';
import { selectModel, ROLE_PROMPTS } from '../../../interfaces/spawner';
import type { AgentRole, ModelTier, Task } from '../../../interfaces/spawner';
import type { Priority } from '../../../interfaces/mission';

// ============ Schemas ============

const SpawnAgentSchema = z.object({
  role: z.enum(['coder', 'tester', 'analyst', 'reviewer', 'generalist', 'oracle', 'architect', 'debugger', 'researcher', 'scribe']).optional(),
  model: z.enum(['haiku', 'sonnet', 'opus']).optional(),
  system_prompt: z.string().optional(),
  auto_restart: z.boolean().optional(),
});

const SpawnPoolSchema = z.object({
  count: z.number().min(1).max(10),
  role: z.enum(['coder', 'tester', 'analyst', 'reviewer', 'generalist', 'oracle', 'architect', 'debugger', 'researcher', 'scribe']).optional(),
  model: z.enum(['haiku', 'sonnet', 'opus']).optional(),
});

const AgentIdSchema = z.object({
  agent_id: z.number(),
});

const DistributeMissionSchema = z.object({
  prompt: z.string(),
  context: z.string().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  type: z.enum(['extraction', 'analysis', 'synthesis', 'review', 'general']).optional(),
  timeout_ms: z.number().optional(),
  max_retries: z.number().optional(),
  depends_on: z.array(z.string()).optional(),
});

const CompleteMissionSchema = z.object({
  mission_id: z.string(),
  output: z.string(),
  duration_ms: z.number().optional(),
  token_usage: z.object({
    input: z.number(),
    output: z.number(),
  }).optional(),
});

const FailMissionSchema = z.object({
  mission_id: z.string(),
  error_code: z.enum(['timeout', 'crash', 'validation', 'resource', 'auth', 'rate_limit', 'unknown']),
  message: z.string(),
  recoverable: z.boolean().optional(),
});

// ============ Tool Definitions ============

export const ptyTools: ToolDefinition[] = [
  {
    name: 'spawn_agent',
    description: 'Spawn a new Claude agent with optional role and model tier. Returns agent details.',
    inputSchema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          enum: ['coder', 'tester', 'analyst', 'reviewer', 'generalist', 'oracle', 'architect', 'debugger', 'researcher', 'scribe'],
          description: 'Agent specialization role (default: generalist)',
        },
        model: {
          type: 'string',
          enum: ['haiku', 'sonnet', 'opus'],
          description: 'Model tier for the agent (default: sonnet)',
        },
        system_prompt: {
          type: 'string',
          description: 'Custom system prompt (default: role-based prompt)',
        },
        auto_restart: {
          type: 'boolean',
          description: 'Auto-restart on crash (default: true)',
        },
      },
    },
  },
  {
    name: 'spawn_pool',
    description: 'Spawn multiple agents with the same configuration. Returns array of agent details.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of agents to spawn (1-10)',
        },
        role: {
          type: 'string',
          enum: ['coder', 'tester', 'analyst', 'reviewer', 'generalist', 'oracle', 'architect', 'debugger', 'researcher', 'scribe'],
          description: 'Agent specialization role (default: generalist)',
        },
        model: {
          type: 'string',
          enum: ['haiku', 'sonnet', 'opus'],
          description: 'Model tier for agents (default: sonnet)',
        },
      },
      required: ['count'],
    },
  },
  {
    name: 'kill_agent',
    description: 'Terminate an agent by ID',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'number',
          description: 'Agent ID to terminate',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'restart_agent',
    description: 'Restart an agent by ID',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'number',
          description: 'Agent ID to restart',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_health',
    description: 'Check health status of an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'number',
          description: 'Agent ID to check',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_all_agent_health',
    description: 'Check health status of all agents',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'distribute_mission',
    description: 'Distribute a mission to the best available agent based on type and priority',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Mission prompt/instructions',
        },
        context: {
          type: 'string',
          description: 'Additional context for the mission',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'normal', 'low'],
          description: 'Mission priority (default: normal)',
        },
        type: {
          type: 'string',
          enum: ['extraction', 'analysis', 'synthesis', 'review', 'general'],
          description: 'Mission type for model selection (default: general)',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 120000)',
        },
        max_retries: {
          type: 'number',
          description: 'Maximum retry attempts (default: 3)',
        },
        depends_on: {
          type: 'array',
          items: { type: 'string' },
          description: 'Mission IDs this depends on',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'complete_mission',
    description: 'Mark a mission as completed with result',
    inputSchema: {
      type: 'object',
      properties: {
        mission_id: {
          type: 'string',
          description: 'Mission ID to complete',
        },
        output: {
          type: 'string',
          description: 'Mission output/result',
        },
        duration_ms: {
          type: 'number',
          description: 'Duration in milliseconds',
        },
        token_usage: {
          type: 'object',
          properties: {
            input: { type: 'number' },
            output: { type: 'number' },
          },
          description: 'Token usage statistics',
        },
      },
      required: ['mission_id', 'output'],
    },
  },
  {
    name: 'fail_mission',
    description: 'Mark a mission as failed with error details',
    inputSchema: {
      type: 'object',
      properties: {
        mission_id: {
          type: 'string',
          description: 'Mission ID that failed',
        },
        error_code: {
          type: 'string',
          enum: ['timeout', 'crash', 'validation', 'resource', 'auth', 'rate_limit', 'unknown'],
          description: 'Error classification',
        },
        message: {
          type: 'string',
          description: 'Error message',
        },
        recoverable: {
          type: 'boolean',
          description: 'Whether the error is recoverable (default: auto-detected)',
        },
      },
      required: ['mission_id', 'error_code', 'message'],
    },
  },
  {
    name: 'get_mission_queue_status',
    description: 'Get status of the mission queue',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_agent_status',
    description: 'Get status of all spawned agents',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ============ Handlers ============

async function handleSpawnAgent(args: unknown): Promise<MCPResponse> {
  const parsed = SpawnAgentSchema.parse(args);
  const spawner = getAgentSpawner();

  try {
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
      system_prompt: parsed.system_prompt || ROLE_PROMPTS[agent.role],
    });
  } catch (error) {
    return errorResponse(`Failed to spawn agent: ${error}`);
  }
}

async function handleSpawnPool(args: unknown): Promise<MCPResponse> {
  const parsed = SpawnPoolSchema.parse(args);
  const spawner = getAgentSpawner();

  try {
    const agents = await spawner.spawnPool(parsed.count, {
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
  } catch (error) {
    return errorResponse(`Failed to spawn pool: ${error}`);
  }
}

async function handleKillAgent(args: unknown): Promise<MCPResponse> {
  const parsed = AgentIdSchema.parse(args);
  const ptyManager = getPTYManager();

  try {
    await ptyManager.kill(parsed.agent_id);
    return jsonResponse({ killed: true, agent_id: parsed.agent_id });
  } catch (error) {
    return errorResponse(`Failed to kill agent: ${error}`);
  }
}

async function handleRestartAgent(args: unknown): Promise<MCPResponse> {
  const parsed = AgentIdSchema.parse(args);
  const ptyManager = getPTYManager();

  try {
    const handle = await ptyManager.restart(parsed.agent_id);
    return jsonResponse({
      restarted: true,
      agent_id: parsed.agent_id,
      new_pid: handle.pid,
      pane_id: handle.paneId,
    });
  } catch (error) {
    return errorResponse(`Failed to restart agent: ${error}`);
  }
}

async function handleGetAgentHealth(args: unknown): Promise<MCPResponse> {
  const parsed = AgentIdSchema.parse(args);
  const ptyManager = getPTYManager();

  try {
    const health = await ptyManager.healthCheck(parsed.agent_id);
    return jsonResponse({
      agent_id: parsed.agent_id,
      ...health,
      last_heartbeat: health.lastHeartbeat.toISOString(),
    });
  } catch (error) {
    return errorResponse(`Failed to check health: ${error}`);
  }
}

async function handleGetAllAgentHealth(): Promise<MCPResponse> {
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

  return jsonResponse({
    agent_count: handles.length,
    health: healthResults,
  });
}

async function handleDistributeMission(args: unknown): Promise<MCPResponse> {
  const parsed = DistributeMissionSchema.parse(args);
  const queue = getMissionQueue();
  const spawner = getAgentSpawner();

  // Create task for model selection
  const task: Task = {
    id: `task_${Date.now()}`,
    prompt: parsed.prompt,
    context: parsed.context,
    priority: (parsed.priority || 'normal') as Priority,
    type: parsed.type,
  };

  // Determine model tier
  const modelTier = selectModel(task);

  // Enqueue mission
  const missionId = queue.enqueue({
    prompt: parsed.prompt,
    context: parsed.context,
    priority: (parsed.priority || 'normal') as Priority,
    type: parsed.type,
    timeoutMs: parsed.timeout_ms || 120000,
    maxRetries: parsed.max_retries || 3,
    dependsOn: parsed.depends_on,
  });

  // Try to assign to an agent
  let assignedAgent = null;
  try {
    const agent = spawner.getAvailableAgent(parsed.type);
    if (agent) {
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
  } catch {
    // No agents available, mission stays in queue
  }

  return jsonResponse({
    mission_id: missionId,
    model_tier: modelTier,
    status: assignedAgent ? 'assigned' : 'queued',
    assigned_agent: assignedAgent,
    queue_length: queue.getQueueLength(),
  });
}

async function handleCompleteMission(args: unknown): Promise<MCPResponse> {
  const parsed = CompleteMissionSchema.parse(args);
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

  // Update agent stats
  if (mission.assignedTo) {
    spawner.completeTask(parsed.mission_id, true);
  }

  return jsonResponse({
    completed: true,
    mission_id: parsed.mission_id,
    agent_id: mission.assignedTo,
  });
}

async function handleFailMission(args: unknown): Promise<MCPResponse> {
  const parsed = FailMissionSchema.parse(args);
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

  // Update agent stats
  if (mission.assignedTo) {
    spawner.completeTask(parsed.mission_id, false);
  }

  const updatedMission = queue.getMission(parsed.mission_id);

  return jsonResponse({
    failed: updatedMission?.status === 'failed',
    retrying: updatedMission?.status === 'retrying',
    mission_id: parsed.mission_id,
    retry_count: updatedMission?.retryCount || 0,
    max_retries: mission.maxRetries,
  });
}

async function handleGetMissionQueueStatus(): Promise<MCPResponse> {
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

async function handleGetAgentStatus(): Promise<MCPResponse> {
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
      ['coder', 'tester', 'analyst', 'reviewer', 'generalist', 'oracle', 'architect', 'debugger', 'researcher', 'scribe']
        .map(role => [role, spawner.getSpecialists(role as AgentRole).length])
    ),
    by_model: {
      haiku: spawner.getAgentsByModel('haiku').length,
      sonnet: spawner.getAgentsByModel('sonnet').length,
      opus: spawner.getAgentsByModel('opus').length,
    },
  });
}

// ============ Export ============

export const ptyHandlers: Record<string, ToolHandler> = {
  spawn_agent: handleSpawnAgent,
  spawn_pool: handleSpawnPool,
  kill_agent: handleKillAgent,
  restart_agent: handleRestartAgent,
  get_agent_health: handleGetAgentHealth,
  get_all_agent_health: handleGetAllAgentHealth,
  distribute_mission: handleDistributeMission,
  complete_mission: handleCompleteMission,
  fail_mission: handleFailMission,
  get_mission_queue_status: handleGetMissionQueueStatus,
  get_agent_status: handleGetAgentStatus,
};
