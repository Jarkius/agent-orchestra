/**
 * Agent Tasks - Task lifecycle and mission persistence
 *
 * This module handles task creation, claiming, completion,
 * mission persistence, and task linking.
 */

import { db } from './core';
import { logEvent } from './events';
import { logMessage } from './messages';
import { incrementAgentStats } from './agents';

// ============================================================================
// Types
// ============================================================================

export interface MissionRecord {
  id: string;
  prompt: string;
  context?: string;
  priority: string;
  type?: string;
  status: string;
  timeout_ms: number;
  max_retries: number;
  retry_count: number;
  depends_on?: string;
  assigned_to?: number;
  result?: string;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

// ============================================================================
// Task Functions
// ============================================================================

export function createTask(
  taskId: string,
  agentId: number,
  prompt: string,
  context?: string,
  priority = 'normal',
  options?: {
    unified_task_id?: number;
    parent_mission_id?: string;
    session_id?: string;
  }
) {
  db.run(
    `INSERT INTO agent_tasks (id, agent_id, prompt, context, priority, status, created_at, unified_task_id, parent_mission_id, session_id)
     VALUES (?, ?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP, ?, ?, ?)`,
    [
      taskId,
      agentId,
      prompt,
      context || null,
      priority,
      options?.unified_task_id || null,
      options?.parent_mission_id || null,
      options?.session_id || null
    ]
  );
  logMessage(agentId, 'inbound', `Task queued: ${prompt.substring(0, 100)}...`, 'task', 'orchestrator');
  logEvent(agentId, 'task_queued', { task_id: taskId, priority, unified_task_id: options?.unified_task_id });
}

export function startTask(taskId: string) {
  db.run(
    `UPDATE agent_tasks SET status = 'processing', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [taskId]
  );
}

/**
 * Atomically claim a task for execution.
 *
 * This function provides idempotent task claiming to prevent duplicate execution
 * when tasks may arrive via multiple delivery paths (WebSocket + file polling).
 *
 * @param taskId - The task ID to claim
 * @param agentId - The agent attempting to claim
 * @param executionId - Unique execution ID for this claim attempt
 * @returns { claimed: true } if successfully claimed, { claimed: false, reason } if not
 *
 * A task can only be claimed if:
 * 1. It exists and is in 'queued' status
 * 2. It has no existing execution_id (hasn't been claimed before)
 * 3. It is assigned to the claiming agent
 */
export function claimTask(
  taskId: string,
  agentId: number,
  executionId: string
): { claimed: boolean; reason?: string; currentStatus?: string } {
  // Use a single UPDATE with WHERE clause to make the claim atomic
  // Only updates if task is in claimable state
  const result = db.run(
    `UPDATE agent_tasks
     SET status = 'processing',
         execution_id = ?,
         started_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND agent_id = ?
       AND status = 'queued'
       AND execution_id IS NULL`,
    [executionId, taskId, agentId]
  );

  if (result.changes > 0) {
    logEvent(agentId, 'task_claimed', { task_id: taskId, execution_id: executionId });
    return { claimed: true };
  }

  // Claim failed - check why
  const task = db.query(
    `SELECT status, execution_id, agent_id FROM agent_tasks WHERE id = ?`
  ).get(taskId) as { status: string; execution_id: string | null; agent_id: number } | null;

  if (!task) {
    return { claimed: false, reason: 'task_not_found' };
  }

  if (task.agent_id !== agentId) {
    return { claimed: false, reason: 'wrong_agent', currentStatus: task.status };
  }

  if (task.execution_id) {
    // Already claimed (possibly by this agent via another path)
    if (task.execution_id === executionId) {
      // Same execution - idempotent, treat as success
      return { claimed: true };
    }
    return { claimed: false, reason: 'already_claimed', currentStatus: task.status };
  }

  if (task.status !== 'queued') {
    return { claimed: false, reason: 'invalid_status', currentStatus: task.status };
  }

  return { claimed: false, reason: 'unknown' };
}

/**
 * Release a claimed task (e.g., if agent crashes before completion)
 * Allows the task to be re-claimed for retry
 */
export function releaseTask(taskId: string, executionId: string): boolean {
  const result = db.run(
    `UPDATE agent_tasks
     SET status = 'queued',
         execution_id = NULL,
         started_at = NULL
     WHERE id = ?
       AND execution_id = ?`,
    [taskId, executionId]
  );

  return result.changes > 0;
}

export function completeTask(
  taskId: string,
  result: string,
  durationMs: number,
  inputTokens?: number,
  outputTokens?: number
) {
  db.run(
    `UPDATE agent_tasks SET
      status = 'completed',
      result = ?,
      duration_ms = ?,
      input_tokens = ?,
      output_tokens = ?,
      completed_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [result, durationMs, inputTokens || null, outputTokens || null, taskId]
  );

  const task = getTask(taskId);
  if (task) {
    logMessage(task.agent_id, 'outbound', `Task completed: ${result.substring(0, 100)}...`, 'result', `agent-${task.agent_id}`);
    incrementAgentStats(task.agent_id, true, durationMs);
    logEvent(task.agent_id, 'task_completed', { task_id: taskId, duration_ms: durationMs });

    // Sync unified_task status if linked
    if (task.unified_task_id) {
      // Check if all tasks for this unified_task are complete
      const pending = db.query(`
        SELECT COUNT(*) as count FROM agent_tasks
        WHERE unified_task_id = ? AND status NOT IN ('completed', 'cancelled', 'failed')
      `).get(task.unified_task_id) as any;

      if (pending.count === 0) {
        // All tasks complete - mark unified_task as done
        db.run(
          `UPDATE unified_tasks SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [task.unified_task_id]
        );
      }
    }
  }
}

export function failTask(taskId: string, error: string, durationMs: number) {
  db.run(
    `UPDATE agent_tasks SET
      status = 'failed',
      error = ?,
      duration_ms = ?,
      completed_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [error, durationMs, taskId]
  );

  const task = getTask(taskId);
  if (task) {
    logMessage(task.agent_id, 'outbound', `Task failed: ${error}`, 'error', `agent-${task.agent_id}`);
    incrementAgentStats(task.agent_id, false, durationMs);
    logEvent(task.agent_id, 'task_failed', { task_id: taskId, error });
  }
}

export function getTask(taskId: string) {
  return db.query(`SELECT * FROM agent_tasks WHERE id = ?`).get(taskId) as any;
}

export function getAgentTasks(agentId: number, status?: string, limit = 20) {
  if (status) {
    return db.query(
      `SELECT * FROM agent_tasks WHERE agent_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`
    ).all(agentId, status, limit);
  }
  return db.query(
    `SELECT * FROM agent_tasks WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(agentId, limit);
}

export function getTaskStats() {
  return db.query(`
    SELECT
      status,
      COUNT(*) as count,
      AVG(duration_ms) as avg_duration_ms,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens
    FROM agent_tasks
    GROUP BY status
  `).all();
}

export function cancelTask(taskId: string) {
  const task = getTask(taskId);
  if (task && task.status !== 'completed' && task.status !== 'failed') {
    db.run(
      `UPDATE agent_tasks SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [taskId]
    );
    if (task.agent_id) {
      logMessage(task.agent_id, 'inbound', `Task cancelled: ${taskId}`, 'cancelled', 'orchestrator');
      logEvent(task.agent_id, 'task_cancelled', { task_id: taskId });
    }
    return true;
  }
  return false;
}

// ============================================================================
// Task Linking Functions
// ============================================================================

/**
 * Link an agent_task to a unified_task (business requirement)
 */
export function linkTaskToUnified(agentTaskId: string, unifiedTaskId: number): void {
  db.run(
    `UPDATE agent_tasks SET unified_task_id = ? WHERE id = ?`,
    [unifiedTaskId, agentTaskId]
  );
}

/**
 * Link an agent_task to its parent mission
 */
export function linkTaskToMission(agentTaskId: string, missionId: string): void {
  db.run(
    `UPDATE agent_tasks SET parent_mission_id = ? WHERE id = ?`,
    [missionId, agentTaskId]
  );
}

/**
 * Get all agent_tasks linked to a unified_task
 */
export function getLinkedTasks(unifiedTaskId: number): any[] {
  return db.query(
    `SELECT * FROM agent_tasks WHERE unified_task_id = ? ORDER BY created_at DESC`
  ).all(unifiedTaskId);
}

/**
 * Get full task lineage: unified_task -> agent_tasks -> learnings
 */
export function getTaskLineage(unifiedTaskId: number): {
  unified_task: any;
  agent_tasks: any[];
  learnings: any[];
  stats: { total_duration_ms: number; total_tokens: number; task_count: number };
} {
  const unified_task = db.query(
    `SELECT * FROM unified_tasks WHERE id = ?`
  ).get(unifiedTaskId);

  const agent_tasks = db.query(
    `SELECT * FROM agent_tasks WHERE unified_task_id = ? ORDER BY created_at`
  ).all(unifiedTaskId);

  const learnings = db.query(
    `SELECT * FROM learnings WHERE source_unified_task_id = ? ORDER BY created_at`
  ).all(unifiedTaskId);

  // Calculate stats
  const stats = db.query(`
    SELECT
      COALESCE(SUM(duration_ms), 0) as total_duration_ms,
      COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) as total_tokens,
      COUNT(*) as task_count
    FROM agent_tasks
    WHERE unified_task_id = ?
  `).get(unifiedTaskId) as any;

  return { unified_task, agent_tasks, learnings, stats };
}

/**
 * Get learnings that originated from a specific agent_task
 */
export function getLearningsByTask(taskId: string): any[] {
  return db.query(
    `SELECT * FROM learnings WHERE source_task_id = ? ORDER BY created_at DESC`
  ).all(taskId);
}

/**
 * Get learnings that originated from a specific mission
 */
export function getLearningsByMission(missionId: string): any[] {
  return db.query(
    `SELECT * FROM learnings WHERE source_mission_id = ? ORDER BY created_at DESC`
  ).all(missionId);
}

/**
 * Find tasks that share the same unified_task as a given agent_task
 */
export function getSiblingTasks(taskId: string): any[] {
  const task = getTask(taskId);
  if (!task?.unified_task_id) return [];

  return db.query(
    `SELECT * FROM agent_tasks WHERE unified_task_id = ? AND id != ? ORDER BY created_at`
  ).all(task.unified_task_id, taskId);
}

// ============================================================================
// Mission Persistence Functions
// ============================================================================

export function saveMission(mission: {
  id: string;
  prompt: string;
  context?: string;
  priority: string;
  type?: string;
  status: string;
  timeoutMs: number;
  maxRetries: number;
  retryCount: number;
  dependsOn?: string[];
  assignedTo?: number;
  error?: object;
  result?: object;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  unified_task_id?: number;
}): void {
  const dependsOnJson = mission.dependsOn ? JSON.stringify(mission.dependsOn) : null;
  const errorJson = mission.error ? JSON.stringify(mission.error) : null;
  const resultJson = mission.result ? JSON.stringify(mission.result) : null;

  db.run(`
    INSERT INTO agent_tasks (id, prompt, context, priority, type, status, timeout_ms, max_retries, retry_count, depends_on, assigned_to, error, result, created_at, started_at, completed_at, unified_task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      retry_count = excluded.retry_count,
      assigned_to = excluded.assigned_to,
      error = excluded.error,
      result = excluded.result,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      unified_task_id = excluded.unified_task_id
  `, [
    mission.id,
    mission.prompt,
    mission.context || null,
    mission.priority,
    mission.type || null,
    mission.status,
    mission.timeoutMs,
    mission.maxRetries,
    mission.retryCount,
    dependsOnJson,
    mission.assignedTo || null,
    errorJson,
    resultJson,
    mission.createdAt.toISOString(),
    mission.startedAt?.toISOString() || null,
    mission.completedAt?.toISOString() || null,
    mission.unified_task_id || null,
  ]);
}

export function loadPendingMissions(): MissionRecord[] {
  return db.query(`
    SELECT * FROM agent_tasks
    WHERE status IN ('pending', 'queued', 'running', 'retrying', 'blocked')
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'normal' THEN 2
        WHEN 'low' THEN 3
      END,
      created_at ASC
  `).all() as MissionRecord[];
}

export function updateMissionStatus(
  missionId: string,
  status: string,
  extras?: {
    retryCount?: number;
    assignedTo?: number;
    error?: object;
    result?: object;
    startedAt?: Date;
    completedAt?: Date;
    executionId?: string | null;  // null clears the execution_id
  }
): void {
  const updates: string[] = ['status = ?'];
  const params: any[] = [status];

  if (extras?.retryCount !== undefined) {
    updates.push('retry_count = ?');
    params.push(extras.retryCount);
  }
  if (extras?.assignedTo !== undefined) {
    updates.push('assigned_to = ?');
    params.push(extras.assignedTo);
  }
  if (extras?.error !== undefined) {
    updates.push('error = ?');
    params.push(JSON.stringify(extras.error));
  }
  if (extras?.result !== undefined) {
    updates.push('result = ?');
    params.push(JSON.stringify(extras.result));
  }
  if (extras?.startedAt !== undefined) {
    updates.push('started_at = ?');
    params.push(extras.startedAt.toISOString());
  }
  if (extras?.completedAt !== undefined) {
    updates.push('completed_at = ?');
    params.push(extras.completedAt.toISOString());
  }
  if (extras?.executionId !== undefined) {
    updates.push('execution_id = ?');
    // Allow clearing execution_id by passing null
    params.push(extras.executionId || null);
  }

  params.push(missionId);
  db.run(`UPDATE agent_tasks SET ${updates.join(', ')} WHERE id = ?`, params);
}

export function getMissionFromDb(missionId: string): MissionRecord | null {
  return db.query(`SELECT * FROM agent_tasks WHERE id = ?`).get(missionId) as MissionRecord | null;
}

/**
 * Atomically dequeue a mission with execution ID for idempotency.
 * Uses a transaction to ensure the status change and execution ID assignment are atomic.
 * Returns the execution ID if successful, null if mission not found or already running.
 */
export function atomicDequeueWithExecutionId(
  missionId: string,
  agentId: number,
  executionId: string
): { success: boolean; executionId?: string; error?: string } {
  try {
    db.run('BEGIN IMMEDIATE');

    // Check current status - only dequeue if queued
    const mission = db.query(
      `SELECT status, execution_id FROM agent_tasks WHERE id = ?`
    ).get(missionId) as { status: string; execution_id: string | null } | null;

    if (!mission) {
      db.run('ROLLBACK');
      return { success: false, error: 'Mission not found' };
    }

    if (mission.status !== 'queued') {
      db.run('ROLLBACK');
      return { success: false, error: `Cannot dequeue mission in status: ${mission.status}` };
    }

    // Check if already has an execution ID (crash recovery case)
    if (mission.execution_id) {
      db.run('ROLLBACK');
      return { success: false, error: 'Mission already has execution ID', executionId: mission.execution_id };
    }

    // Atomically update status and set execution ID
    db.run(
      `UPDATE agent_tasks SET status = 'running', assigned_to = ?, started_at = ?, execution_id = ? WHERE id = ? AND status = 'queued'`,
      [agentId, new Date().toISOString(), executionId, missionId]
    );

    db.run('COMMIT');
    return { success: true, executionId };
  } catch (e) {
    try { db.run('ROLLBACK'); } catch {}
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Check if a mission was already executed with a given execution ID.
 * Used for crash recovery to detect duplicate execution attempts.
 */
export function getMissionByExecutionId(executionId: string): MissionRecord | null {
  return db.query(
    `SELECT * FROM agent_tasks WHERE execution_id = ?`
  ).get(executionId) as MissionRecord | null;
}
