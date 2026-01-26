/**
 * LLM-Driven Task Router
 *
 * Uses LLM to analyze tasks and make intelligent routing decisions:
 * - Which agent role should handle the task
 * - Which model tier is needed (haiku/sonnet/opus)
 * - Whether to spawn new agents or queue
 * - Whether the task should be decomposed into subtasks
 */

import { ExternalLLM, type LLMProvider } from '../services/external-llm';
import type { AgentRole, ModelTier, Agent } from '../interfaces/spawner';
import type { Mission } from '../interfaces/mission';
import {
  getHighConfidenceLearnings,
  searchLearningsFTS,
  type LearningRecord,
} from '../db';
import { getOracleOrchestrator } from './orchestrator';

// ============ Types ============

export interface RoutingDecision {
  recommendedRole: AgentRole;
  recommendedModel: ModelTier;
  shouldSpawn: boolean;
  spawnReason?: string;
  shouldDecompose: boolean;
  decompositionHint?: string;
  confidence: number; // 0-1
  reasoning: string;
}

export interface RouterContext {
  availableAgents: Array<{
    id: number;
    role: AgentRole;
    model: ModelTier;
    status: string;
    successRate: number;
  }>;
  queueDepth: number;
  relevantLearnings: string[];
}

export interface TaskRouterConfig {
  provider: LLMProvider;
  model?: string;
  enableLLM: boolean; // Allow fallback to heuristic-only mode
  maxOutputTokens?: number;
}

const DEFAULT_CONFIG: TaskRouterConfig = {
  provider: 'anthropic',
  model: 'claude-3-5-haiku-20241022', // Fast, cheap for routing decisions
  enableLLM: true,
  maxOutputTokens: 1024,
};

// ============ Task Router ============

export class TaskRouter {
  private config: TaskRouterConfig;
  private llm: ExternalLLM | null = null;

  constructor(config: Partial<TaskRouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Try to initialize LLM if enabled
    if (this.config.enableLLM) {
      try {
        this.llm = new ExternalLLM(this.config.provider);
      } catch (error) {
        console.error(`[TaskRouter] LLM initialization failed, using heuristics only: ${error}`);
        this.llm = null;
      }
    }
  }

  /**
   * Route a task to the optimal agent
   */
  async routeTask(
    task: string,
    context?: string,
    mission?: Mission
  ): Promise<RoutingDecision> {
    // Build routing context
    const routerContext = this.buildContext();

    // If LLM is available, use it for intelligent routing
    if (this.llm) {
      try {
        return await this.routeWithLLM(task, context, routerContext, mission);
      } catch (error) {
        console.error(`[TaskRouter] LLM routing failed, falling back to heuristics: ${error}`);
      }
    }

    // Fallback to heuristic routing
    return this.routeWithHeuristics(task, context, routerContext, mission);
  }

  /**
   * Build context for routing decisions
   */
  private buildContext(): RouterContext {
    const oracle = getOracleOrchestrator();
    const analysis = oracle.analyzeWorkload();

    // Get available agents with their stats
    const availableAgents = analysis.agentMetrics.map(m => ({
      id: m.agentId,
      role: m.role,
      model: m.model,
      status: m.status,
      successRate: m.successRate,
    }));

    // Get relevant learnings
    const learnings = getHighConfidenceLearnings(5);
    const relevantLearnings = learnings.map(l => `[${l.category}] ${l.title}`);

    return {
      availableAgents,
      queueDepth: analysis.totalTasks,
      relevantLearnings,
    };
  }

  /**
   * Route using LLM analysis
   */
  private async routeWithLLM(
    task: string,
    context: string | undefined,
    routerContext: RouterContext,
    mission?: Mission
  ): Promise<RoutingDecision> {
    const prompt = this.buildRoutingPrompt(task, context, routerContext, mission);

    const response = await this.llm!.query(prompt, {
      model: this.config.model,
      maxOutputTokens: this.config.maxOutputTokens,
      temperature: 0.3, // Low temperature for consistent decisions
    });

    return this.parseRoutingResponse(response.text, task, context);
  }

  /**
   * Build prompt for LLM routing decision
   */
  private buildRoutingPrompt(
    task: string,
    context: string | undefined,
    routerContext: RouterContext,
    mission?: Mission
  ): string {
    const agentSummary = routerContext.availableAgents
      .map(a => `  - ${a.role} (${a.model}): ${a.status}, ${Math.round(a.successRate * 100)}% success`)
      .join('\n');

    const idleAgents = routerContext.availableAgents.filter(a => a.status === 'idle');
    const idleByRole = new Map<string, number>();
    idleAgents.forEach(a => {
      idleByRole.set(a.role, (idleByRole.get(a.role) || 0) + 1);
    });

    const learningsSummary = routerContext.relevantLearnings.length > 0
      ? `\nRelevant Knowledge:\n${routerContext.relevantLearnings.map(l => `  - ${l}`).join('\n')}`
      : '';

    return `You are an intelligent task router for a multi-agent system. Analyze the following task and decide how to route it.

## Task
${task}
${context ? `\nContext: ${context}` : ''}
${mission ? `\nPriority: ${mission.priority}, Type: ${mission.type}` : ''}

## Available Agents
${agentSummary}

## Queue Status
- Current queue depth: ${routerContext.queueDepth}
- Idle agents by role: ${Array.from(idleByRole.entries()).map(([r, c]) => `${r}(${c})`).join(', ') || 'none'}
${learningsSummary}

## Agent Roles
- coder: Implementation, coding tasks
- tester: Test writing, quality assurance
- analyst: Code analysis, investigation
- reviewer: Code review, feedback
- architect: Design decisions, system design
- debugger: Bug investigation, troubleshooting
- researcher: Information gathering, research
- scribe: Documentation, writing
- generalist: Any task (fallback)
- oracle: Orchestration (not for tasks)

## Model Tiers
- haiku: Fast, simple tasks (file reads, searches, formatting)
- sonnet: Balanced (most tasks, implementation, testing)
- opus: Complex reasoning (architecture, security, multi-file refactoring)

## Decision Criteria
1. Match task type to specialist role
2. Match complexity to model tier
3. Spawn new agent only if no suitable idle agent exists
4. Recommend decomposition for multi-step tasks requiring different specialists

Respond in this exact JSON format:
{
  "recommendedRole": "role_name",
  "recommendedModel": "model_tier",
  "shouldSpawn": true/false,
  "spawnReason": "why spawn is needed (if shouldSpawn is true)",
  "shouldDecompose": true/false,
  "decompositionHint": "how to break down the task (if shouldDecompose is true)",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of the decision"
}`;
  }

  /**
   * Parse LLM response into routing decision
   */
  private parseRoutingResponse(
    response: string,
    task: string,
    context?: string
  ): RoutingDecision {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and normalize
      const validRoles: AgentRole[] = ['coder', 'tester', 'analyst', 'reviewer', 'generalist', 'oracle', 'architect', 'debugger', 'researcher', 'scribe'];
      const validModels: ModelTier[] = ['haiku', 'sonnet', 'opus'];

      return {
        recommendedRole: validRoles.includes(parsed.recommendedRole) ? parsed.recommendedRole : 'generalist',
        recommendedModel: validModels.includes(parsed.recommendedModel) ? parsed.recommendedModel : 'sonnet',
        shouldSpawn: Boolean(parsed.shouldSpawn),
        spawnReason: parsed.spawnReason || undefined,
        shouldDecompose: Boolean(parsed.shouldDecompose),
        decompositionHint: parsed.decompositionHint || undefined,
        confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.7,
        reasoning: parsed.reasoning || 'LLM routing decision',
      };
    } catch (error) {
      console.error(`[TaskRouter] Failed to parse LLM response: ${error}`);
      // Fall back to heuristics
      return this.routeWithHeuristics(task, context, this.buildContext());
    }
  }

  /**
   * Route using heuristic rules (fallback)
   */
  private routeWithHeuristics(
    task: string,
    context: string | undefined,
    routerContext: RouterContext,
    mission?: Mission
  ): RoutingDecision {
    const oracle = getOracleOrchestrator();
    const complexity = oracle.analyzeTaskComplexity(task, context);

    // Determine role based on task keywords
    const role = this.inferRoleFromTask(task, mission);

    // Check if we need to spawn
    const idleAgentsWithRole = routerContext.availableAgents.filter(
      a => a.role === role && a.status === 'idle'
    );
    const shouldSpawn = idleAgentsWithRole.length === 0 && routerContext.queueDepth > 3;

    // Determine if decomposition is needed
    const shouldDecompose = this.shouldDecomposeTask(task, complexity.tier);

    return {
      recommendedRole: role,
      recommendedModel: complexity.recommendedModel,
      shouldSpawn,
      spawnReason: shouldSpawn ? `No idle ${role} agents and queue depth is ${routerContext.queueDepth}` : undefined,
      shouldDecompose,
      decompositionHint: shouldDecompose ? this.getDecompositionHint(task) : undefined,
      confidence: 0.7, // Heuristic confidence
      reasoning: `Heuristic: ${complexity.tier} task, signals: ${complexity.signals.join(', ')}`,
    };
  }

  /**
   * Infer agent role from task content
   */
  private inferRoleFromTask(task: string, mission?: Mission): AgentRole {
    const lowerTask = task.toLowerCase();

    // Check mission type first
    if (mission?.type) {
      const typeMap: Record<string, AgentRole> = {
        extraction: 'researcher',
        analysis: 'analyst',
        synthesis: 'architect',
        review: 'reviewer',
        general: 'generalist',
      };
      if (typeMap[mission.type]) {
        return typeMap[mission.type];
      }
    }

    // Keyword-based inference
    if (lowerTask.includes('test') || lowerTask.includes('spec') || lowerTask.includes('coverage')) {
      return 'tester';
    }
    if (lowerTask.includes('review') || lowerTask.includes('feedback') || lowerTask.includes('critique')) {
      return 'reviewer';
    }
    if (lowerTask.includes('architect') || lowerTask.includes('design') || lowerTask.includes('structure')) {
      return 'architect';
    }
    if (lowerTask.includes('debug') || lowerTask.includes('fix') || lowerTask.includes('bug') || lowerTask.includes('error')) {
      return 'debugger';
    }
    if (lowerTask.includes('research') || lowerTask.includes('investigate') || lowerTask.includes('find') || lowerTask.includes('search')) {
      return 'researcher';
    }
    if (lowerTask.includes('document') || lowerTask.includes('readme') || lowerTask.includes('write')) {
      return 'scribe';
    }
    if (lowerTask.includes('analyze') || lowerTask.includes('analysis') || lowerTask.includes('assess')) {
      return 'analyst';
    }
    if (lowerTask.includes('implement') || lowerTask.includes('code') || lowerTask.includes('create') || lowerTask.includes('add')) {
      return 'coder';
    }

    return 'generalist';
  }

  /**
   * Determine if task should be decomposed
   */
  private shouldDecomposeTask(task: string, tier: string): boolean {
    const lowerTask = task.toLowerCase();

    // Multiple action words indicate decomposition needed
    const actionWords = ['implement', 'test', 'review', 'refactor', 'document', 'analyze', 'design', 'write', 'create', 'add'];
    const matches = actionWords.filter(w => lowerTask.includes(w));
    if (matches.length >= 2) {
      return true;
    }

    // Multi-step indicators
    if (lowerTask.includes(' and ') || lowerTask.includes(' then ') || lowerTask.includes(' with ')) {
      // Check if there are distinct task types
      const hasImplementation = lowerTask.match(/implement|create|add|refactor|build/);
      const hasTesting = lowerTask.match(/test|spec|coverage/);
      const hasReview = lowerTask.match(/review|feedback/);
      const hasDoc = lowerTask.match(/document|readme/);

      // If multiple distinct task types, decompose
      const taskTypes = [hasImplementation, hasTesting, hasReview, hasDoc].filter(Boolean);
      if (taskTypes.length >= 2) {
        return true;
      }
    }

    // Complex tier tasks with connectors
    if (tier === 'complex' && (lowerTask.includes(' and ') || lowerTask.includes(' with '))) {
      return true;
    }

    // Explicit multi-part tasks
    if (lowerTask.match(/\d+\.\s/)) {
      return true; // Numbered list
    }

    return false;
  }

  /**
   * Get hint for how to decompose task
   */
  private getDecompositionHint(task: string): string {
    const lowerTask = task.toLowerCase();

    if (lowerTask.includes('refactor') && lowerTask.includes('test')) {
      return 'Split into: 1) Analyze current implementation, 2) Design new structure, 3) Implement changes, 4) Write tests';
    }
    if (lowerTask.includes('implement') && lowerTask.includes('document')) {
      return 'Split into: 1) Implement feature, 2) Write documentation';
    }
    if (lowerTask.includes('review') && lowerTask.includes('fix')) {
      return 'Split into: 1) Review and identify issues, 2) Fix identified issues';
    }

    return 'Consider breaking into sequential steps with clear deliverables';
  }

  /**
   * Check if LLM is available
   */
  isLLMAvailable(): boolean {
    return this.llm !== null;
  }

  /**
   * Get available LLM providers
   */
  static getAvailableProviders(): LLMProvider[] {
    return ExternalLLM.getAvailableProviders();
  }
}

// ============ Singleton ============

let routerInstance: TaskRouter | null = null;

export function getTaskRouter(config?: Partial<TaskRouterConfig>): TaskRouter {
  if (!routerInstance || config) {
    routerInstance = new TaskRouter(config);
  }
  return routerInstance;
}
