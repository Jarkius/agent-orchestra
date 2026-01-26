/**
 * Oracle Orchestrator - Intelligent workflow coordination
 * Provides workload analysis, agent rebalancing, and mission optimization
 */

import { getAgentSpawner, AgentSpawner } from '../pty/spawner';
import { getMissionQueue, MissionQueue } from '../pty/mission-queue';
import { getLearningLoop, LearningLoop } from '../learning/loop';
import type { Agent, AgentRole, ModelTier } from '../interfaces/spawner';
import type { Mission, Priority } from '../interfaces/mission';
import type { Pattern } from '../interfaces/learning';

// ============ Types ============

export interface AgentLoadMetrics {
  agentId: number;
  name: string;
  role: AgentRole;
  model: ModelTier;
  status: Agent['status'];
  tasksCompleted: number;
  tasksFailed: number;
  successRate: number;
  utilizationScore: number; // 0-1, based on completed tasks relative to others
}

export interface WorkloadAnalysis {
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
  overloadedAgents: number;
  underutilizedAgents: number;
  agentMetrics: AgentLoadMetrics[];
  roleDistribution: Record<AgentRole, number>;
  modelDistribution: Record<ModelTier, number>;
  averageSuccessRate: number;
  bottleneckRoles: AgentRole[];
}

export interface RebalanceAction {
  type: 'spawn' | 'reassign' | 'retire';
  agentId?: number;
  targetRole: AgentRole;
  reason: string;
  priority: 'high' | 'normal' | 'low';
}

export interface PriorityAdjustment {
  missionId: string;
  currentPriority: Priority;
  suggestedPriority: Priority;
  reason: string;
}

export interface Bottleneck {
  type: 'role_shortage' | 'queue_backup' | 'failure_spike' | 'dependency_chain';
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  affectedMissions: string[];
  suggestedAction: string;
}

export interface EfficiencyInsight {
  category: 'performance' | 'resource' | 'workflow';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  actionable: boolean;
}

// ============ Proactive Spawning Types ============

export interface SpawnTriggers {
  queueGrowthRate: number;      // Tasks added per minute
  queueDepthThreshold: number;  // Absolute queue size trigger
  idleAgentMinimum: number;     // Min idle agents to maintain per active role
  taskComplexityBacklog: number; // Complex tasks waiting threshold
}

export interface TaskComplexity {
  tier: 'simple' | 'moderate' | 'complex';
  recommendedModel: 'haiku' | 'sonnet' | 'opus';
  reasoning: string;
  signals: string[];
}

export interface ProactiveSpawnDecision {
  shouldSpawn: boolean;
  reason: string;
  suggestedRole: AgentRole;
  suggestedModel: ModelTier;
  urgency: 'immediate' | 'soon' | 'optional';
}

export interface QueueSnapshot {
  timestamp: number;
  depth: number;
}

const DEFAULT_SPAWN_TRIGGERS: SpawnTriggers = {
  queueGrowthRate: 5,        // Spawn if > 5 tasks/min added
  queueDepthThreshold: 5,    // Spawn if queue > 5 with no idle
  idleAgentMinimum: 1,       // Maintain 1 idle per active role
  taskComplexityBacklog: 3,  // Spawn opus if 3+ complex tasks waiting
};

export interface RebalanceResult {
  spawned: Array<{ agentId: number; role: AgentRole; model: ModelTier }>;
  reassigned: Array<{ agentId: number; newRole: AgentRole }>;
  retired: Array<{ agentId: number; role: AgentRole; reason: string }>;
  failed: Array<{ action: RebalanceAction; error: string }>;
}

export interface AutoOptimizeResult {
  bottlenecksFound: number;
  criticalBottlenecks: number;
  prioritiesAdjusted: number;
  agentsSpawned: number;
  agentsReassigned: number;
  agentsRetired: number;
  actionsFailed: number;
  insights: EfficiencyInsight[];
  // Proactive spawning results
  proactiveDecisions: number;
  proactiveSpawned: number;
  queueGrowthRate: number;
}

// ============ Oracle Orchestrator ============

export class OracleOrchestrator {
  private spawner: AgentSpawner;
  private queue: MissionQueue;
  private learningLoop: LearningLoop;

  // Proactive spawning state
  private queueHistory: QueueSnapshot[] = [];
  private spawnTriggers: SpawnTriggers = DEFAULT_SPAWN_TRIGGERS;
  private readonly HISTORY_WINDOW_MS = 120000; // 2-minute rolling window

  constructor() {
    this.spawner = getAgentSpawner();
    this.queue = getMissionQueue();
    this.learningLoop = getLearningLoop();
  }

  /**
   * Configure spawn triggers
   */
  setSpawnTriggers(triggers: Partial<SpawnTriggers>): void {
    this.spawnTriggers = { ...this.spawnTriggers, ...triggers };
  }

  /**
   * Record current queue state for growth tracking
   */
  recordQueueSnapshot(): void {
    const now = Date.now();
    this.queueHistory.push({
      timestamp: now,
      depth: this.queue.getQueueLength(),
    });

    // Prune old history
    this.queueHistory = this.queueHistory.filter(
      s => now - s.timestamp < this.HISTORY_WINDOW_MS
    );
  }

  /**
   * Calculate queue growth rate (tasks per minute)
   */
  getQueueGrowthRate(): number {
    if (this.queueHistory.length < 2) return 0;

    const oldest = this.queueHistory[0]!;
    const newest = this.queueHistory[this.queueHistory.length - 1]!;

    const timeDiffMs = newest.timestamp - oldest.timestamp;
    if (timeDiffMs < 1000) return 0; // Need at least 1 second of data

    const depthDiff = newest.depth - oldest.depth;
    const timeDiffMinutes = timeDiffMs / 60000;

    return depthDiff / timeDiffMinutes;
  }

  /**
   * Analyze task complexity to determine required model tier
   */
  analyzeTaskComplexity(prompt: string, context?: string): TaskComplexity {
    const signals: string[] = [];
    const fullText = `${prompt} ${context || ''}`.toLowerCase();

    // Complex signals → Opus
    const complexSignals = [
      { pattern: /architect|design.*system|design.*pattern/i, signal: 'architecture' },
      { pattern: /refactor.*multiple|cross.?file|multi.?file/i, signal: 'multi-file-refactor' },
      { pattern: /implement.*from.*scratch|build.*new.*system/i, signal: 'greenfield-implementation' },
      { pattern: /optimize.*algorithm|performance.*critical/i, signal: 'algorithm-optimization' },
      { pattern: /security.*audit|vulnerability.*analysis/i, signal: 'security-analysis' },
      { pattern: /debug.*complex|investigate.*intermittent|intermittent|debug.*flaky|debug.*race/i, signal: 'complex-debugging' },
      { pattern: /design.*decision|trade.?off.*analysis/i, signal: 'design-decision' },
    ];

    // Moderate signals → Sonnet
    const moderateSignals = [
      { pattern: /implement|create|build|add.*feature/i, signal: 'feature-implementation' },
      { pattern: /fix.*bug|resolve.*issue/i, signal: 'bug-fix' },
      { pattern: /write.*test|add.*test/i, signal: 'testing' },
      { pattern: /review.*code|code.*review/i, signal: 'code-review' },
      { pattern: /update|modify|change/i, signal: 'modification' },
    ];

    // Simple signals → Haiku
    const simpleSignals = [
      { pattern: /read.*file|list.*files|find.*file/i, signal: 'file-read' },
      { pattern: /search.*for|grep|look.*up/i, signal: 'search' },
      { pattern: /format|lint|prettify/i, signal: 'formatting' },
      { pattern: /rename|move.*file/i, signal: 'simple-refactor' },
      { pattern: /summarize|explain.*briefly/i, signal: 'summarization' },
    ];

    // Check for complex signals first
    for (const { pattern, signal } of complexSignals) {
      if (pattern.test(fullText)) {
        signals.push(signal);
      }
    }

    if (signals.length > 0) {
      return {
        tier: 'complex',
        recommendedModel: 'opus',
        reasoning: `Task requires deep reasoning: ${signals.join(', ')}`,
        signals,
      };
    }

    // Check for moderate signals
    for (const { pattern, signal } of moderateSignals) {
      if (pattern.test(fullText)) {
        signals.push(signal);
      }
    }

    if (signals.length > 0) {
      return {
        tier: 'moderate',
        recommendedModel: 'sonnet',
        reasoning: `Standard development task: ${signals.join(', ')}`,
        signals,
      };
    }

    // Check for simple signals
    for (const { pattern, signal } of simpleSignals) {
      if (pattern.test(fullText)) {
        signals.push(signal);
      }
    }

    if (signals.length > 0) {
      return {
        tier: 'simple',
        recommendedModel: 'haiku',
        reasoning: `Simple, well-defined task: ${signals.join(', ')}`,
        signals,
      };
    }

    // Default to sonnet for unclear tasks
    return {
      tier: 'moderate',
      recommendedModel: 'sonnet',
      reasoning: 'No clear complexity signals, defaulting to balanced model',
      signals: ['unknown'],
    };
  }

  /**
   * Evaluate proactive spawn decisions based on current state
   */
  evaluateProactiveSpawning(): ProactiveSpawnDecision[] {
    const decisions: ProactiveSpawnDecision[] = [];
    const analysis = this.analyzeWorkload();
    const queuedMissions = this.queue.getByStatus('queued');

    // Record snapshot for growth tracking
    this.recordQueueSnapshot();
    const growthRate = this.getQueueGrowthRate();

    // Trigger 1: Queue growing fast with no idle agents
    if (growthRate > this.spawnTriggers.queueGrowthRate && analysis.idleAgents === 0) {
      decisions.push({
        shouldSpawn: true,
        reason: `Queue growing at ${growthRate.toFixed(1)} tasks/min with no idle agents`,
        suggestedRole: 'generalist',
        suggestedModel: 'sonnet',
        urgency: 'immediate',
      });
    }

    // Trigger 2: Queue depth threshold with no idle for specific roles
    const roleNeed = this.calculateRoleNeed(queuedMissions);
    for (const [role, need] of Object.entries(roleNeed)) {
      if (need >= this.spawnTriggers.queueDepthThreshold) {
        const idleInRole = analysis.agentMetrics.filter(
          m => m.role === role && m.status === 'idle'
        ).length;

        if (idleInRole === 0) {
          decisions.push({
            shouldSpawn: true,
            reason: `${need} ${role} tasks queued with no idle ${role} agents`,
            suggestedRole: role as AgentRole,
            suggestedModel: 'sonnet',
            urgency: need > 10 ? 'immediate' : 'soon',
          });
        }
      }
    }

    // Trigger 3: Complex tasks waiting but no opus agents available
    let complexTasksWaiting = 0;
    for (const mission of queuedMissions) {
      const complexity = this.analyzeTaskComplexity(mission.prompt, mission.context);
      if (complexity.recommendedModel === 'opus') {
        complexTasksWaiting++;
      }
    }

    if (complexTasksWaiting >= this.spawnTriggers.taskComplexityBacklog) {
      const opusAgentsIdle = analysis.agentMetrics.filter(
        m => m.model === 'opus' && m.status === 'idle'
      ).length;

      if (opusAgentsIdle === 0) {
        // Check what roles need opus
        const complexMissionTypes = queuedMissions
          .filter(m => this.analyzeTaskComplexity(m.prompt).recommendedModel === 'opus')
          .map(m => this.getMissionRole(m));

        const mostNeededRole = this.getMostFrequent(complexMissionTypes) || 'architect';

        decisions.push({
          shouldSpawn: true,
          reason: `${complexTasksWaiting} complex tasks waiting, no opus agents available`,
          suggestedRole: mostNeededRole,
          suggestedModel: 'opus',
          urgency: 'immediate',
        });
      }
    }

    // Trigger 4: Maintain minimum idle agents per active role
    const activeRoles = new Set(
      analysis.agentMetrics.filter(m => m.status === 'busy').map(m => m.role)
    );

    for (const role of activeRoles) {
      const idleInRole = analysis.agentMetrics.filter(
        m => m.role === role && m.status === 'idle'
      ).length;

      if (idleInRole < this.spawnTriggers.idleAgentMinimum) {
        decisions.push({
          shouldSpawn: true,
          reason: `Maintaining idle buffer: only ${idleInRole} idle ${role} agents`,
          suggestedRole: role,
          suggestedModel: 'sonnet',
          urgency: 'optional',
        });
      }
    }

    return decisions;
  }

  /**
   * Execute proactive spawning decisions
   */
  async executeProactiveSpawning(): Promise<{
    evaluated: number;
    spawned: Array<{ agentId: number; role: AgentRole; model: ModelTier; reason: string }>;
    skipped: Array<{ reason: string; urgency: string }>;
  }> {
    const decisions = this.evaluateProactiveSpawning();
    const spawned: Array<{ agentId: number; role: AgentRole; model: ModelTier; reason: string }> = [];
    const skipped: Array<{ reason: string; urgency: string }> = [];

    // Sort by urgency: immediate > soon > optional
    const urgencyOrder = { immediate: 0, soon: 1, optional: 2 };
    decisions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

    // Limit spawning to avoid runaway agent creation
    const maxSpawns = 3;
    let spawnCount = 0;

    for (const decision of decisions) {
      if (!decision.shouldSpawn) continue;

      // Only auto-execute immediate/soon, skip optional
      if (decision.urgency === 'optional') {
        skipped.push({ reason: decision.reason, urgency: decision.urgency });
        continue;
      }

      if (spawnCount >= maxSpawns) {
        skipped.push({ reason: `${decision.reason} (max spawns reached)`, urgency: decision.urgency });
        continue;
      }

      try {
        const agent = await this.spawner.spawnAgent({
          role: decision.suggestedRole,
          model: decision.suggestedModel,
        });

        spawned.push({
          agentId: agent.id,
          role: agent.role,
          model: agent.model,
          reason: decision.reason,
        });
        spawnCount++;
      } catch (error) {
        skipped.push({ reason: `Failed: ${decision.reason} - ${error}`, urgency: decision.urgency });
      }
    }

    return {
      evaluated: decisions.length,
      spawned,
      skipped,
    };
  }

  private getMostFrequent<T>(arr: T[]): T | undefined {
    if (arr.length === 0) return undefined;
    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    let maxCount = 0;
    let mostFrequent: T | undefined;
    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostFrequent = item;
      }
    }
    return mostFrequent;
  }

  /**
   * Analyze current workload across all agents
   */
  analyzeWorkload(): WorkloadAnalysis {
    const agents = this.spawner.getAllAgents();
    const activeAgents = this.spawner.getActiveAgents();

    // Calculate per-agent metrics
    const agentMetrics: AgentLoadMetrics[] = agents.map(agent => {
      const total = agent.tasksCompleted + agent.tasksFailed;
      const successRate = total > 0 ? agent.tasksCompleted / total : 0;

      return {
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        model: agent.model,
        status: agent.status,
        tasksCompleted: agent.tasksCompleted,
        tasksFailed: agent.tasksFailed,
        successRate,
        utilizationScore: 0, // Will be normalized below
      };
    });

    // Normalize utilization scores
    const maxTasks = Math.max(...agentMetrics.map(m => m.tasksCompleted + m.tasksFailed), 1);
    agentMetrics.forEach(m => {
      m.utilizationScore = (m.tasksCompleted + m.tasksFailed) / maxTasks;
    });

    // Role distribution
    const roles: AgentRole[] = ['coder', 'tester', 'analyst', 'reviewer', 'generalist', 'oracle', 'architect', 'debugger', 'researcher', 'scribe'];
    const roleDistribution = {} as Record<AgentRole, number>;
    roles.forEach(role => {
      roleDistribution[role] = agents.filter(a => a.role === role).length;
    });

    // Model distribution
    const modelDistribution: Record<ModelTier, number> = {
      haiku: agents.filter(a => a.model === 'haiku').length,
      sonnet: agents.filter(a => a.model === 'sonnet').length,
      opus: agents.filter(a => a.model === 'opus').length,
    };

    // Calculate averages
    const avgSuccessRate = agentMetrics.length > 0
      ? agentMetrics.reduce((sum, m) => sum + m.successRate, 0) / agentMetrics.length
      : 0;

    // Find overloaded/underutilized
    const overloadedAgents = agentMetrics.filter(m =>
      m.status === 'busy' && m.utilizationScore > 0.8
    ).length;
    const underutilizedAgents = agentMetrics.filter(m =>
      m.status === 'idle' && m.utilizationScore < 0.2
    ).length;

    // Find bottleneck roles (roles with no idle agents and queued tasks)
    const bottleneckRoles = this.findBottleneckRoles();

    return {
      totalAgents: agents.length,
      activeAgents: activeAgents.length,
      idleAgents: agents.length - activeAgents.length,
      overloadedAgents,
      underutilizedAgents,
      agentMetrics,
      roleDistribution,
      modelDistribution,
      averageSuccessRate: avgSuccessRate,
      bottleneckRoles,
    };
  }

  /**
   * Suggest agent rebalancing actions
   */
  suggestRebalancing(): RebalanceAction[] {
    const actions: RebalanceAction[] = [];
    const analysis = this.analyzeWorkload();
    const queuedMissions = this.queue.getByStatus('queued');
    const blockedMissions = this.queue.getBlocked();

    // Check for role shortages based on queue
    const roleNeed = this.calculateRoleNeed(queuedMissions);

    for (const [role, need] of Object.entries(roleNeed)) {
      const available = analysis.roleDistribution[role as AgentRole] || 0;
      const idleInRole = analysis.agentMetrics.filter(
        m => m.role === role && m.status === 'idle'
      ).length;

      if (need > 0 && idleInRole === 0) {
        // High demand, no idle agents
        if (available === 0) {
          actions.push({
            type: 'spawn',
            targetRole: role as AgentRole,
            reason: `No ${role} agents available for ${need} queued tasks`,
            priority: need > 3 ? 'high' : 'normal',
          });
        } else {
          // Have agents but all busy - check if we can reassign idle generalists
          const idleGeneralists = analysis.agentMetrics.filter(
            m => m.role === 'generalist' && m.status === 'idle'
          );
          if (idleGeneralists.length > 0) {
            actions.push({
              type: 'reassign',
              agentId: idleGeneralists[0]!.agentId,
              targetRole: role as AgentRole,
              reason: `Reassign idle generalist to handle ${role} backlog`,
              priority: 'normal',
            });
          }
        }
      }
    }

    // Check for underutilized agents that could be retired
    const underutilized = analysis.agentMetrics.filter(
      m => m.status === 'idle' && m.utilizationScore < 0.1 && m.tasksCompleted + m.tasksFailed > 5
    );

    for (const agent of underutilized) {
      // Only suggest retiring if we have more than one of this role
      if ((analysis.roleDistribution[agent.role] || 0) > 1) {
        actions.push({
          type: 'retire',
          agentId: agent.agentId,
          targetRole: agent.role,
          reason: `Low utilization (${(agent.utilizationScore * 100).toFixed(0)}%) with ${agent.tasksFailed} failures`,
          priority: 'low',
        });
      }
    }

    return actions;
  }

  /**
   * Optimize mission queue priorities
   */
  optimizeMissionQueue(): PriorityAdjustment[] {
    const adjustments: PriorityAdjustment[] = [];
    const missions = this.queue.getAllMissions();
    const now = Date.now();

    for (const mission of missions) {
      if (mission.status !== 'queued' && mission.status !== 'pending') continue;

      let suggestedPriority = mission.priority;
      let reason = '';

      // Check age - escalate old missions
      const ageMs = now - mission.createdAt.getTime();
      const ageMinutes = ageMs / 60000;

      if (mission.priority === 'low' && ageMinutes > 30) {
        suggestedPriority = 'normal';
        reason = `Mission waiting ${ageMinutes.toFixed(0)}min, escalating from low`;
      } else if (mission.priority === 'normal' && ageMinutes > 60) {
        suggestedPriority = 'high';
        reason = `Mission waiting ${ageMinutes.toFixed(0)}min, escalating from normal`;
      }

      // Check if mission unblocks many others
      const dependentCount = this.countDependents(mission.id, missions);
      if (dependentCount >= 3 && mission.priority !== 'critical') {
        suggestedPriority = 'critical';
        reason = `Unblocks ${dependentCount} other missions`;
      }

      // Check retry count - deprioritize flaky missions
      if (mission.retryCount >= 2 && mission.priority !== 'low') {
        suggestedPriority = 'low';
        reason = `${mission.retryCount} retries, reducing priority to avoid blocking`;
      }

      if (suggestedPriority !== mission.priority) {
        adjustments.push({
          missionId: mission.id,
          currentPriority: mission.priority,
          suggestedPriority,
          reason,
        });
      }
    }

    return adjustments;
  }

  /**
   * Identify performance bottlenecks
   */
  identifyBottlenecks(): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];
    const analysis = this.analyzeWorkload();
    const missions = this.queue.getAllMissions();

    // Role shortage bottleneck
    for (const role of analysis.bottleneckRoles) {
      const queuedForRole = missions.filter(
        m => m.status === 'queued' && this.getMissionRole(m) === role
      );

      bottlenecks.push({
        type: 'role_shortage',
        description: `No idle ${role} agents, ${queuedForRole.length} missions waiting`,
        severity: queuedForRole.length > 5 ? 'critical' : queuedForRole.length > 2 ? 'high' : 'medium',
        affectedMissions: queuedForRole.map(m => m.id),
        suggestedAction: `Spawn additional ${role} agent or reassign idle generalist`,
      });
    }

    // Queue backup bottleneck
    const queueLength = this.queue.getQueueLength();
    if (queueLength > 10) {
      bottlenecks.push({
        type: 'queue_backup',
        description: `${queueLength} missions in queue, average wait ${(this.queue.getAverageWaitTime() / 1000).toFixed(0)}s`,
        severity: queueLength > 20 ? 'critical' : 'high',
        affectedMissions: missions.filter(m => m.status === 'queued').map(m => m.id),
        suggestedAction: 'Spawn additional agents or increase parallelism',
      });
    }

    // Failure spike bottleneck
    const recentMissions = missions.filter(m => {
      const age = Date.now() - m.createdAt.getTime();
      return age < 300000; // Last 5 minutes
    });
    const failureCount = recentMissions.filter(m => m.status === 'failed').length;
    const failureRate = recentMissions.length > 0 ? failureCount / recentMissions.length : 0;

    if (failureRate > 0.3 && failureCount > 2) {
      bottlenecks.push({
        type: 'failure_spike',
        description: `${(failureRate * 100).toFixed(0)}% failure rate in last 5 minutes (${failureCount}/${recentMissions.length})`,
        severity: failureRate > 0.5 ? 'critical' : 'high',
        affectedMissions: recentMissions.filter(m => m.status === 'failed').map(m => m.id),
        suggestedAction: 'Review task prompts and agent configurations',
      });
    }

    // Dependency chain bottleneck
    const blockedMissions = this.queue.getBlocked();
    const longChains = blockedMissions.filter(m => {
      const depth = this.calculateDependencyDepth(m.id, missions);
      return depth > 3;
    });

    if (longChains.length > 0) {
      bottlenecks.push({
        type: 'dependency_chain',
        description: `${longChains.length} missions blocked by deep dependency chains`,
        severity: 'medium',
        affectedMissions: longChains.map(m => m.id),
        suggestedAction: 'Consider parallelizing independent work or breaking dependencies',
      });
    }

    return bottlenecks;
  }

  /**
   * Harvest patterns from learning loop and generate efficiency insights
   */
  async getEfficiencyInsights(): Promise<EfficiencyInsight[]> {
    const insights: EfficiencyInsight[] = [];
    const missions = this.queue.getAllMissions();

    // Detect patterns from recent missions
    const patterns = await this.learningLoop.detectPatterns(missions, 20);

    for (const pattern of patterns) {
      if (pattern.type === 'failure' && pattern.confidence > 0.5) {
        insights.push({
          category: 'workflow',
          title: `High failure rate for ${pattern.description}`,
          description: pattern.suggestedAction || 'Review task configuration',
          impact: pattern.confidence > 0.7 ? 'high' : 'medium',
          actionable: true,
        });
      }

      if (pattern.type === 'success' && pattern.confidence > 0.8) {
        insights.push({
          category: 'performance',
          title: `Strong success pattern: ${pattern.description}`,
          description: 'Consider applying this pattern to similar tasks',
          impact: 'medium',
          actionable: false,
        });
      }
    }

    // Resource utilization insight
    const analysis = this.analyzeWorkload();
    if (analysis.underutilizedAgents > analysis.totalAgents / 2) {
      insights.push({
        category: 'resource',
        title: 'Agent underutilization',
        description: `${analysis.underutilizedAgents}/${analysis.totalAgents} agents underutilized`,
        impact: 'medium',
        actionable: true,
      });
    }

    return insights;
  }

  /**
   * Apply priority adjustments to the queue
   */
  applyPriorityAdjustments(adjustments: PriorityAdjustment[]): number {
    let applied = 0;
    for (const adj of adjustments) {
      this.queue.setPriority(adj.missionId, adj.suggestedPriority);
      applied++;
    }
    return applied;
  }

  /**
   * Execute rebalancing actions - spawn, reassign, or retire agents
   */
  async executeRebalancing(actions?: RebalanceAction[]): Promise<RebalanceResult> {
    const suggestions = actions || this.suggestRebalancing();
    const result: RebalanceResult = {
      spawned: [],
      reassigned: [],
      retired: [],
      failed: [],
    };

    for (const action of suggestions) {
      try {
        switch (action.type) {
          case 'spawn': {
            const agent = await this.spawner.spawnAgent({
              role: action.targetRole,
            });
            result.spawned.push({
              agentId: agent.id,
              role: agent.role,
              model: agent.model,
            });
            break;
          }

          case 'reassign': {
            if (action.agentId) {
              this.spawner.assignRole(action.agentId, action.targetRole);
              result.reassigned.push({
                agentId: action.agentId,
                newRole: action.targetRole,
              });
            }
            break;
          }

          case 'retire': {
            if (action.agentId) {
              const agent = this.spawner.getAgent(action.agentId);
              if (agent && agent.status === 'idle') {
                // Mark for retirement (don't assign new tasks)
                // In a real system, we'd gracefully shut down the agent
                result.retired.push({
                  agentId: action.agentId,
                  role: agent.role,
                  reason: action.reason,
                });
              }
            }
            break;
          }
        }
      } catch (error) {
        result.failed.push({
          action,
          error: String(error),
        });
      }
    }

    return result;
  }

  /**
   * Auto-optimize: Run all optimizations and apply them
   */
  async autoOptimize(): Promise<AutoOptimizeResult> {
    // 0. Proactive spawning evaluation (NEW - runs first)
    const proactiveResult = await this.executeProactiveSpawning();
    const queueGrowthRate = this.getQueueGrowthRate();

    // 1. Identify and fix bottlenecks
    const bottlenecks = this.identifyBottlenecks();
    const criticalBottlenecks = bottlenecks.filter(b => b.severity === 'critical' || b.severity === 'high');

    // 2. Get and apply priority adjustments
    const priorityAdjustments = this.optimizeMissionQueue();
    const prioritiesApplied = this.applyPriorityAdjustments(priorityAdjustments);

    // 3. Execute rebalancing for high-priority suggestions only
    const suggestions = this.suggestRebalancing();
    const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
    const rebalanceResult = await this.executeRebalancing(highPrioritySuggestions);

    // 4. Get efficiency insights
    const insights = await this.getEfficiencyInsights();

    return {
      bottlenecksFound: bottlenecks.length,
      criticalBottlenecks: criticalBottlenecks.length,
      prioritiesAdjusted: prioritiesApplied,
      agentsSpawned: rebalanceResult.spawned.length + proactiveResult.spawned.length,
      agentsReassigned: rebalanceResult.reassigned.length,
      agentsRetired: rebalanceResult.retired.length,
      actionsFailed: rebalanceResult.failed.length,
      insights: insights.filter(i => i.actionable),
      // Proactive spawning results
      proactiveDecisions: proactiveResult.evaluated,
      proactiveSpawned: proactiveResult.spawned.length,
      queueGrowthRate,
    };
  }

  /**
   * Get recommended agent for a task (Oracle-driven selection)
   * Uses workload analysis for immediate selection
   */
  recommendAgentForTask(taskType?: string, taskPriority?: Priority): Agent | null {
    const analysis = this.analyzeWorkload();

    // First try specialist
    let agent = this.spawner.getAvailableAgent(taskType);
    if (agent) return agent;

    // If high priority and no specialist, find any idle agent with good success rate
    if (taskPriority === 'critical' || taskPriority === 'high') {
      const idleAgents = analysis.agentMetrics
        .filter(m => m.status === 'idle')
        .sort((a, b) => b.successRate - a.successRate);

      if (idleAgents.length > 0) {
        return this.spawner.getAgent(idleAgents[0]!.agentId);
      }
    }

    // Fallback to least busy
    return this.spawner.getLeastBusyAgent();
  }

  /**
   * Get recommended agent using learning loop history
   * Considers historical success rates on similar tasks
   */
  async recommendAgentWithLearning(task: { prompt: string; type?: string }): Promise<{
    agent: Agent | null;
    recommendation: { reason: string; confidence: number; alternatives: number[] };
  }> {
    // Get learning-based recommendation
    const learningRec = await this.learningLoop.recommendAgent(task);

    // Try to get the recommended agent
    let agent = this.spawner.getAgent(learningRec.agentId);

    // If not available, try alternatives
    if (!agent || agent.status !== 'idle') {
      for (const altId of learningRec.alternatives || []) {
        const altAgent = this.spawner.getAgent(altId);
        if (altAgent && altAgent.status === 'idle') {
          agent = altAgent;
          break;
        }
      }
    }

    // Final fallback to workload-based selection
    if (!agent || agent.status !== 'idle') {
      agent = this.recommendAgentForTask(task.type);
    }

    return {
      agent,
      recommendation: {
        reason: learningRec.reason,
        confidence: learningRec.confidence,
        alternatives: learningRec.alternatives || [],
      },
    };
  }

  /**
   * Get relevant lessons for a problem (used before task assignment)
   */
  async getLessonsForTask(taskPrompt: string): Promise<Array<{
    problem: string;
    solution: string;
    outcome: string;
    confidence: number;
  }>> {
    const lessons = await this.learningLoop.getRelevantLessons(taskPrompt);
    return lessons.map(l => ({
      problem: l.problem,
      solution: l.solution,
      outcome: l.outcome,
      confidence: l.confidence,
    }));
  }

  // ============ Private Helpers ============

  private findBottleneckRoles(): AgentRole[] {
    const bottlenecks: AgentRole[] = [];
    const agents = this.spawner.getAllAgents();
    const queuedMissions = this.queue.getByStatus('queued');

    const roleNeed = this.calculateRoleNeed(queuedMissions);

    for (const [role, need] of Object.entries(roleNeed)) {
      if (need > 0) {
        const idleAgents = agents.filter(
          a => a.role === role && a.status === 'idle'
        );
        if (idleAgents.length === 0) {
          bottlenecks.push(role as AgentRole);
        }
      }
    }

    return bottlenecks;
  }

  private calculateRoleNeed(missions: Mission[]): Partial<Record<AgentRole, number>> {
    const need: Partial<Record<AgentRole, number>> = {};

    for (const mission of missions) {
      const role = this.getMissionRole(mission);
      need[role] = (need[role] || 0) + 1;
    }

    return need;
  }

  private getMissionRole(mission: Mission): AgentRole {
    const typeRoleMap: Record<string, AgentRole> = {
      extraction: 'researcher',
      analysis: 'analyst',
      synthesis: 'oracle',
      review: 'reviewer',
      general: 'generalist',
    };
    return typeRoleMap[mission.type || 'general'] || 'generalist';
  }

  private countDependents(missionId: string, missions: Mission[]): number {
    return missions.filter(m => m.dependsOn?.includes(missionId)).length;
  }

  private calculateDependencyDepth(missionId: string, missions: Mission[], visited = new Set<string>()): number {
    if (visited.has(missionId)) return 0;
    visited.add(missionId);

    const mission = missions.find(m => m.id === missionId);
    if (!mission?.dependsOn || mission.dependsOn.length === 0) return 0;

    let maxDepth = 0;
    for (const depId of mission.dependsOn) {
      const depth = this.calculateDependencyDepth(depId, missions, visited);
      maxDepth = Math.max(maxDepth, depth + 1);
    }

    return maxDepth;
  }
}

// ============ Singleton ============

let instance: OracleOrchestrator | null = null;

export function getOracleOrchestrator(): OracleOrchestrator {
  if (!instance) {
    instance = new OracleOrchestrator();
  }
  return instance;
}

export default OracleOrchestrator;
