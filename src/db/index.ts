/**
 * Database operations - Agent Orchestra
 *
 * This module provides all database functions. Schema initialization
 * is handled by ./core.ts which is imported here.
 */

// Import database instance and schema from core module
import { db, DB_PATH, getVectorDb } from './core';

// Re-export core exports for backwards compatibility
export { db, DB_PATH, getVectorDb };

// Re-export utilities
export * from './utils';

// Re-export unified tasks module
export * from './unified-tasks';

// Re-export code files module
export * from './code-files';

// ============ Agent Functions ============

export function registerAgent(id: number, paneId: string, pid: number, name?: string) {
  const agentName = name || `Agent-${id}`;
  db.run(
    `INSERT OR REPLACE INTO agents (id, name, pane_id, pid, status, updated_at)
     VALUES (?, ?, ?, ?, 'idle', CURRENT_TIMESTAMP)`,
    [id, agentName, paneId, pid]
  );
  logEvent(id, 'agent_started', { pane_id: paneId, pid });
}

export function updateAgentStatus(id: number, status: string, taskId?: string) {
  db.run(
    `UPDATE agents SET status = ?, current_task_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, taskId || null, id]
  );
}

export function incrementAgentStats(id: number, completed: boolean, durationMs: number) {
  if (completed) {
    db.run(
      `UPDATE agents SET tasks_completed = tasks_completed + 1, total_duration_ms = total_duration_ms + ? WHERE id = ?`,
      [durationMs, id]
    );
  } else {
    db.run(
      `UPDATE agents SET tasks_failed = tasks_failed + 1 WHERE id = ?`,
      [id]
    );
  }
}

export function getAllAgents() {
  return db.query(`SELECT * FROM agents ORDER BY id`).all();
}

export function getAgent(id: number) {
  return db.query(`SELECT * FROM agents WHERE id = ?`).get(id);
}

// ============ Agent Conversation Functions ============

export function createConversation(
  id: string,
  participants: number[],
  topic?: string
): void {
  db.run(
    `INSERT INTO agent_conversations (id, participants, topic) VALUES (?, ?, ?)`,
    [id, JSON.stringify(participants), topic || null]
  );
}

export function getConversation(id: string): any {
  const row = db.query(`SELECT * FROM agent_conversations WHERE id = ?`).get(id) as any;
  if (row) {
    row.participants = JSON.parse(row.participants);
  }
  return row;
}

export function getConversationByThread(threadId: string): any {
  // Find conversation by thread ID from messages
  const msg = db.query(
    `SELECT conversation_id FROM agent_conversation_messages WHERE thread_id = ? LIMIT 1`
  ).get(threadId) as any;
  if (msg) {
    return getConversation(msg.conversation_id);
  }
  return null;
}

export function updateConversationStatus(id: string, status: 'active' | 'closed' | 'archived'): void {
  db.run(
    `UPDATE agent_conversations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, id]
  );
}

export function saveConversationMessage(
  id: string,
  conversationId: string,
  threadId: string | undefined,
  correlationId: string | undefined,
  fromAgent: number,
  toAgent: number | undefined,
  messageType: string,
  content: any,
  options?: {
    method?: string;
    ok?: boolean;
    deadlineMs?: number;
  }
): void {
  db.run(
    `INSERT INTO agent_conversation_messages
     (id, conversation_id, thread_id, correlation_id, from_agent, to_agent, message_type, method, content, ok, deadline_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      conversationId,
      threadId || null,
      correlationId || null,
      fromAgent,
      toAgent || null,
      messageType,
      options?.method || null,
      JSON.stringify(content),
      options?.ok !== undefined ? (options.ok ? 1 : 0) : null,
      options?.deadlineMs || null,
    ]
  );

  // Update conversation message count
  db.run(
    `UPDATE agent_conversations SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [conversationId]
  );
}

export function getConversationMessages(
  conversationId: string,
  limit = 100
): any[] {
  const rows = db.query(
    `SELECT * FROM agent_conversation_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC
     LIMIT ?`
  ).all(conversationId, limit) as any[];

  return rows.map(row => ({
    ...row,
    content: JSON.parse(row.content),
    ok: row.ok !== null ? row.ok === 1 : undefined,
  }));
}

export function getThreadMessages(threadId: string, limit = 100): any[] {
  const rows = db.query(
    `SELECT * FROM agent_conversation_messages
     WHERE thread_id = ?
     ORDER BY created_at ASC
     LIMIT ?`
  ).all(threadId, limit) as any[];

  return rows.map(row => ({
    ...row,
    content: JSON.parse(row.content),
    ok: row.ok !== null ? row.ok === 1 : undefined,
  }));
}

export function getAgentConversations(agentId: number, limit = 50): any[] {
  const rows = db.query(
    `SELECT * FROM agent_conversations
     WHERE participants LIKE ?
     ORDER BY updated_at DESC
     LIMIT ?`
  ).all(`%${agentId}%`, limit) as any[];

  return rows.map(row => ({
    ...row,
    participants: JSON.parse(row.participants),
  }));
}

export function getRecentAgentMessages(agentId: number, limit = 50): any[] {
  const rows = db.query(
    `SELECT * FROM agent_conversation_messages
     WHERE from_agent = ? OR to_agent = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(agentId, agentId, limit) as any[];

  return rows.map(row => ({
    ...row,
    content: JSON.parse(row.content),
    ok: row.ok !== null ? row.ok === 1 : undefined,
  }));
}

// ============ Message Functions ============

export function logMessage(
  agentId: number,
  direction: 'inbound' | 'outbound',
  content: string,
  messageType = 'info',
  source?: string
) {
  const result = db.run(
    `INSERT INTO messages (agent_id, direction, message_type, content, source) VALUES (?, ?, ?, ?, ?)`,
    [agentId, direction, messageType, content, source || null]
  );

  // Auto-embed message for semantic search (non-blocking, batched)
  // Uses the batched embedding queue for better throughput
  getVectorDb().then(vdb => {
    if (vdb.isInitialized && vdb.isInitialized() && vdb.queueMessageEmbed) {
      // Use batched embedding for better performance
      vdb.queueMessageEmbed(
        `msg_${result.lastInsertRowid}`,
        content,
        direction,
        {
          agent_id: agentId,
          message_type: messageType,
          source: source || undefined,
          created_at: new Date().toISOString(),
        }
      );
    }
  }).catch(() => {}); // Silently ignore module errors
}

// Legacy function for backwards compatibility
export function sendMessage(fromId: string, toId: string, content: string, type = "info") {
  const agentId = parseInt(fromId) || parseInt(toId) || 0;
  const direction = fromId === 'orchestrator' ? 'inbound' : 'outbound';
  logMessage(agentId, direction, content, type, fromId);
}

export function getAgentMessages(agentId: number, limit = 10) {
  return db.query(
    `SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(agentId, limit);
}

export function getRecentMessages(limit = 20) {
  return db.query(
    `SELECT * FROM messages ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
}

export function getMessageStats(agentId: number) {
  return db.query(`
    SELECT
      direction,
      COUNT(*) as count,
      MIN(created_at) as first_message,
      MAX(created_at) as last_message
    FROM messages
    WHERE agent_id = ?
    GROUP BY direction
  `).all(agentId);
}

// ============ Task Functions ============

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

// ============ Task Linking Functions ============

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

// ============ Mission Persistence Functions ============

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

// ============ Matrix Message Functions ============

export interface MatrixMessageRecord {
  id: number;
  message_id: string;
  from_matrix: string;
  to_matrix: string | null;
  content: string;
  message_type: 'broadcast' | 'direct';
  status: 'pending' | 'sending' | 'sent' | 'delivered' | 'failed';
  retry_count: number;
  max_retries: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  sequence_number: number;
  next_retry_at: string | null;
  attempted_at: string | null;
}

/**
 * Get the next sequence number for a matrix atomically
 * Uses INSERT ON CONFLICT for atomic increment
 */
export function getNextSequenceNumber(matrixId: string): number {
  // Atomic upsert: insert with 1 or increment existing
  db.run(`
    INSERT INTO matrix_sequence_counters (matrix_id, next_sequence)
    VALUES (?, 1)
    ON CONFLICT(matrix_id) DO UPDATE SET next_sequence = next_sequence + 1
  `, [matrixId]);

  // Get the current value (which we just set/incremented)
  const row = db.query(`SELECT next_sequence FROM matrix_sequence_counters WHERE matrix_id = ?`)
    .get(matrixId) as { next_sequence: number };

  return row.next_sequence;
}

/**
 * Save a new outgoing matrix message with sequence number
 * Returns both the row ID and sequence number for inclusion in the message payload
 */
export function saveMatrixMessage(msg: {
  messageId: string;
  fromMatrix: string;
  toMatrix?: string;
  content: string;
  messageType: 'broadcast' | 'direct';
  maxRetries?: number;
}): { rowId: number; sequenceNumber: number } {
  // Get the next sequence number for this matrix
  const sequenceNumber = getNextSequenceNumber(msg.fromMatrix);

  const result = db.run(`
    INSERT INTO matrix_messages (message_id, from_matrix, to_matrix, content, message_type, max_retries, sequence_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    msg.messageId,
    msg.fromMatrix,
    msg.toMatrix || null,
    msg.content,
    msg.messageType,
    msg.maxRetries || 3,
    sequenceNumber,
  ]);
  return { rowId: Number(result.lastInsertRowid), sequenceNumber };
}

/**
 * Mark message as 'sending' before transmission (two-phase commit)
 * This prevents duplicate sends if crash occurs after ws.send but before markMessageSent
 */
export function markMessageSending(messageId: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'sending', attempted_at = CURRENT_TIMESTAMP
    WHERE message_id = ?
  `, [messageId]);
}

/**
 * Mark message as sent (transmitted to hub successfully)
 */
export function markMessageSent(messageId: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'sent', sent_at = CURRENT_TIMESTAMP
    WHERE message_id = ?
  `, [messageId]);
}

/**
 * Mark message back to pending if send failed (for retry)
 */
export function markMessagePending(messageId: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'pending'
    WHERE message_id = ?
  `, [messageId]);
}

/**
 * Mark message as delivered (confirmed by recipient)
 */
export function markMessageDelivered(messageId: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
    WHERE message_id = ?
  `, [messageId]);
}

/**
 * Mark message as failed with error
 */
export function markMessageFailed(messageId: string, error: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'failed', error = ?
    WHERE message_id = ?
  `, [error, messageId]);
}

/**
 * Increment retry count for a message
 * Only updates pending messages to prevent duplicate sends
 */
/**
 * Calculate next retry time with exponential backoff and jitter
 * Base: 10s, Multiplier: 2x, Max: 5 minutes, Jitter: 0-2s
 */
function calculateNextRetryTime(retryCount: number): string {
  const BASE_DELAY_MS = 10000;    // 10 seconds
  const MAX_DELAY_MS = 300000;    // 5 minutes
  const JITTER_MAX_MS = 2000;     // 0-2 seconds random jitter

  // Exponential backoff: 10s, 20s, 40s, 80s, 160s (capped at 5 min)
  const exponentialDelay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount), MAX_DELAY_MS);

  // Add random jitter to prevent thundering herd
  const jitter = Math.floor(Math.random() * JITTER_MAX_MS);

  const nextRetryTime = new Date(Date.now() + exponentialDelay + jitter);
  return nextRetryTime.toISOString();
}

export function incrementMessageRetry(messageId: string): number {
  // Get current retry count first
  const msg = db.query(`SELECT retry_count FROM matrix_messages WHERE message_id = ?`).get(messageId) as { retry_count: number } | null;
  const currentRetryCount = msg?.retry_count || 0;

  // Calculate next retry time based on NEW retry count
  const nextRetryAt = calculateNextRetryTime(currentRetryCount);

  db.run(`
    UPDATE matrix_messages
    SET retry_count = retry_count + 1,
        attempted_at = CURRENT_TIMESTAMP,
        next_retry_at = ?
    WHERE message_id = ? AND status = 'pending'
  `, [nextRetryAt, messageId]);

  return currentRetryCount + 1;
}

/**
 * Get pending messages that are ready for retry
 * Returns messages where:
 * - status is 'pending' OR 'sending' (crashed mid-send)
 * - retry_count < maxRetries
 * - next_retry_at is NULL (never attempted) or in the past (ready for retry)
 */
export function getPendingMessages(maxRetries: number = 3): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE status IN ('pending', 'sending')
      AND retry_count < ?
      AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
    ORDER BY created_at ASC
  `).all(maxRetries) as MatrixMessageRecord[];
}

/**
 * Get failed messages that exceeded max retries
 */
export function getFailedMessages(limit: number = 20): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE status = 'failed'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as MatrixMessageRecord[];
}

/**
 * Save incoming message to inbox (with sequence number from source)
 */
export function saveIncomingMessage(msg: {
  messageId: string;
  fromMatrix: string;
  toMatrix?: string;
  content: string;
  messageType: 'broadcast' | 'direct';
  sequenceNumber?: number;
}): number {
  const result = db.run(`
    INSERT OR IGNORE INTO matrix_messages (message_id, from_matrix, to_matrix, content, message_type, status, sent_at, delivered_at, sequence_number)
    VALUES (?, ?, ?, ?, ?, 'delivered', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
  `, [
    msg.messageId,
    msg.fromMatrix,
    msg.toMatrix || null,
    msg.content,
    msg.messageType,
    msg.sequenceNumber || 0,
  ]);
  return Number(result.lastInsertRowid);
}

/**
 * Get unread messages for a matrix (ordered by sequence within each sender)
 */
export function getUnreadMessages(matrixId: string, limit: number = 50): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE (to_matrix = ? OR to_matrix IS NULL OR message_type = 'broadcast')
      AND from_matrix != ?
      AND status = 'delivered'
      AND read_at IS NULL
    ORDER BY from_matrix ASC, sequence_number ASC, created_at ASC
    LIMIT ?
  `).all(matrixId, matrixId, limit) as MatrixMessageRecord[];
}

/**
 * Get all inbox messages for a matrix (ordered by sequence within each sender)
 */
export function getInboxMessages(matrixId: string, limit: number = 50): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE (to_matrix = ? OR to_matrix IS NULL OR message_type = 'broadcast')
      AND from_matrix != ?
      AND status = 'delivered'
    ORDER BY from_matrix ASC, sequence_number ASC, created_at ASC
    LIMIT ?
  `).all(matrixId, matrixId, limit) as MatrixMessageRecord[];
}

/**
 * Mark messages as read
 */
export function markMessagesRead(messageIds: string[]): void {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => '?').join(',');
  db.run(`
    UPDATE matrix_messages
    SET read_at = CURRENT_TIMESTAMP
    WHERE message_id IN (${placeholders})
  `, messageIds);
}

/**
 * Get unread count for a matrix
 */
export function getUnreadCount(matrixId: string): number {
  const result = db.query(`
    SELECT COUNT(*) as count FROM matrix_messages
    WHERE (to_matrix = ? OR to_matrix IS NULL OR message_type = 'broadcast')
      AND from_matrix != ?
      AND status = 'delivered'
      AND read_at IS NULL
  `).get(matrixId, matrixId) as { count: number };
  return result.count;
}

/**
 * Clear inbox messages for a matrix
 */
export function clearInbox(matrixId: string): number {
  const result = db.run(`
    DELETE FROM matrix_messages
    WHERE (to_matrix = ? OR to_matrix IS NULL OR message_type = 'broadcast')
      AND from_matrix != ?
      AND status = 'delivered'
  `, matrixId, matrixId);
  return result.changes;
}

/**
 * Get outbox messages (sent by this matrix)
 */
export function getOutboxMessages(matrixId: string, limit: number = 50): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE from_matrix = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(matrixId, limit) as MatrixMessageRecord[];
}

// ============ Event Functions ============

export function logEvent(agentId: number, eventType: string, eventData: object) {
  db.run(
    `INSERT INTO events (agent_id, event_type, event_data) VALUES (?, ?, ?)`,
    [agentId, eventType, JSON.stringify(eventData)]
  );
}

export function getAgentEvents(agentId: number, limit = 50) {
  return db.query(
    `SELECT * FROM events WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(agentId, limit);
}

export function getRecentEvents(limit = 50) {
  return db.query(
    `SELECT * FROM events ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
}

// ============ Utility Functions ============

export function clearSession() {
  db.run(`DELETE FROM events`);
  db.run(`DELETE FROM messages`);
  db.run(`DELETE FROM agent_tasks`);
  db.run(`DELETE FROM agents`);
}

export function getFullAgentReport(agentId: number) {
  const agent = getAgent(agentId);
  const messages = getAgentMessages(agentId, 20);
  const tasks = getAgentTasks(agentId, undefined, 10);
  const events = getAgentEvents(agentId, 20);
  const messageStats = getMessageStats(agentId);

  return {
    agent,
    messages,
    tasks,
    events,
    messageStats,
  };
}

export function getDashboardData() {
  const agents = getAllAgents();
  const recentMessages = getRecentMessages(10);
  const recentEvents = getRecentEvents(10);
  const taskStats = getTaskStats();

  return {
    agents,
    recentMessages,
    recentEvents,
    taskStats,
  };
}

// ============ Session Memory Functions ============

/**
 * Code breadcrumb - reference to a specific code location
 */
export interface CodeBreadcrumb {
  file: string;           // Relative path from project root
  line?: number;          // Line number (optional)
  symbol?: string;        // Function/class/interface name
  type?: 'function' | 'class' | 'interface' | 'method' | 'type' | 'variable' | 'file';
  note?: string;          // Brief context about why this location matters
}

/**
 * Structured next step with actionable details
 */
export interface StructuredNextStep {
  action: string;                    // What needs to be done (imperative)
  priority?: 'high' | 'normal' | 'low';
  breadcrumbs?: CodeBreadcrumb[];    // Relevant code locations
  dependencies?: string[];           // What must be done first
  testCommand?: string;              // How to verify completion
}

/**
 * Mid-change state - captures work in progress
 */
export interface MidChangeState {
  uncommittedFiles?: string[];       // Files with uncommitted changes
  stagedFiles?: string[];            // Files staged for commit
  partialImplementations?: Array<{
    file: string;
    interface?: string;              // Interface being implemented
    implemented: string[];           // Methods/functions done
    pending: string[];               // Methods/functions remaining
  }>;
  currentFocus?: {                   // What was being worked on when paused
    file: string;
    task: string;
    line?: number;
  };
  gitDiff?: string;                  // Truncated diff of uncommitted changes
}

/**
 * Continuation bundle - everything needed to resume work
 */
export interface ContinuationBundle {
  // Priority reading list
  filesToRead: Array<{
    file: string;
    reason: string;                  // Why to read this file
    sections?: string[];             // Specific sections/functions to focus on
  }>;
  // Interface/type context
  keyTypes?: Array<{
    name: string;
    file: string;
    line?: number;
  }>;
  // Pending work with full context
  pendingWork: StructuredNextStep[];
  // Test/verify commands
  verifyCommands?: string[];
  // Quick context (1-2 sentences each)
  quickContext?: {
    whatWasDone: string;
    whatRemains: string;
    blockers?: string;
  };
}

export interface FullContext {
  // Session outcomes
  wins?: string[];
  issues?: string[];
  key_decisions?: string[];
  challenges?: string[];
  next_steps?: string[];                          // Legacy: simple string list
  // Ideas and learnings
  learnings?: string[];
  future_ideas?: string[];
  blockers_resolved?: string[];
  // Git context (auto-captured)
  git_branch?: string;
  git_commits?: string[];
  files_changed?: string[];
  diff_summary?: string;
  // Technical details
  commands_run?: string[];
  config_changes?: string[];
  // Claude Code context (auto-captured with --auto)
  user_messages?: string[];
  plan_file?: string;
  plan_title?: string;
  claude_session_id?: string;
  message_count?: number;
  // Enhanced continuation support (new)
  structured_next_steps?: StructuredNextStep[];   // Detailed actionable items
  code_breadcrumbs?: CodeBreadcrumb[];            // Key code locations
  mid_change_state?: MidChangeState;              // Work in progress
  continuation_bundle?: ContinuationBundle;       // Full handoff data
}

export type Visibility = 'private' | 'shared' | 'public';

export interface SessionRecord {
  id: string;
  previous_session_id?: string;
  summary: string;
  full_context?: FullContext;
  duration_mins?: number;
  commits_count?: number;
  tags?: string[];
  agent_id?: number | null;
  visibility?: Visibility;
  started_at?: string;
  ended_at?: string;
  created_at?: string;
  next_steps?: string[];
  challenges?: string[];
  project_path?: string;  // Git root path for project/matrix scoping
}

export function createSession(session: SessionRecord): void {
  db.run(
    `INSERT INTO sessions (id, previous_session_id, summary, full_context, duration_mins, commits_count, tags, agent_id, visibility, started_at, ended_at, project_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.previous_session_id || null,
      session.summary,
      session.full_context ? JSON.stringify(session.full_context) : null,
      session.duration_mins || null,
      session.commits_count || null,
      session.tags?.join(',') || null,
      session.agent_id ?? null,
      session.visibility || 'public',
      session.started_at || null,
      session.ended_at || null,
      session.project_path || null,
    ]
  );
}

export function getSessionById(sessionId: string): SessionRecord | null {
  const row = db.query(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as any;
  if (!row) return null;

  const fullContext: FullContext | null = row.full_context ? JSON.parse(row.full_context) : null;

  return {
    ...row,
    full_context: fullContext,
    tags: row.tags ? row.tags.split(',') : [],
    agent_id: row.agent_id ?? null,
    visibility: row.visibility || 'public',
    project_path: row.project_path || null,
  };
}

export interface ListSessionsOptions {
  tag?: string;
  since?: string;
  limit?: number;
  agentId?: number | null;
  includeShared?: boolean;
  projectPath?: string;  // Filter by project/git root path
}

export function listSessionsFromDb(options?: ListSessionsOptions): SessionRecord[] {
  const { tag, since, limit = 20, agentId, includeShared = true, projectPath } = options || {};
  let query = `SELECT * FROM sessions WHERE 1=1`;
  const params: any[] = [];

  // Project scoping - filter by git root path
  if (projectPath) {
    query += ` AND project_path = ?`;
    params.push(projectPath);
  }

  // Agent scoping
  if (agentId !== undefined) {
    if (includeShared) {
      // Include agent's own sessions plus shared/public from other agents
      query += ` AND (agent_id = ? OR agent_id IS NULL OR visibility IN ('shared', 'public'))`;
      params.push(agentId);
    } else {
      // Only agent's own sessions
      query += ` AND agent_id = ?`;
      params.push(agentId);
    }
  }

  if (tag) {
    query += ` AND tags LIKE ?`;
    params.push(`%${tag}%`);
  }
  if (since) {
    query += ` AND created_at >= ?`;
    params.push(since);
  }
  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.query(query).all(...params) as any[];
  return rows.map(row => ({
    ...row,
    full_context: row.full_context ? JSON.parse(row.full_context) : null,
    tags: row.tags ? row.tags.split(',') : [],
    agent_id: row.agent_id ?? null,
    visibility: row.visibility || 'public',
    project_path: row.project_path || null,
  }));
}

// ============ Learning Functions ============

// Maturity stages for knowledge progression (Oracle Incubate pattern)
export type MaturityStage = 'observation' | 'learning' | 'pattern' | 'principle' | 'wisdom';

export const MATURITY_ICONS: Record<MaturityStage, string> = {
  observation: '🥒',
  learning: '🌱',
  pattern: '🌿',
  principle: '🌳',
  wisdom: '🔮',
};

export const MATURITY_CRITERIA: Record<MaturityStage, { minValidations: number; description: string }> = {
  observation: { minValidations: 0, description: 'Raw insight, untested' },
  learning: { minValidations: 1, description: 'Tested once, not disproven' },
  pattern: { minValidations: 3, description: 'Used 3+ times, consistent results' },
  principle: { minValidations: 5, description: 'Context-independent, universally true' },
  wisdom: { minValidations: 10, description: 'Changed behavior fundamentally' },
};

export interface LearningRecord {
  id?: number;
  category: string;
  title: string;
  description?: string;
  context?: string;
  source_session_id?: string;
  source_url?: string;  // External reference URL(s)
  confidence?: 'low' | 'medium' | 'high' | 'proven';
  maturity_stage?: MaturityStage;
  times_validated?: number;
  last_validated_at?: string;
  agent_id?: number | null;
  visibility?: Visibility;
  created_at?: string;
  updated_at?: string;
  // Structured learning fields
  what_happened?: string;
  lesson?: string;
  prevention?: string;
  project_path?: string;  // Git root path for project/matrix scoping
  // Task linking fields
  source_task_id?: string;  // Link to agent_tasks that generated this
  source_mission_id?: string;  // Link to mission that generated this
  source_unified_task_id?: number;  // Link to business requirement
}

export function createLearning(learning: LearningRecord): number {
  const result = db.run(
    `INSERT INTO learnings (category, title, description, context, source_session_id, source_url, confidence, agent_id, visibility, what_happened, lesson, prevention, project_path, source_task_id, source_mission_id, source_unified_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      learning.category,
      learning.title,
      learning.description || null,
      learning.context || null,
      learning.source_session_id || null,
      learning.source_url || null,
      learning.confidence || 'medium',
      learning.agent_id ?? null,
      learning.visibility || 'public',
      learning.what_happened || null,
      learning.lesson || null,
      learning.prevention || null,
      learning.project_path || null,
      learning.source_task_id || null,
      learning.source_mission_id || null,
      learning.source_unified_task_id || null,
    ]
  );
  return Number(result.lastInsertRowid);
}

export function getLearningById(learningId: number): LearningRecord | null {
  const row = db.query(`SELECT * FROM learnings WHERE id = ?`).get(learningId) as any;
  if (!row) return null;
  return {
    ...row,
    agent_id: row.agent_id ?? null,
    visibility: row.visibility || 'public',
    project_path: row.project_path || null,
  };
}

/**
 * Full-text search for learnings using SQLite FTS5
 * Returns learnings matching the query keywords, ranked by relevance
 */
export function searchLearningsFTS(query: string, limit = 10): Array<LearningRecord & { fts_rank: number }> {
  // Escape special FTS5 characters and add prefix matching
  const ftsQuery = query
    .replace(/['"]/g, '') // Remove quotes
    .split(/\s+/)
    .filter(term => term.length > 1)
    .map(term => `"${term}"*`) // Prefix match each term
    .join(' OR ');

  if (!ftsQuery) return [];

  try {
    const rows = db.query(`
      SELECT l.*, fts.rank as fts_rank
      FROM learnings l
      JOIN learnings_fts fts ON l.id = fts.rowid
      WHERE learnings_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(ftsQuery, limit) as any[];

    return rows.map(row => ({
      ...row,
      agent_id: row.agent_id ?? null,
      visibility: row.visibility || 'public',
      project_path: row.project_path || null,
    }));
  } catch (error) {
    // FTS table might not be populated yet
    console.error('[FTS] Search error:', error);
    return [];
  }
}

/**
 * Rebuild FTS index from existing learnings data
 */
export function rebuildLearningsFTS(): number {
  // Clear existing FTS data
  db.run(`DELETE FROM learnings_fts`);

  // Repopulate from learnings table
  const result = db.run(`
    INSERT INTO learnings_fts(rowid, title, description, lesson)
    SELECT id, title, description, lesson FROM learnings
  `);

  return result.changes;
}

export function updateLearning(learningId: number, updates: Partial<Pick<LearningRecord, 'title' | 'description' | 'context' | 'confidence' | 'source_url' | 'what_happened' | 'lesson' | 'prevention'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.context !== undefined) { fields.push('context = ?'); values.push(updates.context); }
  if (updates.confidence !== undefined) { fields.push('confidence = ?'); values.push(updates.confidence); }
  if (updates.source_url !== undefined) { fields.push('source_url = ?'); values.push(updates.source_url); }
  if (updates.what_happened !== undefined) { fields.push('what_happened = ?'); values.push(updates.what_happened); }
  if (updates.lesson !== undefined) { fields.push('lesson = ?'); values.push(updates.lesson); }
  if (updates.prevention !== undefined) { fields.push('prevention = ?'); values.push(updates.prevention); }

  if (fields.length === 0) return false;

  values.push(learningId);
  db.run(`UPDATE learnings SET ${fields.join(', ')} WHERE id = ?`, values);
  return true;
}

export interface ListLearningsOptions {
  category?: string;
  confidence?: string;
  limit?: number;
  agentId?: number | null;
  includeShared?: boolean;
  projectPath?: string;  // Filter by project/git root path
}

export function listLearningsFromDb(options?: ListLearningsOptions): LearningRecord[] {
  const { category, confidence, limit = 50, agentId, includeShared = true, projectPath } = options || {};
  let query = `SELECT * FROM learnings WHERE 1=1`;
  const params: any[] = [];

  // Project scoping - filter by git root path
  if (projectPath) {
    query += ` AND project_path = ?`;
    params.push(projectPath);
  }

  // Agent scoping
  if (agentId !== undefined) {
    if (includeShared) {
      // Include agent's own learnings plus shared/public from other agents
      query += ` AND (agent_id = ? OR agent_id IS NULL OR visibility IN ('shared', 'public'))`;
      params.push(agentId);
    } else {
      // Only agent's own learnings
      query += ` AND agent_id = ?`;
      params.push(agentId);
    }
  }

  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }
  if (confidence) {
    query += ` AND confidence = ?`;
    params.push(confidence);
  }
  query += ` ORDER BY times_validated DESC, created_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.query(query).all(...params) as any[];
  return rows.map(row => ({
    ...row,
    agent_id: row.agent_id ?? null,
    visibility: row.visibility || 'public',
    project_path: row.project_path || null,
  }));
}

export interface ValidationResult {
  learning: LearningRecord;
  promoted: boolean;
  previousStage?: MaturityStage;
  newStage?: MaturityStage;
  promotionMessage?: string;
}

/**
 * Calculate maturity stage based on times validated
 */
export function calculateMaturityStage(timesValidated: number): MaturityStage {
  if (timesValidated >= 10) return 'wisdom';
  if (timesValidated >= 5) return 'principle';
  if (timesValidated >= 3) return 'pattern';
  if (timesValidated >= 1) return 'learning';
  return 'observation';
}

export function validateLearning(learningId: number): ValidationResult | null {
  const learning = getLearningById(learningId);
  if (!learning) return null;

  const newCount = (learning.times_validated || 1) + 1;
  let newConfidence = learning.confidence || 'medium';

  // Confidence progression
  if (newCount >= 5) newConfidence = 'proven';
  else if (newCount >= 3) newConfidence = 'high';
  else if (newCount >= 2) newConfidence = 'medium';

  // Maturity stage progression (Oracle Incubate pattern)
  const previousStage = learning.maturity_stage || 'observation';
  const newStage = calculateMaturityStage(newCount);
  const promoted = newStage !== previousStage;

  db.run(
    `UPDATE learnings SET times_validated = ?, confidence = ?, maturity_stage = ?, last_validated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newCount, newConfidence, newStage, learningId]
  );

  const updatedLearning = getLearningById(learningId)!;

  const result: ValidationResult = {
    learning: updatedLearning,
    promoted,
  };

  if (promoted) {
    result.previousStage = previousStage;
    result.newStage = newStage;
    result.promotionMessage = `${MATURITY_ICONS[previousStage]} → ${MATURITY_ICONS[newStage]} Promoted from ${previousStage} to ${newStage}!`;
  }

  return result;
}

/**
 * Apply confidence decay to stale learnings
 *
 * Learnings that haven't been validated in a long time are demoted:
 * - proven → high after 180 days
 * - high → medium after 90 days
 * - medium → low after 60 days (if times_validated < 3)
 *
 * @param dryRun - If true, only report what would be decayed without making changes
 * @returns Count of learnings decayed per confidence level
 */
export function applyConfidenceDecay(dryRun = false): {
  provenToHigh: number;
  highToMedium: number;
  mediumToLow: number;
  total: number;
} {
  const now = new Date().toISOString();

  // Get counts first
  const provenToHigh = (db.query(`
    SELECT COUNT(*) as count FROM learnings
    WHERE confidence = 'proven'
      AND last_validated_at IS NOT NULL
      AND last_validated_at < datetime('now', '-180 days')
  `).get() as { count: number }).count;

  const highToMedium = (db.query(`
    SELECT COUNT(*) as count FROM learnings
    WHERE confidence = 'high'
      AND last_validated_at IS NOT NULL
      AND last_validated_at < datetime('now', '-90 days')
  `).get() as { count: number }).count;

  const mediumToLow = (db.query(`
    SELECT COUNT(*) as count FROM learnings
    WHERE confidence = 'medium'
      AND times_validated < 3
      AND (last_validated_at IS NULL OR last_validated_at < datetime('now', '-60 days'))
  `).get() as { count: number }).count;

  if (!dryRun) {
    // Decay proven → high (180+ days)
    db.run(`
      UPDATE learnings SET confidence = 'high'
      WHERE confidence = 'proven'
        AND last_validated_at IS NOT NULL
        AND last_validated_at < datetime('now', '-180 days')
    `);

    // Decay high → medium (90+ days)
    db.run(`
      UPDATE learnings SET confidence = 'medium'
      WHERE confidence = 'high'
        AND last_validated_at IS NOT NULL
        AND last_validated_at < datetime('now', '-90 days')
    `);

    // Decay medium → low (60+ days, only if not well-validated)
    db.run(`
      UPDATE learnings SET confidence = 'low'
      WHERE confidence = 'medium'
        AND times_validated < 3
        AND (last_validated_at IS NULL OR last_validated_at < datetime('now', '-60 days'))
    `);
  }

  return {
    provenToHigh,
    highToMedium,
    mediumToLow,
    total: provenToHigh + highToMedium + mediumToLow,
  };
}

/**
 * Get learnings that are ready for promotion (close to next threshold)
 */
export function getPromotionCandidates(limit = 10): Array<LearningRecord & { nextStage: MaturityStage; validationsNeeded: number }> {
  const learnings = db.query(`
    SELECT * FROM learnings
    WHERE maturity_stage != 'wisdom'
    ORDER BY times_validated DESC
    LIMIT ?
  `).all(limit) as LearningRecord[];

  return learnings.map(l => {
    const currentValidations = l.times_validated || 1;
    const currentStage = l.maturity_stage || 'observation';

    // Find next stage threshold
    let nextStage: MaturityStage = 'learning';
    let threshold = 1;

    if (currentStage === 'observation') {
      nextStage = 'learning';
      threshold = 1;
    } else if (currentStage === 'learning') {
      nextStage = 'pattern';
      threshold = 3;
    } else if (currentStage === 'pattern') {
      nextStage = 'principle';
      threshold = 5;
    } else if (currentStage === 'principle') {
      nextStage = 'wisdom';
      threshold = 10;
    }

    return {
      ...l,
      nextStage,
      validationsNeeded: Math.max(0, threshold - currentValidations),
    };
  }).filter(l => l.validationsNeeded <= 2); // Only show if within 2 validations of promotion
}

export function getLearningsBySession(sessionId: string): LearningRecord[] {
  return db.query(
    `SELECT * FROM learnings WHERE source_session_id = ? ORDER BY created_at`
  ).all(sessionId) as LearningRecord[];
}

// ============ Link Functions ============

export function createSessionLink(fromId: string, toId: string, linkType: string, similarity?: number): boolean {
  try {
    db.run(
      `INSERT OR IGNORE INTO session_links (from_session_id, to_session_id, link_type, similarity_score)
       VALUES (?, ?, ?, ?)`,
      [fromId, toId, linkType, similarity || null]
    );
    return true;
  } catch {
    return false;
  }
}

export function createLearningLink(fromId: number, toId: number, linkType: string, similarity?: number): boolean {
  try {
    db.run(
      `INSERT OR IGNORE INTO learning_links (from_learning_id, to_learning_id, link_type, similarity_score)
       VALUES (?, ?, ?, ?)`,
      [fromId, toId, linkType, similarity || null]
    );
    return true;
  } catch {
    return false;
  }
}

export function getLinkedSessions(sessionId: string): Array<{ session: SessionRecord; link_type: string; similarity?: number }> {
  const links = db.query(
    `SELECT s.*, sl.link_type, sl.similarity_score
     FROM sessions s
     JOIN session_links sl ON s.id = sl.to_session_id
     WHERE sl.from_session_id = ?`
  ).all(sessionId) as any[];

  return links.map(row => ({
    session: {
      ...row,
      full_context: row.full_context ? JSON.parse(row.full_context) : null,
      tags: row.tags ? row.tags.split(',') : [],
    },
    link_type: row.link_type,
    similarity: row.similarity_score,
  }));
}

export function getLinkedLearnings(learningId: number): Array<{ learning: LearningRecord; link_type: string; similarity?: number }> {
  const links = db.query(
    `SELECT l.*, ll.link_type, ll.similarity_score
     FROM learnings l
     JOIN learning_links ll ON l.id = ll.to_learning_id
     WHERE ll.from_learning_id = ?`
  ).all(learningId) as any[];

  return links.map(row => ({
    learning: row as LearningRecord,
    link_type: row.link_type,
    similarity: row.similarity_score,
  }));
}

// ============ Entity Functions (Knowledge Graph) ============

export interface EntityRecord {
  id?: number;
  name: string;
  type?: 'concept' | 'tool' | 'pattern' | 'file' | 'category';
  created_at?: string;
}

// Stopwords for entity extraction
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also',
  'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'any', 'some',
  'use', 'using', 'used', 'uses', 'get', 'set', 'add', 'new', 'old',
]);

/**
 * Extract entities (keywords) from text
 */
export function extractEntities(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')  // Keep hyphens for compound terms
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOPWORDS.has(word))
    .filter((word, index, self) => self.indexOf(word) === index); // Dedupe
}

/**
 * Get or create an entity by name
 */
export function getOrCreateEntity(name: string, type: EntityRecord['type'] = 'concept'): number {
  const normalized = name.toLowerCase().trim();

  // Atomic upsert - no TOCTOU race condition
  db.run(
    `INSERT INTO entities (name, type) VALUES (?, ?)
     ON CONFLICT(name) DO NOTHING`,
    [normalized, type]
  );

  // Get the ID (either newly inserted or existing)
  const row = db.query(`SELECT id FROM entities WHERE name = ?`).get(normalized) as { id: number };
  return row.id;
}

/**
 * Link a learning to an entity
 */
export function linkLearningToEntity(learningId: number, entityId: number, relevance: number = 1.0): void {
  db.run(
    `INSERT OR REPLACE INTO learning_entities (learning_id, entity_id, relevance) VALUES (?, ?, ?)`,
    [learningId, entityId, relevance]
  );
}

/**
 * Extract and link entities for a learning
 */
export function extractAndLinkEntities(learningId: number, text: string): string[] {
  const entities = extractEntities(text);

  for (const entityName of entities) {
    const entityId = getOrCreateEntity(entityName);
    linkLearningToEntity(learningId, entityId);
  }

  return entities;
}

/**
 * Get all entities for a learning
 */
export function getLearningEntities(learningId: number): EntityRecord[] {
  return db.query(
    `SELECT e.* FROM entities e
     JOIN learning_entities le ON e.id = le.entity_id
     WHERE le.learning_id = ?
     ORDER BY le.relevance DESC`
  ).all(learningId) as EntityRecord[];
}

/**
 * Get all learnings for an entity (by name or ID)
 */
export function getEntityLearnings(entityNameOrId: string | number): LearningRecord[] {
  const query = typeof entityNameOrId === 'number'
    ? `SELECT l.* FROM learnings l
       JOIN learning_entities le ON l.id = le.learning_id
       WHERE le.entity_id = ?
       ORDER BY l.confidence DESC, l.times_validated DESC`
    : `SELECT l.* FROM learnings l
       JOIN learning_entities le ON l.id = le.learning_id
       JOIN entities e ON le.entity_id = e.id
       WHERE e.name = ?
       ORDER BY l.confidence DESC, l.times_validated DESC`;

  const param = typeof entityNameOrId === 'number' ? entityNameOrId : entityNameOrId.toLowerCase().trim();
  return db.query(query).all(param) as LearningRecord[];
}

/**
 * Get related entities (entities that co-occur with given entity in learnings)
 */
export function getRelatedEntities(entityName: string, limit: number = 10): Array<{ entity: EntityRecord; sharedCount: number }> {
  const normalized = entityName.toLowerCase().trim();

  const results = db.query(
    `SELECT e.*, COUNT(DISTINCT le2.learning_id) as shared_count
     FROM entities e
     JOIN learning_entities le2 ON e.id = le2.entity_id
     WHERE le2.learning_id IN (
       SELECT le1.learning_id FROM learning_entities le1
       JOIN entities e1 ON le1.entity_id = e1.id
       WHERE e1.name = ?
     )
     AND e.name != ?
     GROUP BY e.id
     ORDER BY shared_count DESC
     LIMIT ?`
  ).all(normalized, normalized, limit) as any[];

  return results.map(row => ({
    entity: { id: row.id, name: row.name, type: row.type, created_at: row.created_at },
    sharedCount: row.shared_count,
  }));
}

/**
 * Get entity by name
 */
export function getEntityByName(name: string): EntityRecord | null {
  const normalized = name.toLowerCase().trim();
  return db.query(`SELECT * FROM entities WHERE name = ?`).get(normalized) as EntityRecord | null;
}

/**
 * List all entities with learning counts
 */
export function listEntities(limit: number = 50): Array<{ entity: EntityRecord; learningCount: number }> {
  const results = db.query(
    `SELECT e.*, COUNT(le.learning_id) as learning_count
     FROM entities e
     LEFT JOIN learning_entities le ON e.id = le.entity_id
     GROUP BY e.id
     ORDER BY learning_count DESC
     LIMIT ?`
  ).all(limit) as any[];

  return results.map(row => ({
    entity: { id: row.id, name: row.name, type: row.type, created_at: row.created_at },
    learningCount: row.learning_count,
  }));
}

/**
 * Find path between two entities through shared learnings (BFS)
 * Returns array of steps: [{entity, learning}, ...]
 */
export function findEntityPath(
  fromEntity: string,
  toEntity: string,
  maxDepth: number = 4
): Array<{ entity: EntityRecord; learning: LearningRecord | null }> | null {
  const fromNorm = fromEntity.toLowerCase().trim();
  const toNorm = toEntity.toLowerCase().trim();

  // Get starting entity
  const startEntity = getEntityByName(fromNorm);
  const endEntity = getEntityByName(toNorm);

  if (!startEntity || !endEntity || !startEntity.id || !endEntity.id) return null;
  if (startEntity.id === endEntity.id) return [{ entity: startEntity, learning: null }];

  const startId = startEntity.id;
  const endId = endEntity.id;

  // BFS to find shortest path
  const visited = new Set<number>([startId]);
  const queue: Array<{
    entityId: number;
    path: Array<{ entityId: number; learningId: number | null }>;
  }> = [{ entityId: startId, path: [{ entityId: startId, learningId: null }] }];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.path.length > maxDepth) continue;

    // Get learnings for current entity
    const learnings = db.query(
      `SELECT l.id as learning_id, e.id as entity_id
       FROM learnings l
       JOIN learning_entities le1 ON l.id = le1.learning_id
       JOIN learning_entities le2 ON l.id = le2.learning_id
       JOIN entities e ON le2.entity_id = e.id
       WHERE le1.entity_id = ? AND e.id != ?`
    ).all(current.entityId, current.entityId) as Array<{ learning_id: number; entity_id: number }>;

    for (const row of learnings) {
      if (visited.has(row.entity_id)) continue;
      visited.add(row.entity_id);

      const newPath = [...current.path, { entityId: row.entity_id, learningId: row.learning_id }];

      // Found target
      if (row.entity_id === endId) {
        // Convert to full records
        return newPath.map(step => ({
          entity: db.query(`SELECT * FROM entities WHERE id = ?`).get(step.entityId) as EntityRecord,
          learning: step.learningId
            ? (db.query(`SELECT * FROM learnings WHERE id = ?`).get(step.learningId) as LearningRecord)
            : null,
        }));
      }

      queue.push({ entityId: row.entity_id, path: newPath });
    }
  }

  return null; // No path found
}

// ============ Entity Relationship Functions ============

export type RelationshipType =
  | 'depends_on' | 'enables' | 'conflicts_with' | 'alternative_to'
  | 'specializes' | 'generalizes' | 'precedes' | 'follows' | 'complements';

export interface EntityRelationship {
  id?: number;
  source_entity_id: number;
  target_entity_id: number;
  relationship_type: RelationshipType;
  strength: number;
  bidirectional: boolean;
  reasoning?: string;
  source_learning_id?: number;
  created_at?: string;
}

export interface EntityRelationshipWithNames extends EntityRelationship {
  source_name: string;
  target_name: string;
}

/**
 * Add a relationship between two entities
 */
export function addEntityRelationship(
  sourceEntityId: number,
  targetEntityId: number,
  type: RelationshipType,
  options: {
    strength?: number;
    bidirectional?: boolean;
    reasoning?: string;
    sourceLearningId?: number;
  } = {}
): number {
  const { strength = 1.0, bidirectional = false, reasoning, sourceLearningId } = options;

  db.run(
    `INSERT INTO entity_relationships
     (source_entity_id, target_entity_id, relationship_type, strength, bidirectional, reasoning, source_learning_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_entity_id, target_entity_id, relationship_type) DO UPDATE SET
       strength = excluded.strength,
       bidirectional = excluded.bidirectional,
       reasoning = excluded.reasoning`,
    [sourceEntityId, targetEntityId, type, strength, bidirectional ? 1 : 0, reasoning, sourceLearningId]
  );

  const row = db.query(`SELECT last_insert_rowid() as id`).get() as { id: number };
  return row.id;
}

/**
 * Get all relationships for an entity (outgoing and optionally incoming)
 */
export function getEntityRelationships(
  entityId: number,
  options: { includeIncoming?: boolean; types?: RelationshipType[] } = {}
): EntityRelationshipWithNames[] {
  const { includeIncoming = true, types } = options;

  let sql = `
    SELECT r.*,
           es.name as source_name,
           et.name as target_name
    FROM entity_relationships r
    JOIN entities es ON r.source_entity_id = es.id
    JOIN entities et ON r.target_entity_id = et.id
    WHERE r.source_entity_id = ?`;

  if (includeIncoming) {
    sql += ` OR r.target_entity_id = ?`;
  }

  if (types && types.length > 0) {
    const typePlaceholders = types.map(() => '?').join(', ');
    sql += ` AND r.relationship_type IN (${typePlaceholders})`;
  }

  sql += ` ORDER BY r.strength DESC`;

  const params: any[] = includeIncoming ? [entityId, entityId] : [entityId];
  if (types && types.length > 0) {
    params.push(...types);
  }

  const results = db.query(sql).all(...params) as any[];

  return results.map(row => ({
    id: row.id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    relationship_type: row.relationship_type as RelationshipType,
    strength: row.strength,
    bidirectional: row.bidirectional === 1,
    reasoning: row.reasoning,
    source_learning_id: row.source_learning_id,
    created_at: row.created_at,
    source_name: row.source_name,
    target_name: row.target_name,
  }));
}

/**
 * Get entity hierarchy (generalizes/specializes chains)
 */
export function getEntityHierarchy(
  entityName: string,
  direction: 'up' | 'down' | 'both' = 'both'
): { ancestors: EntityRecord[]; descendants: EntityRecord[] } {
  const entity = getEntityByName(entityName);
  if (!entity || !entity.id) {
    return { ancestors: [], descendants: [] };
  }

  const ancestors: EntityRecord[] = [];
  const descendants: EntityRecord[] = [];

  // Go up (generalizes)
  if (direction === 'up' || direction === 'both') {
    const visited = new Set<number>([entity.id]);
    const queue = [entity.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const parents = db.query(`
        SELECT e.* FROM entities e
        JOIN entity_relationships r ON e.id = r.target_entity_id
        WHERE r.source_entity_id = ? AND r.relationship_type = 'specializes'
      `).all(currentId) as EntityRecord[];

      for (const parent of parents) {
        if (parent.id && !visited.has(parent.id)) {
          visited.add(parent.id);
          ancestors.push(parent);
          queue.push(parent.id);
        }
      }
    }
  }

  // Go down (specializes)
  if (direction === 'down' || direction === 'both') {
    const visited = new Set<number>([entity.id]);
    const queue = [entity.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = db.query(`
        SELECT e.* FROM entities e
        JOIN entity_relationships r ON e.id = r.source_entity_id
        WHERE r.target_entity_id = ? AND r.relationship_type = 'specializes'
      `).all(currentId) as EntityRecord[];

      for (const child of children) {
        if (child.id && !visited.has(child.id)) {
          visited.add(child.id);
          descendants.push(child);
          queue.push(child.id);
        }
      }
    }
  }

  return { ancestors, descendants };
}

/**
 * Find entities by relationship type
 */
export function findEntitiesByRelationship(
  entityName: string,
  relationshipType: RelationshipType,
  direction: 'outgoing' | 'incoming' | 'both' = 'both'
): EntityRecord[] {
  const entity = getEntityByName(entityName);
  if (!entity || !entity.id) return [];

  const results: EntityRecord[] = [];
  const visited = new Set<number>();

  if (direction === 'outgoing' || direction === 'both') {
    const outgoing = db.query(`
      SELECT e.* FROM entities e
      JOIN entity_relationships r ON e.id = r.target_entity_id
      WHERE r.source_entity_id = ? AND r.relationship_type = ?
    `).all(entity.id, relationshipType) as EntityRecord[];

    for (const e of outgoing) {
      if (e.id && !visited.has(e.id)) {
        visited.add(e.id);
        results.push(e);
      }
    }
  }

  if (direction === 'incoming' || direction === 'both') {
    const incoming = db.query(`
      SELECT e.* FROM entities e
      JOIN entity_relationships r ON e.id = r.source_entity_id
      WHERE r.target_entity_id = ? AND r.relationship_type = ?
    `).all(entity.id, relationshipType) as EntityRecord[];

    for (const e of incoming) {
      if (e.id && !visited.has(e.id)) {
        visited.add(e.id);
        results.push(e);
      }
    }
  }

  return results;
}

/**
 * Get relationship statistics
 */
export function getRelationshipStats(): {
  total: number;
  byType: Record<RelationshipType, number>;
  avgStrength: number;
} {
  const total = db.query(`SELECT COUNT(*) as count FROM entity_relationships`).get() as { count: number };
  const avgStrength = db.query(`SELECT AVG(strength) as avg FROM entity_relationships`).get() as { avg: number | null };

  const byType: Record<RelationshipType, number> = {} as any;
  const types = db.query(`
    SELECT relationship_type, COUNT(*) as count
    FROM entity_relationships
    GROUP BY relationship_type
  `).all() as Array<{ relationship_type: RelationshipType; count: number }>;

  for (const row of types) {
    byType[row.relationship_type] = row.count;
  }

  return {
    total: total.count,
    byType,
    avgStrength: avgStrength.avg ?? 0,
  };
}

// ============ Analytics Functions ============

export function getSessionStats() {
  const total = db.query(`SELECT COUNT(*) as count FROM sessions`).get() as { count: number };
  const avgDuration = db.query(`SELECT AVG(duration_mins) as avg FROM sessions WHERE duration_mins IS NOT NULL`).get() as { avg: number };
  const totalCommits = db.query(`SELECT SUM(commits_count) as sum FROM sessions WHERE commits_count IS NOT NULL`).get() as { sum: number };

  // Sessions this week and month
  const thisWeek = db.query(`
    SELECT COUNT(*) as count FROM sessions
    WHERE created_at >= datetime('now', '-7 days')
  `).get() as { count: number };

  const thisMonth = db.query(`
    SELECT COUNT(*) as count FROM sessions
    WHERE created_at >= datetime('now', '-30 days')
  `).get() as { count: number };

  // Sessions by month
  const sessionsByMonth = db.query(`
    SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
    FROM sessions
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all() as { month: string; count: number }[];

  // Top tags
  const sessions = db.query(`SELECT tags FROM sessions WHERE tags IS NOT NULL`).all() as { tags: string }[];
  const tagCounts: Record<string, number> = {};
  for (const s of sessions) {
    for (const tag of s.tags.split(',')) {
      const t = tag.trim();
      if (t) tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return {
    total_sessions: total.count,
    avg_duration_mins: avgDuration.avg ? Math.round(avgDuration.avg) : null,
    total_commits: totalCommits.sum || 0,
    sessions_this_week: thisWeek.count,
    sessions_this_month: thisMonth.count,
    sessions_by_month: sessionsByMonth,
    top_tags: topTags,
  };
}

export function getImprovementReport() {
  const totalLearnings = db.query(`SELECT COUNT(*) as count FROM learnings`).get() as { count: number };

  // By category (aggregated)
  const byCategory = db.query(`
    SELECT category, COUNT(*) as count
    FROM learnings
    GROUP BY category
    ORDER BY count DESC
  `).all() as { category: string; count: number }[];

  // By confidence level
  const byConfidence = db.query(`
    SELECT confidence, COUNT(*) as count
    FROM learnings
    GROUP BY confidence
    ORDER BY
      CASE confidence
        WHEN 'proven' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END
  `).all() as { confidence: string; count: number }[];

  // Recently validated learnings
  const recentlyValidated = db.query(`
    SELECT * FROM learnings
    WHERE last_validated_at IS NOT NULL
    ORDER BY last_validated_at DESC
    LIMIT 5
  `).all() as LearningRecord[];

  // Proven learnings (best practices)
  const provenLearnings = db.query(`
    SELECT * FROM learnings
    WHERE confidence = 'proven'
    ORDER BY times_validated DESC
    LIMIT 10
  `).all() as LearningRecord[];

  return {
    total_learnings: totalLearnings.count,
    by_category: byCategory,
    by_confidence: byConfidence,
    recently_validated: recentlyValidated,
    proven_learnings: provenLearnings,
  };
}

// ============ Task-Session Linking Functions ============

/**
 * Link a task to a session
 */
export function linkTaskToSession(taskId: string, sessionId: string): boolean {
  try {
    db.run(
      `UPDATE agent_tasks SET session_id = ? WHERE id = ?`,
      [sessionId, taskId]
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all tasks for a specific session
 */
export function getTasksBySession(sessionId: string, limit = 50): any[] {
  return db.query(
    `SELECT * FROM agent_tasks WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(sessionId, limit);
}

/**
 * Get the session associated with a task
 */
export function getSessionByTask(taskId: string): SessionRecord | null {
  const task = db.query(`SELECT session_id FROM agent_tasks WHERE id = ?`).get(taskId) as any;
  if (!task?.session_id) return null;
  return getSessionById(task.session_id);
}

/**
 * Get tasks that are not linked to any session
 */
export function getUnlinkedTasks(agentId?: number, limit = 50): any[] {
  if (agentId) {
    return db.query(
      `SELECT * FROM agent_tasks WHERE session_id IS NULL AND agent_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(agentId, limit);
  }
  return db.query(
    `SELECT * FROM agent_tasks WHERE session_id IS NULL ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
}

/**
 * Get high-confidence learnings for context injection
 */
export function getHighConfidenceLearnings(limit = 10): LearningRecord[] {
  return db.query(`
    SELECT * FROM learnings
    WHERE confidence IN ('proven', 'high')
    ORDER BY
      CASE confidence WHEN 'proven' THEN 1 WHEN 'high' THEN 2 END,
      times_validated DESC
    LIMIT ?
  `).all(limit) as LearningRecord[];
}

/**
 * Get recent sessions for context bundle
 */
export function getRecentSessions(limit = 3): SessionRecord[] {
  const rows = db.query(
    `SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as any[];

  return rows.map(row => ({
    ...row,
    full_context: row.full_context ? JSON.parse(row.full_context) : null,
    tags: row.tags ? row.tags.split(',') : [],
    next_steps: row.next_steps ? JSON.parse(row.next_steps) : [],
    challenges: row.challenges ? JSON.parse(row.challenges) : [],
  }));
}

// ============ Session Task Functions ============

export interface SessionTask {
  id?: number;
  session_id: string;
  description: string;
  status: 'done' | 'pending' | 'blocked' | 'in_progress';
  priority?: 'low' | 'normal' | 'high';
  started_at?: string;
  completed_at?: string;
  notes?: string;
  created_at?: string;
}

/**
 * Create a task for a session
 */
export function createSessionTask(task: SessionTask): number {
  const result = db.run(
    `INSERT INTO session_tasks (session_id, description, status, priority, started_at, completed_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      task.session_id,
      task.description,
      task.status || 'pending',
      task.priority || 'normal',
      task.started_at || null,
      task.completed_at || null,
      task.notes || null,
    ]
  );
  return Number(result.lastInsertRowid);
}

/**
 * Get all tasks for a session
 */
export function getSessionTasks(sessionId: string): SessionTask[] {
  return db.query(
    `SELECT * FROM session_tasks WHERE session_id = ? ORDER BY created_at`
  ).all(sessionId) as SessionTask[];
}

/**
 * Get tasks by status for a session
 */
export function getTasksByStatus(sessionId: string, status: string): SessionTask[] {
  return db.query(
    `SELECT * FROM session_tasks WHERE session_id = ? AND status = ? ORDER BY created_at`
  ).all(sessionId, status) as SessionTask[];
}

/**
 * Update a session task's status
 */
export function updateSessionTaskStatus(taskId: number, status: string, completedAt?: string): boolean {
  try {
    if (status === 'done' && !completedAt) {
      completedAt = new Date().toISOString();
    }
    db.run(
      `UPDATE session_tasks SET status = ?, completed_at = ? WHERE id = ?`,
      [status, completedAt || null, taskId]
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get task statistics for a session
 */
export function getSessionTaskStats(sessionId: string): { done: number; pending: number; blocked: number; in_progress: number } {
  const stats = db.query(`
    SELECT status, COUNT(*) as count
    FROM session_tasks
    WHERE session_id = ?
    GROUP BY status
  `).all(sessionId) as { status: string; count: number }[];

  const result = { done: 0, pending: 0, blocked: 0, in_progress: 0 };
  for (const row of stats) {
    if (row.status in result) {
      result[row.status as keyof typeof result] = row.count;
    }
  }
  return result;
}

/**
 * Get a single session task by ID
 */
export function getSessionTaskById(taskId: number): SessionTask | null {
  return db.query(`SELECT * FROM session_tasks WHERE id = ?`).get(taskId) as SessionTask | null;
}

/**
 * Get all session tasks (for search/indexing)
 */
export function getAllSessionTasks(limit = 100): SessionTask[] {
  return db.query(
    `SELECT * FROM session_tasks ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as SessionTask[];
}

/**
 * Get all pending/blocked/in_progress tasks across all sessions
 */
export function getAllPendingTasks(limit = 100): SessionTask[] {
  return db.query(
    `SELECT * FROM session_tasks
     WHERE status IN ('pending', 'blocked', 'in_progress')
     ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as SessionTask[];
}

/**
 * Update session task with auto-tracking of started_at
 */
export function updateSessionTask(taskId: number, updates: { status?: string; notes?: string }): boolean {
  const task = getSessionTaskById(taskId);
  if (!task) return false;

  const now = new Date().toISOString();
  let startedAt = task.started_at;
  let completedAt = task.completed_at;

  // Auto-set started_at when transitioning to in_progress
  if (updates.status === 'in_progress' && !task.started_at) {
    startedAt = now;
  }

  // Auto-set completed_at when transitioning to done
  if (updates.status === 'done' && !task.completed_at) {
    completedAt = now;
  }

  db.run(
    `UPDATE session_tasks
     SET status = COALESCE(?, status),
         notes = COALESCE(?, notes),
         started_at = ?,
         completed_at = ?
     WHERE id = ?`,
    [updates.status || null, updates.notes || null, startedAt || null, completedAt || null, taskId]
  );
  return true;
}

// ============ Purge/Reset Functions ============

export interface PurgeResult {
  sessions: number;
  learnings: number;
  sessionLinks: number;
  learningLinks: number;
  tasks: number;
}

/**
 * Purge all sessions (and related data)
 */
export function purgeSessions(options?: { before?: string; keep?: number }): PurgeResult {
  const { before, keep } = options || {};

  let sessionIds: string[] = [];

  if (keep !== undefined) {
    // Get IDs of sessions to keep (most recent N)
    const keepIds = db.query(
      `SELECT id FROM sessions ORDER BY created_at DESC LIMIT ?`
    ).all(keep) as { id: string }[];
    const keepIdSet = new Set(keepIds.map(r => r.id));

    // Get all sessions except those we're keeping
    const allIds = db.query(`SELECT id FROM sessions`).all() as { id: string }[];
    sessionIds = allIds.filter(r => !keepIdSet.has(r.id)).map(r => r.id);
  } else if (before) {
    const rows = db.query(
      `SELECT id FROM sessions WHERE created_at < ?`
    ).all(before) as { id: string }[];
    sessionIds = rows.map(r => r.id);
  } else {
    const rows = db.query(`SELECT id FROM sessions`).all() as { id: string }[];
    sessionIds = rows.map(r => r.id);
  }

  if (sessionIds.length === 0) {
    return { sessions: 0, learnings: 0, sessionLinks: 0, learningLinks: 0, tasks: 0 };
  }

  const placeholders = sessionIds.map(() => '?').join(',');

  // Delete related data
  const tasksDeleted = db.run(
    `DELETE FROM session_tasks WHERE session_id IN (${placeholders})`,
    sessionIds
  ).changes;

  const linksDeleted = db.run(
    `DELETE FROM session_links WHERE from_session_id IN (${placeholders}) OR to_session_id IN (${placeholders})`,
    [...sessionIds, ...sessionIds]
  ).changes;

  // Delete sessions
  const sessionsDeleted = db.run(
    `DELETE FROM sessions WHERE id IN (${placeholders})`,
    sessionIds
  ).changes;

  return {
    sessions: sessionsDeleted,
    learnings: 0,
    sessionLinks: linksDeleted,
    learningLinks: 0,
    tasks: tasksDeleted,
  };
}

/**
 * Purge all learnings (and related links)
 */
export function purgeDuplicateLearnings(): PurgeResult {
  // Find duplicate learnings by title (keeping the one with highest confidence or oldest)
  const duplicates = db.query(`
    SELECT l1.id
    FROM learnings l1
    WHERE EXISTS (
      SELECT 1 FROM learnings l2
      WHERE l2.title = l1.title
      AND l2.id < l1.id
    )
  `).all() as { id: number }[];

  if (duplicates.length === 0) {
    return { sessions: 0, learnings: 0, sessionLinks: 0, learningLinks: 0, tasks: 0 };
  }

  const learningIds = duplicates.map(r => r.id);
  const placeholders = learningIds.map(() => '?').join(',');

  // Delete related links
  const linksDeleted = db.run(
    `DELETE FROM learning_links WHERE from_learning_id IN (${placeholders}) OR to_learning_id IN (${placeholders})`,
    [...learningIds, ...learningIds]
  ).changes;

  // Delete duplicate learnings
  const learningsDeleted = db.run(
    `DELETE FROM learnings WHERE id IN (${placeholders})`,
    learningIds
  ).changes;

  return {
    sessions: 0,
    learnings: learningsDeleted,
    sessionLinks: 0,
    learningLinks: linksDeleted,
    tasks: 0,
  };
}

export function purgeLearnings(options?: { before?: string; keep?: number }): PurgeResult {
  const { before, keep } = options || {};

  let learningIds: number[] = [];

  if (keep !== undefined) {
    const keepIds = db.query(
      `SELECT id FROM learnings ORDER BY created_at DESC LIMIT ?`
    ).all(keep) as { id: number }[];
    const keepIdSet = new Set(keepIds.map(r => r.id));

    const allIds = db.query(`SELECT id FROM learnings`).all() as { id: number }[];
    learningIds = allIds.filter(r => !keepIdSet.has(r.id)).map(r => r.id);
  } else if (before) {
    const rows = db.query(
      `SELECT id FROM learnings WHERE created_at < ?`
    ).all(before) as { id: number }[];
    learningIds = rows.map(r => r.id);
  } else {
    const rows = db.query(`SELECT id FROM learnings`).all() as { id: number }[];
    learningIds = rows.map(r => r.id);
  }

  if (learningIds.length === 0) {
    return { sessions: 0, learnings: 0, sessionLinks: 0, learningLinks: 0, tasks: 0 };
  }

  const placeholders = learningIds.map(() => '?').join(',');

  // Delete related links
  const linksDeleted = db.run(
    `DELETE FROM learning_links WHERE from_learning_id IN (${placeholders}) OR to_learning_id IN (${placeholders})`,
    [...learningIds, ...learningIds]
  ).changes;

  // Delete learnings
  const learningsDeleted = db.run(
    `DELETE FROM learnings WHERE id IN (${placeholders})`,
    learningIds
  ).changes;

  return {
    sessions: 0,
    learnings: learningsDeleted,
    sessionLinks: 0,
    learningLinks: linksDeleted,
    tasks: 0,
  };
}

/**
 * Reset all memory data (nuclear option)
 */
export function resetAllMemory(): PurgeResult {
  const sessions = db.run(`DELETE FROM sessions`).changes;
  const learnings = db.run(`DELETE FROM learnings`).changes;
  const sessionLinks = db.run(`DELETE FROM session_links`).changes;
  const learningLinks = db.run(`DELETE FROM learning_links`).changes;
  const tasks = db.run(`DELETE FROM session_tasks`).changes;

  return { sessions, learnings, sessionLinks, learningLinks, tasks };
}

// ============ Knowledge Functions (Dual-Collection Pattern) ============

export interface KnowledgeRecord {
  id?: number;
  content: string;
  mission_id?: string;
  category?: string;
  agent_id?: number;
  created_at?: string;
}

export function createKnowledge(knowledge: Omit<KnowledgeRecord, 'id' | 'created_at'>): number {
  const result = db.run(
    `INSERT INTO knowledge (content, mission_id, category, agent_id)
     VALUES (?, ?, ?, ?)`,
    [
      knowledge.content,
      knowledge.mission_id || null,
      knowledge.category || null,
      knowledge.agent_id ?? null,
    ]
  );
  return Number(result.lastInsertRowid);
}

export function getKnowledgeById(knowledgeId: number): KnowledgeRecord | null {
  return db.query(`SELECT * FROM knowledge WHERE id = ?`).get(knowledgeId) as KnowledgeRecord | null;
}

export function listKnowledge(options?: {
  category?: string;
  missionId?: string;
  agentId?: number;
  limit?: number;
}): KnowledgeRecord[] {
  const { category, missionId, agentId, limit = 50 } = options || {};
  let query = `SELECT * FROM knowledge WHERE 1=1`;
  const params: any[] = [];

  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }
  if (missionId) {
    query += ` AND mission_id = ?`;
    params.push(missionId);
  }
  if (agentId !== undefined) {
    query += ` AND agent_id = ?`;
    params.push(agentId);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  return db.query(query).all(...params) as KnowledgeRecord[];
}

// ============ Lesson Functions (Dual-Collection Pattern) ============

export interface LessonRecord {
  id?: number;
  problem: string;
  solution: string;
  outcome: string;
  category?: string;
  confidence?: number;
  frequency?: number;
  agent_id?: number;
  created_at?: string;
}

export function createLesson(lesson: Omit<LessonRecord, 'id' | 'created_at' | 'frequency'>): number {
  const result = db.run(
    `INSERT INTO lessons (problem, solution, outcome, category, confidence, agent_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      lesson.problem,
      lesson.solution,
      lesson.outcome,
      lesson.category || null,
      lesson.confidence ?? 0.5,
      lesson.agent_id ?? null,
    ]
  );
  return Number(result.lastInsertRowid);
}

export function getLessonById(lessonId: number): LessonRecord | null {
  return db.query(`SELECT * FROM lessons WHERE id = ?`).get(lessonId) as LessonRecord | null;
}

export function updateLessonFrequency(lessonId: number): void {
  db.run(
    `UPDATE lessons SET frequency = frequency + 1 WHERE id = ?`,
    [lessonId]
  );
}

export function updateLessonConfidence(lessonId: number, confidence: number): void {
  db.run(
    `UPDATE lessons SET confidence = ? WHERE id = ?`,
    [Math.max(0, Math.min(1, confidence)), lessonId]
  );
}

export function listLessons(options?: {
  category?: string;
  minConfidence?: number;
  agentId?: number;
  limit?: number;
}): LessonRecord[] {
  const { category, minConfidence, agentId, limit = 50 } = options || {};
  let query = `SELECT * FROM lessons WHERE 1=1`;
  const params: any[] = [];

  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }
  if (minConfidence !== undefined) {
    query += ` AND confidence >= ?`;
    params.push(minConfidence);
  }
  if (agentId !== undefined) {
    query += ` AND agent_id = ?`;
    params.push(agentId);
  }

  query += ` ORDER BY (frequency * confidence) DESC, created_at DESC LIMIT ?`;
  params.push(limit);

  return db.query(query).all(...params) as LessonRecord[];
}

/**
 * Find or create a lesson - if a similar problem exists, update frequency
 */
export function findOrCreateLesson(lesson: Omit<LessonRecord, 'id' | 'created_at' | 'frequency'>): number {
  // Check for existing lesson with same problem (case-insensitive)
  const existing = db.query(
    `SELECT id FROM lessons WHERE LOWER(problem) = LOWER(?) LIMIT 1`
  ).get(lesson.problem) as { id: number } | null;

  if (existing) {
    updateLessonFrequency(existing.id);
    return existing.id;
  }

  return createLesson(lesson);
}

/**
 * Decay confidence of stale learnings
 */
export function decayStaleConfidence(olderThanDays: number): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  // Decay proven → high, high → medium, medium → low
  // Skip those validated recently
  const result = db.run(`
    UPDATE learnings
    SET confidence = CASE
      WHEN confidence = 'proven' THEN 'high'
      WHEN confidence = 'high' THEN 'medium'
      WHEN confidence = 'medium' THEN 'low'
      ELSE confidence
    END
    WHERE created_at < ?
      AND (last_validated_at IS NULL OR last_validated_at < ?)
      AND confidence != 'low'
  `, [cutoffDate.toISOString(), cutoffDate.toISOString()]);

  return result.changes;
}

// ============ Matrix Registry Functions (Phase 3) ============

export type MatrixStatus = 'online' | 'offline' | 'away';

export interface MatrixRecord {
  id?: number;
  matrix_id: string;
  display_name?: string;
  last_seen?: string;
  status?: MatrixStatus;
  metadata?: Record<string, any>;
  created_at?: string;
}

/**
 * Register or update a matrix in the registry
 */
export function registerMatrix(matrixId: string, displayName?: string, metadata?: Record<string, any>): number {
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  // Atomic upsert using INSERT ON CONFLICT (no TOCTOU race condition)
  db.run(
    `INSERT INTO matrix_registry (matrix_id, display_name, status, metadata, last_seen)
     VALUES (?, ?, 'online', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(matrix_id) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, display_name),
       last_seen = CURRENT_TIMESTAMP,
       status = 'online',
       metadata = COALESCE(excluded.metadata, metadata)`,
    [matrixId, displayName || null, metadataJson]
  );

  // Get the ID (either newly inserted or existing)
  const row = db.query(`SELECT id FROM matrix_registry WHERE matrix_id = ?`).get(matrixId) as { id: number };
  return row.id;
}

/**
 * Update matrix status (online/offline/away)
 */
export function updateMatrixStatus(matrixId: string, status: MatrixStatus): boolean {
  const result = db.run(
    `UPDATE matrix_registry SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE matrix_id = ?`,
    [status, matrixId]
  );
  return result.changes > 0;
}

/**
 * Get a matrix by ID
 */
export function getMatrixById(matrixId: string): MatrixRecord | null {
  const row = db.query(`SELECT * FROM matrix_registry WHERE matrix_id = ?`).get(matrixId) as any;
  if (!row) return null;

  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

/**
 * Get all online matrices
 */
export function getOnlineMatrices(): MatrixRecord[] {
  const rows = db.query(
    `SELECT * FROM matrix_registry WHERE status = 'online' ORDER BY last_seen DESC`
  ).all() as any[];

  return rows.map(row => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));
}

/**
 * Get all registered matrices
 */
export function getAllMatrices(limit = 50): MatrixRecord[] {
  const rows = db.query(
    `SELECT * FROM matrix_registry ORDER BY last_seen DESC LIMIT ?`
  ).all(limit) as any[];

  return rows.map(row => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));
}

/**
 * Mark stale matrices as offline (no heartbeat within timeout)
 */
export function markStaleMatricesOffline(timeoutSeconds: number = 60): number {
  const result = db.run(
    `UPDATE matrix_registry SET status = 'offline' WHERE status = 'online' AND last_seen < datetime('now', '-${timeoutSeconds} seconds')`
  );
  return result.changes;
}

/**
 * Update matrix heartbeat (touch last_seen)
 */
export function touchMatrix(matrixId: string): boolean {
  const result = db.run(
    `UPDATE matrix_registry SET last_seen = CURRENT_TIMESTAMP WHERE matrix_id = ?`,
    [matrixId]
  );
  return result.changes > 0;
}

// ============ Symbol Functions (Code Learning) ============

export interface SymbolRecord {
  id?: number;
  code_file_id: string;
  name: string;
  type: 'function' | 'class' | 'export' | 'import';
  line_start?: number;
  line_end?: number;
  signature?: string;
  created_at?: string;
}

/**
 * Upsert a symbol (update or insert)
 */
export function upsertSymbol(symbol: Omit<SymbolRecord, 'id' | 'created_at'>): number {
  const existing = db.query(`
    SELECT id FROM symbols
    WHERE code_file_id = ? AND name = ? AND type = ?
  `).get(symbol.code_file_id, symbol.name, symbol.type) as { id: number } | null;

  if (existing) {
    db.run(`
      UPDATE symbols SET
        line_start = ?, line_end = ?, signature = ?
      WHERE id = ?
    `, [symbol.line_start || null, symbol.line_end || null, symbol.signature || null, existing.id]);
    return existing.id;
  }

  const result = db.run(`
    INSERT INTO symbols (code_file_id, name, type, line_start, line_end, signature)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    symbol.code_file_id,
    symbol.name,
    symbol.type,
    symbol.line_start || null,
    symbol.line_end || null,
    symbol.signature || null,
  ]);
  return Number(result.lastInsertRowid);
}

/**
 * Find symbols by name (supports partial match)
 */
export function findSymbolByName(name: string, options?: {
  type?: 'function' | 'class' | 'export' | 'import';
  exactMatch?: boolean;
  limit?: number;
}): Array<SymbolRecord & { file_path: string }> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.exactMatch) {
    conditions.push('s.name = ?');
    params.push(name);
  } else {
    conditions.push('s.name LIKE ?');
    params.push(`%${name}%`);
  }

  if (options?.type) {
    conditions.push('s.type = ?');
    params.push(options.type);
  }

  const limit = options?.limit || 20;

  // Params order: WHERE conditions, then CASE for name, then LIMIT
  return db.query(`
    SELECT s.*, cf.file_path
    FROM symbols s
    JOIN code_files cf ON s.code_file_id = cf.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE WHEN s.name = ? THEN 0 ELSE 1 END,
      s.name
    LIMIT ?
  `).all(...params, name, limit) as Array<SymbolRecord & { file_path: string }>;
}

/**
 * Get all symbols for a code file
 */
export function getSymbolsForFile(codeFileId: string): SymbolRecord[] {
  return db.query(`
    SELECT * FROM symbols
    WHERE code_file_id = ?
    ORDER BY line_start ASC, name ASC
  `).all(codeFileId) as SymbolRecord[];
}

/**
 * Clear all symbols for a file (before re-indexing)
 */
export function clearSymbolsForFile(codeFileId: string): number {
  return db.run('DELETE FROM symbols WHERE code_file_id = ?', [codeFileId]).changes;
}

/**
 * Bulk insert symbols efficiently
 */
export function bulkInsertSymbols(symbols: Array<Omit<SymbolRecord, 'id' | 'created_at'>>): number {
  if (symbols.length === 0) return 0;

  const stmt = db.prepare(`
    INSERT INTO symbols (code_file_id, name, type, line_start, line_end, signature)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.run('BEGIN TRANSACTION');
  try {
    for (const symbol of symbols) {
      stmt.run(
        symbol.code_file_id,
        symbol.name,
        symbol.type,
        symbol.line_start || null,
        symbol.line_end || null,
        symbol.signature || null
      );
      inserted++;
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }

  return inserted;
}

/**
 * Get symbol statistics
 */
export function getSymbolStats(): {
  totalSymbols: number;
  byType: Record<string, number>;
  filesWithSymbols: number;
} {
  const total = (db.query('SELECT COUNT(*) as c FROM symbols').get() as { c: number }).c;
  const files = (db.query('SELECT COUNT(DISTINCT code_file_id) as c FROM symbols').get() as { c: number }).c;

  const typeRows = db.query(`
    SELECT type, COUNT(*) as count FROM symbols
    GROUP BY type
  `).all() as { type: string; count: number }[];

  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    byType[row.type] = row.count;
  }

  return {
    totalSymbols: total,
    byType,
    filesWithSymbols: files,
  };
}

// ============ Code Pattern Functions (Pattern Learning) ============

export interface CodePatternRecord {
  id?: number;
  code_file_id: string;
  pattern_name: string;
  category?: string;
  description?: string;
  evidence?: string;
  line_number?: number;
  confidence: number;
  detected_at?: string;
}

/**
 * Upsert a detected pattern
 */
export function upsertCodePattern(pattern: Omit<CodePatternRecord, 'id' | 'detected_at'>): number {
  const existing = db.query(`
    SELECT id, confidence FROM code_patterns
    WHERE code_file_id = ? AND pattern_name = ? AND (line_number = ? OR (line_number IS NULL AND ? IS NULL))
  `).get(pattern.code_file_id, pattern.pattern_name, pattern.line_number, pattern.line_number) as { id: number; confidence: number } | null;

  if (existing) {
    // Increase confidence if re-detected
    const newConfidence = Math.min(1.0, existing.confidence + 0.1);
    db.run(`
      UPDATE code_patterns SET
        category = ?, description = ?, evidence = ?, confidence = ?, detected_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [pattern.category || null, pattern.description || null, pattern.evidence || null, newConfidence, existing.id]);
    return existing.id;
  }

  const result = db.run(`
    INSERT INTO code_patterns (code_file_id, pattern_name, category, description, evidence, line_number, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    pattern.code_file_id,
    pattern.pattern_name,
    pattern.category || null,
    pattern.description || null,
    pattern.evidence || null,
    pattern.line_number || null,
    pattern.confidence,
  ]);
  return Number(result.lastInsertRowid);
}

/**
 * Get patterns for a file
 */
export function getPatternsForFile(codeFileId: string): CodePatternRecord[] {
  return db.query(`
    SELECT * FROM code_patterns
    WHERE code_file_id = ?
    ORDER BY confidence DESC, pattern_name ASC
  `).all(codeFileId) as CodePatternRecord[];
}

/**
 * Find files containing a pattern
 */
export function getFilesByPattern(patternName: string, options?: {
  minConfidence?: number;
  limit?: number;
}): Array<CodePatternRecord & { file_path: string }> {
  const minConf = options?.minConfidence || 0.5;
  const limit = options?.limit || 50;

  return db.query(`
    SELECT cp.*, cf.file_path
    FROM code_patterns cp
    JOIN code_files cf ON cp.code_file_id = cf.id
    WHERE cp.pattern_name LIKE ?
      AND cp.confidence >= ?
    ORDER BY cp.confidence DESC
    LIMIT ?
  `).all(`%${patternName}%`, minConf, limit) as Array<CodePatternRecord & { file_path: string }>;
}

/**
 * Clear patterns for a file (before re-analysis)
 */
export function clearPatternsForFile(codeFileId: string): number {
  return db.run('DELETE FROM code_patterns WHERE code_file_id = ?', [codeFileId]).changes;
}

/**
 * Get pattern statistics
 */
export function getPatternStats(): {
  totalPatterns: number;
  byName: Record<string, number>;
  avgConfidence: number;
} {
  const total = (db.query('SELECT COUNT(*) as c FROM code_patterns').get() as { c: number }).c;
  const avgRow = db.query('SELECT AVG(confidence) as avg FROM code_patterns').get() as { avg: number | null };

  const nameRows = db.query(`
    SELECT pattern_name, COUNT(*) as count FROM code_patterns
    GROUP BY pattern_name
    ORDER BY count DESC
  `).all() as { pattern_name: string; count: number }[];

  const byName: Record<string, number> = {};
  for (const row of nameRows) {
    byName[row.pattern_name] = row.count;
  }

  return {
    totalPatterns: total,
    byName,
    avgConfidence: avgRow.avg || 0,
  };
}

// ============ Learning-Code Link Functions ============

export interface LearningCodeLinkRecord {
  id?: number;
  learning_id: number;
  code_file_id: string;
  link_type: 'derived_from' | 'applies_to' | 'example_in' | 'pattern_match';
  relevance_score: number;
  created_at?: string;
}

/**
 * Link a learning to a code file
 */
export function linkLearningToCode(link: Omit<LearningCodeLinkRecord, 'id' | 'created_at'>): number {
  try {
    const result = db.run(`
      INSERT INTO learning_code_links (learning_id, code_file_id, link_type, relevance_score)
      VALUES (?, ?, ?, ?)
    `, [link.learning_id, link.code_file_id, link.link_type, link.relevance_score]);
    return Number(result.lastInsertRowid);
  } catch {
    // Unique constraint - update relevance instead
    db.run(`
      UPDATE learning_code_links SET relevance_score = ?
      WHERE learning_id = ? AND code_file_id = ? AND link_type = ?
    `, [link.relevance_score, link.learning_id, link.code_file_id, link.link_type]);
    return 0;
  }
}

/**
 * Get learnings derived from a code file
 */
export function getLearningsForFile(codeFileId: string, options?: {
  linkType?: LearningCodeLinkRecord['link_type'];
  minRelevance?: number;
  limit?: number;
}): Array<LearningRecord & { link_type: string; relevance_score: number }> {
  const conditions: string[] = ['lcl.code_file_id = ?'];
  const params: any[] = [codeFileId];

  if (options?.linkType) {
    conditions.push('lcl.link_type = ?');
    params.push(options.linkType);
  }

  if (options?.minRelevance) {
    conditions.push('lcl.relevance_score >= ?');
    params.push(options.minRelevance);
  }

  const limit = options?.limit || 20;
  params.push(limit);

  return db.query(`
    SELECT l.*, lcl.link_type, lcl.relevance_score
    FROM learnings l
    JOIN learning_code_links lcl ON l.id = lcl.learning_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY lcl.relevance_score DESC
    LIMIT ?
  `).all(...params) as Array<LearningRecord & { link_type: string; relevance_score: number }>;
}

/**
 * Get code files linked to a learning
 */
export function getFilesForLearning(learningId: number, options?: {
  linkType?: LearningCodeLinkRecord['link_type'];
  limit?: number;
}): Array<CodeFileRecord & { link_type: string; relevance_score: number }> {
  const conditions: string[] = ['lcl.learning_id = ?'];
  const params: any[] = [learningId];

  if (options?.linkType) {
    conditions.push('lcl.link_type = ?');
    params.push(options.linkType);
  }

  const limit = options?.limit || 20;
  params.push(limit);

  return db.query(`
    SELECT cf.*, lcl.link_type, lcl.relevance_score
    FROM code_files cf
    JOIN learning_code_links lcl ON cf.id = lcl.code_file_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY lcl.relevance_score DESC
    LIMIT ?
  `).all(...params) as Array<CodeFileRecord & { link_type: string; relevance_score: number }>;
}

/**
 * Remove a learning-code link
 */
export function unlinkLearningFromCode(learningId: number, codeFileId: string, linkType?: string): number {
  if (linkType) {
    return db.run(
      'DELETE FROM learning_code_links WHERE learning_id = ? AND code_file_id = ? AND link_type = ?',
      [learningId, codeFileId, linkType]
    ).changes;
  }
  return db.run(
    'DELETE FROM learning_code_links WHERE learning_id = ? AND code_file_id = ?',
    [learningId, codeFileId]
  ).changes;
}

/**
 * Get learning-code link statistics
 */
export function getLearningCodeLinkStats(): {
  totalLinks: number;
  byType: Record<string, number>;
  linkedLearnings: number;
  linkedFiles: number;
} {
  const total = (db.query('SELECT COUNT(*) as c FROM learning_code_links').get() as { c: number }).c;
  const learnings = (db.query('SELECT COUNT(DISTINCT learning_id) as c FROM learning_code_links').get() as { c: number }).c;
  const files = (db.query('SELECT COUNT(DISTINCT code_file_id) as c FROM learning_code_links').get() as { c: number }).c;

  const typeRows = db.query(`
    SELECT link_type, COUNT(*) as count FROM learning_code_links
    GROUP BY link_type
  `).all() as { link_type: string; count: number }[];

  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    byType[row.link_type] = row.count;
  }

  return {
    totalLinks: total,
    byType,
    linkedLearnings: learnings,
    linkedFiles: files,
  };
}
