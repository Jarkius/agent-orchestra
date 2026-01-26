/**
 * Task Decomposer
 *
 * Breaks complex tasks into subtasks for parallel/sequential execution.
 * Uses LLM to intelligently analyze task structure and create execution plans.
 */

import { ExternalLLM, type LLMProvider } from '../services/external-llm';
import type { AgentRole, ModelTier } from '../interfaces/spawner';
import { getOracleOrchestrator } from './orchestrator';

// ============ Types ============

export interface Subtask {
  id: string;
  prompt: string;
  recommendedRole: AgentRole;
  recommendedModel: ModelTier;
  dependsOn: string[]; // IDs of tasks that must complete first
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
}

export interface DecomposedTask {
  originalTask: string;
  subtasks: Subtask[];
  executionOrder: 'sequential' | 'parallel' | 'mixed';
  dependencies: Map<string, string[]>; // subtask ID -> IDs it depends on
  totalEstimatedComplexity: 'simple' | 'moderate' | 'complex';
}

export interface DecomposerConfig {
  provider: LLMProvider;
  model?: string;
  enableLLM: boolean;
  maxSubtasks?: number;
}

const DEFAULT_CONFIG: DecomposerConfig = {
  provider: 'anthropic',
  model: 'claude-3-5-haiku-20241022', // Fast for decomposition
  enableLLM: true,
  maxSubtasks: 10,
};

// ============ Task Decomposer ============

export class TaskDecomposer {
  private config: DecomposerConfig;
  private llm: ExternalLLM | null = null;

  constructor(config: Partial<DecomposerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.enableLLM) {
      try {
        this.llm = new ExternalLLM(this.config.provider);
      } catch (error) {
        console.error(`[TaskDecomposer] LLM initialization failed: ${error}`);
        this.llm = null;
      }
    }
  }

  /**
   * Decompose a complex task into subtasks
   */
  async decompose(
    task: string,
    context?: string
  ): Promise<DecomposedTask> {
    // Check if task needs decomposition
    const oracle = getOracleOrchestrator();
    const complexity = oracle.analyzeTaskComplexity(task, context);

    // Simple tasks don't need decomposition
    if (complexity.tier === 'simple') {
      return this.createSingleTaskPlan(task, complexity.recommendedModel);
    }

    // Try LLM decomposition
    if (this.llm) {
      try {
        return await this.decomposeWithLLM(task, context);
      } catch (error) {
        console.error(`[TaskDecomposer] LLM decomposition failed: ${error}`);
      }
    }

    // Fallback to heuristic decomposition
    return this.decomposeWithHeuristics(task, context);
  }

  /**
   * Create a plan for a single task (no decomposition needed)
   */
  private createSingleTaskPlan(task: string, model: ModelTier): DecomposedTask {
    const subtask: Subtask = {
      id: 'task_1',
      prompt: task,
      recommendedRole: this.inferRole(task),
      recommendedModel: model,
      dependsOn: [],
      estimatedComplexity: 'simple',
    };

    return {
      originalTask: task,
      subtasks: [subtask],
      executionOrder: 'sequential',
      dependencies: new Map(),
      totalEstimatedComplexity: 'simple',
    };
  }

  /**
   * Decompose using LLM
   */
  private async decomposeWithLLM(
    task: string,
    context?: string
  ): Promise<DecomposedTask> {
    const prompt = this.buildDecompositionPrompt(task, context);

    const response = await this.llm!.query(prompt, {
      model: this.config.model,
      maxOutputTokens: 2048,
      temperature: 0.3,
    });

    return this.parseDecompositionResponse(response.text, task);
  }

  /**
   * Build prompt for task decomposition
   */
  private buildDecompositionPrompt(task: string, context?: string): string {
    return `You are a task decomposition expert for a multi-agent system. Break down the following task into smaller, actionable subtasks.

## Task
${task}
${context ? `\nContext: ${context}` : ''}

## Agent Roles Available
- coder: Implementation, coding
- tester: Writing tests, QA
- analyst: Analysis, investigation
- reviewer: Code review
- architect: Design decisions
- debugger: Bug fixing
- researcher: Research, information gathering
- scribe: Documentation

## Model Tiers
- haiku: Simple tasks (reading, searching)
- sonnet: Standard tasks (implementation, testing)
- opus: Complex tasks (architecture, security analysis)

## Guidelines
1. Each subtask should be completable by a single agent
2. Identify dependencies between subtasks
3. Mark which subtasks can run in parallel
4. Assign appropriate role and model tier to each subtask
5. Maximum ${this.config.maxSubtasks} subtasks

Respond in this exact JSON format:
{
  "subtasks": [
    {
      "id": "task_1",
      "prompt": "Clear, actionable task description",
      "recommendedRole": "role_name",
      "recommendedModel": "model_tier",
      "dependsOn": [],
      "estimatedComplexity": "simple|moderate|complex"
    },
    {
      "id": "task_2",
      "prompt": "...",
      "recommendedRole": "...",
      "recommendedModel": "...",
      "dependsOn": ["task_1"],
      "estimatedComplexity": "..."
    }
  ],
  "executionOrder": "sequential|parallel|mixed",
  "totalEstimatedComplexity": "simple|moderate|complex"
}`;
  }

  /**
   * Parse LLM decomposition response
   */
  private parseDecompositionResponse(
    response: string,
    originalTask: string
  ): DecomposedTask {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and build subtasks
      const subtasks: Subtask[] = (parsed.subtasks || [])
        .slice(0, this.config.maxSubtasks)
        .map((s: any, i: number) => ({
          id: s.id || `task_${i + 1}`,
          prompt: s.prompt || originalTask,
          recommendedRole: this.validateRole(s.recommendedRole),
          recommendedModel: this.validateModel(s.recommendedModel),
          dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
          estimatedComplexity: this.validateComplexity(s.estimatedComplexity),
        }));

      // Build dependency map
      const dependencies = new Map<string, string[]>();
      for (const subtask of subtasks) {
        dependencies.set(subtask.id, subtask.dependsOn);
      }

      return {
        originalTask,
        subtasks,
        executionOrder: this.validateExecutionOrder(parsed.executionOrder),
        dependencies,
        totalEstimatedComplexity: this.validateComplexity(parsed.totalEstimatedComplexity),
      };
    } catch (error) {
      console.error(`[TaskDecomposer] Failed to parse response: ${error}`);
      return this.decomposeWithHeuristics(originalTask);
    }
  }

  /**
   * Decompose using heuristic rules
   */
  private decomposeWithHeuristics(
    task: string,
    context?: string
  ): DecomposedTask {
    const lowerTask = task.toLowerCase();
    const subtasks: Subtask[] = [];
    let taskCounter = 1;

    // Pattern: "X and Y" or "X with Y"
    if (lowerTask.includes(' and ') || lowerTask.includes(' with ')) {
      // Analysis phase
      if (lowerTask.includes('refactor') || lowerTask.includes('improve')) {
        subtasks.push({
          id: `task_${taskCounter++}`,
          prompt: `Analyze the current implementation: ${task}`,
          recommendedRole: 'analyst',
          recommendedModel: 'sonnet',
          dependsOn: [],
          estimatedComplexity: 'moderate',
        });
      }

      // Implementation phase
      if (lowerTask.includes('implement') || lowerTask.includes('create') || lowerTask.includes('add') || lowerTask.includes('refactor')) {
        subtasks.push({
          id: `task_${taskCounter++}`,
          prompt: this.extractImplementationTask(task),
          recommendedRole: 'coder',
          recommendedModel: 'sonnet',
          dependsOn: subtasks.length > 0 ? [subtasks[subtasks.length - 1].id] : [],
          estimatedComplexity: 'moderate',
        });
      }

      // Testing phase
      if (lowerTask.includes('test') || lowerTask.includes('spec') || lowerTask.includes('coverage')) {
        // Don't add if we already have a tester subtask
        const hasTester = subtasks.some(s => s.recommendedRole === 'tester');
        if (!hasTester) {
          subtasks.push({
            id: `task_${taskCounter++}`,
            prompt: this.extractTestingTask(task),
            recommendedRole: 'tester',
            recommendedModel: 'sonnet',
            dependsOn: subtasks.length > 0 ? [subtasks[subtasks.length - 1].id] : [],
            estimatedComplexity: 'moderate',
          });
        }
      }

      // Documentation phase
      if (lowerTask.includes('document')) {
        subtasks.push({
          id: `task_${taskCounter++}`,
          prompt: this.extractDocumentationTask(task),
          recommendedRole: 'scribe',
          recommendedModel: 'haiku',
          dependsOn: subtasks.length > 0 ? [subtasks[subtasks.length - 1].id] : [],
          estimatedComplexity: 'simple',
        });
      }

      // Review phase
      if (lowerTask.includes('review')) {
        subtasks.push({
          id: `task_${taskCounter++}`,
          prompt: `Review the implementation: ${task}`,
          recommendedRole: 'reviewer',
          recommendedModel: 'sonnet',
          dependsOn: subtasks.length > 0 ? [subtasks[subtasks.length - 1].id] : [],
          estimatedComplexity: 'moderate',
        });
      }
    }

    // If no decomposition patterns matched, create a single task
    if (subtasks.length === 0) {
      const oracle = getOracleOrchestrator();
      const complexity = oracle.analyzeTaskComplexity(task, context);

      subtasks.push({
        id: 'task_1',
        prompt: task,
        recommendedRole: this.inferRole(task),
        recommendedModel: complexity.recommendedModel,
        dependsOn: [],
        estimatedComplexity: complexity.tier as 'simple' | 'moderate' | 'complex',
      });
    }

    // Build dependency map
    const dependencies = new Map<string, string[]>();
    for (const subtask of subtasks) {
      dependencies.set(subtask.id, subtask.dependsOn);
    }

    // Determine execution order
    const hasParallel = subtasks.some((s, i) =>
      i > 0 && s.dependsOn.length === 0
    );
    const executionOrder = subtasks.length === 1 ? 'sequential' :
      hasParallel ? 'mixed' : 'sequential';

    // Calculate total complexity
    const complexities = subtasks.map(s => s.estimatedComplexity);
    const totalComplexity = complexities.includes('complex') ? 'complex' :
      complexities.includes('moderate') ? 'moderate' : 'simple';

    return {
      originalTask: task,
      subtasks,
      executionOrder,
      dependencies,
      totalEstimatedComplexity: totalComplexity,
    };
  }

  // ============ Helper Methods ============

  private inferRole(task: string): AgentRole {
    const lowerTask = task.toLowerCase();

    if (lowerTask.includes('test')) return 'tester';
    if (lowerTask.includes('review')) return 'reviewer';
    if (lowerTask.includes('architect') || lowerTask.includes('design')) return 'architect';
    if (lowerTask.includes('debug') || lowerTask.includes('fix')) return 'debugger';
    if (lowerTask.includes('research') || lowerTask.includes('investigate')) return 'researcher';
    if (lowerTask.includes('document')) return 'scribe';
    if (lowerTask.includes('analyze')) return 'analyst';
    if (lowerTask.includes('implement') || lowerTask.includes('code')) return 'coder';

    return 'generalist';
  }

  private validateRole(role: any): AgentRole {
    const validRoles: AgentRole[] = ['coder', 'tester', 'analyst', 'reviewer', 'generalist', 'oracle', 'architect', 'debugger', 'researcher', 'scribe'];
    return validRoles.includes(role) ? role : 'generalist';
  }

  private validateModel(model: any): ModelTier {
    const validModels: ModelTier[] = ['haiku', 'sonnet', 'opus'];
    return validModels.includes(model) ? model : 'sonnet';
  }

  private validateComplexity(complexity: any): 'simple' | 'moderate' | 'complex' {
    const valid = ['simple', 'moderate', 'complex'];
    return valid.includes(complexity) ? complexity : 'moderate';
  }

  private validateExecutionOrder(order: any): 'sequential' | 'parallel' | 'mixed' {
    const valid = ['sequential', 'parallel', 'mixed'];
    return valid.includes(order) ? order : 'sequential';
  }

  private extractImplementationTask(task: string): string {
    // Remove testing-related parts
    return task.replace(/\s+(and|with)\s+(tests?|testing|test coverage)/gi, '').trim();
  }

  private extractTestingTask(task: string): string {
    const match = task.match(/(tests?|testing|test coverage).*/i);
    if (match) {
      return `Write ${match[0]}`;
    }
    return `Write tests for: ${task}`;
  }

  private extractDocumentationTask(task: string): string {
    const match = task.match(/(document|documentation).*/i);
    if (match) {
      return `Write ${match[0]}`;
    }
    return `Document: ${task}`;
  }

  /**
   * Check if LLM is available
   */
  isLLMAvailable(): boolean {
    return this.llm !== null;
  }
}

// ============ Singleton ============

let decomposerInstance: TaskDecomposer | null = null;

export function getTaskDecomposer(config?: Partial<DecomposerConfig>): TaskDecomposer {
  if (!decomposerInstance || config) {
    decomposerInstance = new TaskDecomposer(config);
  }
  return decomposerInstance;
}
