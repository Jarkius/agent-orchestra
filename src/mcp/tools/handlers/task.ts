/**
 * Task Tool Handlers
 * assign_task, broadcast_task
 *
 * Delivery priority:
 * 1. WebSocket (if agent connected) - <100ms latency
 * 2. File inbox (fallback) - 1-4s latency due to polling
 */

import { mkdir, writeFile } from "fs/promises";
import { CONFIG } from '../../config';
import { successResponse, errorResponse } from '../../utils/response';
import {
  AssignTaskSchema,
  BroadcastTaskSchema,
  type AssignTaskInput,
  type BroadcastTaskInput,
} from '../../utils/validation';
import {
  getAllAgents,
  sendMessage,
  linkTaskToSession,
  getRecentSessions,
  getHighConfidenceLearnings,
  searchLearningsFTS,
  createTask as dbCreateTask,
  updateUnifiedTaskStatus,
  type SessionRecord,
  type LearningRecord,
} from '../../../db';
import type { ToolDefinition, ToolHandler } from '../../types';
import {
  isServerRunning,
  isAgentConnected,
  sendTaskToAgent,
  broadcastTask as wsBroadcastTask,
} from '../../../ws-server';
import { getOracleOrchestrator } from '../../../oracle';

// ============ Utility Functions ============

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Build a context bundle with recent sessions and high-confidence learnings
 */
function buildContextBundle(): string {
  const parts: string[] = [];

  // Get recent sessions (last 2)
  const recentSessions = getRecentSessions(2);
  if (recentSessions.length > 0) {
    parts.push('## Recent Session Context');
    for (const session of recentSessions) {
      parts.push(`\n### ${session.id}`);
      parts.push(`**Summary:** ${session.summary}`);
      if (session.next_steps?.length) {
        parts.push(`**Next Steps:** ${session.next_steps.join(', ')}`);
      }
      if (session.challenges?.length) {
        parts.push(`**Challenges:** ${session.challenges.join(', ')}`);
      }
    }
  }

  // Get high-confidence learnings
  const learnings = getHighConfidenceLearnings(5);
  if (learnings.length > 0) {
    parts.push('\n## Relevant Learnings');
    for (const learning of learnings) {
      const confidence = learning.confidence === 'proven' ? '✓' : '•';
      parts.push(`${confidence} **[${learning.category}]** ${learning.title}`);
      if (learning.description) {
        parts.push(`  ${learning.description}`);
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : '';
}

/**
 * Build an enhanced pre-task briefing with Oracle guidance
 * Includes: complexity analysis, recommended approach, patterns, pitfalls, checkpoints
 */
function buildPreTaskBriefing(taskPrompt: string, userContext?: string): string {
  const parts: string[] = [];

  // 1. Task Complexity Analysis from Oracle
  const oracle = getOracleOrchestrator();
  const complexity = oracle.analyzeTaskComplexity(taskPrompt, userContext);

  parts.push('## 🎯 Pre-Task Briefing');
  parts.push('');
  parts.push(`**Task Complexity:** ${complexity.tier} (recommended model: ${complexity.recommendedModel})`);

  if (complexity.signals.length > 0) {
    parts.push(`**Detected Patterns:** ${complexity.signals.join(', ')}`);
  }

  // 2. Recommended Approach based on task type
  parts.push('');
  parts.push('### Recommended Approach');
  const approach = generateTaskApproach(taskPrompt, complexity.tier);
  parts.push(approach);

  // 3. Query relevant learnings based on task content
  const relevantLearnings = searchLearningsFTS(taskPrompt, 5);
  if (relevantLearnings.length > 0) {
    parts.push('');
    parts.push('### Relevant Knowledge');
    for (const learning of relevantLearnings.slice(0, 3)) {
      const badge = learning.confidence === 'proven' ? '✓' : '•';
      parts.push(`${badge} **[${learning.category}]** ${learning.title}`);
    }
  }

  // 4. Common Pitfalls based on category patterns
  const pitfalls = getPotentialPitfalls(taskPrompt, complexity.signals);
  if (pitfalls.length > 0) {
    parts.push('');
    parts.push('### ⚠️ Common Pitfalls');
    for (const pitfall of pitfalls) {
      parts.push(`- ${pitfall}`);
    }
  }

  // 5. Checkpoint Suggestions for complex tasks
  if (complexity.tier === 'complex' || complexity.tier === 'moderate') {
    parts.push('');
    parts.push('### 📋 Checkpoint Suggestions');
    const checkpoints = getCheckpointSuggestions(taskPrompt, complexity.tier);
    for (const checkpoint of checkpoints) {
      parts.push(`- [ ] ${checkpoint}`);
    }
  }

  // 6. Oracle Consultation Reminder
  parts.push('');
  parts.push('### 💡 Need Help?');
  parts.push('Use `oracle_consult` tool when: stuck on a problem, need approach guidance, want progress review, or considering escalation.');

  return parts.join('\n');
}

/**
 * Generate recommended approach based on task type
 */
function generateTaskApproach(taskPrompt: string, tier: string): string {
  const lowerPrompt = taskPrompt.toLowerCase();

  if (lowerPrompt.includes('implement') || lowerPrompt.includes('add') || lowerPrompt.includes('create')) {
    return `1. Review existing patterns in the codebase
2. Identify integration points
3. Implement with tests
4. Verify against requirements`;
  }

  if (lowerPrompt.includes('fix') || lowerPrompt.includes('bug') || lowerPrompt.includes('debug')) {
    return `1. Reproduce the issue consistently
2. Identify root cause (not just symptoms)
3. Check for related issues
4. Implement fix with regression test`;
  }

  if (lowerPrompt.includes('refactor') || lowerPrompt.includes('improve') || lowerPrompt.includes('optimize')) {
    return `1. Understand current behavior and constraints
2. Ensure test coverage exists
3. Make incremental changes with verification
4. Validate no regressions`;
  }

  if (lowerPrompt.includes('test') || lowerPrompt.includes('testing')) {
    return `1. Identify critical paths to test
2. Write unit tests for edge cases
3. Add integration tests for workflows
4. Verify coverage meets requirements`;
  }

  if (lowerPrompt.includes('review') || lowerPrompt.includes('analyze')) {
    return `1. Gather all relevant context
2. Check against established patterns
3. Identify potential issues
4. Document findings with recommendations`;
  }

  // Default approach
  return `1. Clarify requirements and acceptance criteria
2. Research existing solutions and patterns
3. Plan implementation approach
4. Execute and verify`;
}

/**
 * Get potential pitfalls based on task signals
 */
function getPotentialPitfalls(taskPrompt: string, signals: string[]): string[] {
  const pitfalls: string[] = [];

  if (signals.includes('architecture') || signals.includes('design-decision')) {
    pitfalls.push('Over-engineering: Start simple, evolve as needed');
    pitfalls.push('Missing edge cases in design phase');
  }

  if (signals.includes('multi-file-refactor')) {
    pitfalls.push('Breaking existing functionality during refactor');
    pitfalls.push('Incomplete updates across all affected files');
  }

  if (signals.includes('security-analysis')) {
    pitfalls.push('Missing authentication/authorization checks');
    pitfalls.push('Exposure of sensitive data in logs or errors');
  }

  if (signals.includes('feature-implementation')) {
    pitfalls.push('Missing input validation');
    pitfalls.push('Inadequate error handling');
  }

  if (signals.includes('bug-fix')) {
    pitfalls.push('Fixing symptom instead of root cause');
    pitfalls.push('Introducing new bugs while fixing');
  }

  if (signals.includes('testing')) {
    pitfalls.push('Testing implementation instead of behavior');
    pitfalls.push('Flaky tests due to timing issues');
  }

  // Generic pitfalls
  if (pitfalls.length === 0) {
    pitfalls.push('Missing edge case handling');
    pitfalls.push('Incomplete error handling');
  }

  return pitfalls.slice(0, 4);
}

/**
 * Get checkpoint suggestions based on task complexity
 */
function getCheckpointSuggestions(taskPrompt: string, tier: string): string[] {
  const checkpoints: string[] = [];

  if (tier === 'complex') {
    checkpoints.push('After understanding requirements, consult Oracle for approach');
    checkpoints.push('After initial implementation, run tests');
    checkpoints.push('Before finalizing, request review consultation');
    checkpoints.push('If blocked for >5 minutes, consult Oracle');
  } else if (tier === 'moderate') {
    checkpoints.push('Verify approach before implementation');
    checkpoints.push('Run tests after changes');
    checkpoints.push('If stuck, use oracle_consult tool');
  }

  return checkpoints;
}

// ============ Tool Definitions ============

export const taskTools: ToolDefinition[] = [
  {
    name: "assign_task",
    description: "Assign task",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "number" },
        task: { type: "string" },
        context: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high"] },
        session_id: { type: "string" },
        include_context_bundle: { type: "boolean" },
        auto_save_session: { type: "boolean" },
        unified_task_id: { type: "number", description: "Link to unified_tasks for traceability" },
      },
      required: ["agent_id", "task"],
    },
  },
  {
    name: "broadcast_task",
    description: "Broadcast task",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        context: { type: "string" },
      },
      required: ["task"],
    },
  },
];

// ============ Tool Handlers ============

async function assignTask(args: unknown) {
  const input = AssignTaskSchema.parse(args) as AssignTaskInput;
  const { agent_id, task, context, priority, session_id, include_context_bundle, auto_save_session, unified_task_id } = input;

  const taskId = generateTaskId();

  // Build enhanced context if requested
  let enhancedContext = context || '';
  if (include_context_bundle) {
    // Build pre-task briefing with Oracle guidance
    const briefing = buildPreTaskBriefing(task, context);

    // Also include general context bundle (sessions + learnings)
    const contextBundle = buildContextBundle();

    // Combine: briefing first, then context bundle, then user context
    const parts: string[] = [];
    if (briefing) parts.push(briefing);
    if (contextBundle) parts.push(contextBundle);
    if (enhancedContext) parts.push('---\n\n## Original Context\n' + enhancedContext);

    enhancedContext = parts.join('\n\n');
  }

  // Create task in database with linking
  dbCreateTask(taskId, agent_id, task, enhancedContext || undefined, priority || 'normal', {
    unified_task_id: unified_task_id,
    session_id: session_id,
  });

  // Update unified_task status to 'in_progress' if linked
  if (unified_task_id) {
    try {
      updateUnifiedTaskStatus(unified_task_id, 'in_progress');
    } catch { /* Best effort - unified task may not exist */ }
  }

  // Create task data for delivery
  const taskData = {
    id: taskId,
    prompt: task,
    context: enhancedContext || undefined,
    priority,
    session_id,
    unified_task_id,
    auto_save_session: auto_save_session || priority === 'high',
    assigned_at: new Date().toISOString(),
  };

  // Try WebSocket delivery first (if server running and agent connected)
  let deliveryMethod = 'file';
  if (isServerRunning() && isAgentConnected(agent_id)) {
    const sent = sendTaskToAgent(agent_id, taskData);
    if (sent) {
      deliveryMethod = 'websocket';
    }
  }

  // Fall back to file-based delivery if WebSocket failed or unavailable
  if (deliveryMethod === 'file') {
    const inboxDir = `${CONFIG.INBOX_BASE}/${agent_id}`;
    const taskFile = `${inboxDir}/${taskId}.json`;
    await mkdir(inboxDir, { recursive: true });
    await writeFile(taskFile, JSON.stringify(taskData, null, 2));
  }

  sendMessage("orchestrator", String(agent_id), `Assigned task: ${taskId}`);

  // Link task to session if provided (for backwards compatibility)
  if (session_id) {
    linkTaskToSession(taskId, session_id);
  }

  const deliveryInfo = deliveryMethod === 'websocket' ? '\nDelivery: WebSocket (instant)' : '\nDelivery: File inbox (polling)';
  const contextInfo = include_context_bundle ? '\nContext bundle: included' : '';
  const sessionInfo = session_id ? `\nLinked to session: ${session_id}` : '';
  const unifiedInfo = unified_task_id ? `\nLinked to unified task: ${unified_task_id}` : '';
  const autoSaveInfo = taskData.auto_save_session ? '\nAuto-save session: enabled' : '';

  return successResponse(
    `Task assigned to Agent ${agent_id}\nTask ID: ${taskId}\nPriority: ${priority}${deliveryInfo}${contextInfo}${sessionInfo}${unifiedInfo}${autoSaveInfo}`
  );
}

async function broadcastTask(args: unknown) {
  const input = BroadcastTaskSchema.parse(args) as BroadcastTaskInput;
  const { task, context } = input;

  const agents = getAllAgents() as any[];

  if (agents.length === 0) {
    return errorResponse("No agents available for broadcast");
  }

  const results: string[] = [];
  let wsDelivered = 0;
  let fileDelivered = 0;

  for (const agent of agents) {
    const taskId = generateTaskId();

    const taskData = {
      id: taskId,
      prompt: task,
      context,
      priority: "normal" as const,
      assigned_at: new Date().toISOString(),
    };

    // Try WebSocket first
    let delivered = false;
    if (isServerRunning() && isAgentConnected(agent.id)) {
      delivered = sendTaskToAgent(agent.id, taskData);
      if (delivered) {
        wsDelivered++;
        results.push(`Agent ${agent.id}: ${taskId} (WS)`);
      }
    }

    // Fall back to file if needed
    if (!delivered) {
      const inboxDir = `${CONFIG.INBOX_BASE}/${agent.id}`;
      const taskFile = `${inboxDir}/${taskId}.json`;
      await mkdir(inboxDir, { recursive: true });
      await writeFile(taskFile, JSON.stringify(taskData, null, 2));
      fileDelivered++;
      results.push(`Agent ${agent.id}: ${taskId} (file)`);
    }

    sendMessage("orchestrator", String(agent.id), `Broadcast task: ${taskId}`);
  }

  const deliveryStats = wsDelivered > 0
    ? `\n\nDelivery: ${wsDelivered} via WebSocket, ${fileDelivered} via file`
    : '';

  return successResponse(
    `Task broadcast to ${agents.length} agents:\n${results.join("\n")}${deliveryStats}`
  );
}

// ============ Export Handlers Map ============

export const taskHandlers: Record<string, ToolHandler> = {
  assign_task: assignTask,
  broadcast_task: broadcastTask,
};
