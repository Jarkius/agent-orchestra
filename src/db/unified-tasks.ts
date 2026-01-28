/**
 * Unified Tasks - System & Project Task Management with GitHub Sync
 *
 * This module handles task management across domains (system, project, session)
 * with optional GitHub issue synchronization.
 */

import { db } from './core';

// ============================================================================
// Types
// ============================================================================

export type UnifiedTaskStatus = 'open' | 'in_progress' | 'done' | 'blocked' | 'wont_fix';
export type UnifiedTaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type UnifiedTaskDomain = 'system' | 'project';
export type GitHubSyncStatus = 'pending' | 'synced' | 'error' | 'local_only';

export interface UnifiedTask {
  id: number;
  title: string;
  description: string | null;
  status: UnifiedTaskStatus;
  priority: UnifiedTaskPriority;
  domain: UnifiedTaskDomain;
  github_issue_number: number | null;
  github_issue_url: string | null;
  github_synced_at: string | null;
  github_sync_status: GitHubSyncStatus;
  github_repo: string | null;  // e.g., "User/Repo" for multi-repo support
  component: string | null;
  repro_steps: string | null;
  known_fix: string | null;
  context: Record<string, any> | null;
  session_id: string | null;
  learning_id: number | null;
  project_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface UnifiedTaskCreate {
  title: string;
  description?: string;
  status?: UnifiedTaskStatus;
  priority?: UnifiedTaskPriority;
  domain: UnifiedTaskDomain;
  component?: string;
  repro_steps?: string;
  known_fix?: string;
  context?: Record<string, any>;
  session_id?: string;
  learning_id?: number;
  project_path?: string;
  // GitHub sync options
  github_issue_number?: number;
  github_issue_url?: string;
  github_repo?: string;  // Target repo for multi-repo support
  syncToProjectGitHub?: boolean;  // Flag to sync project task to its repo
}

export interface UnifiedTaskUpdate {
  title?: string;
  description?: string;
  status?: UnifiedTaskStatus;
  priority?: UnifiedTaskPriority;
  component?: string;
  repro_steps?: string;
  known_fix?: string;
  context?: Record<string, any>;
  github_issue_number?: number;
  github_issue_url?: string;
  github_sync_status?: GitHubSyncStatus;
  github_repo?: string;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Create a unified task
 * For domain='system', this should trigger GitHub issue creation (handled by caller)
 * For domain='project' with syncToProjectGitHub, sync to the project's GitHub repo
 */
export function createUnifiedTask(data: UnifiedTaskCreate): UnifiedTask {
  const contextJson = data.context ? JSON.stringify(data.context) : null;

  // Determine initial sync status and repo
  let syncStatus: GitHubSyncStatus = 'pending';
  let githubRepo: string | null = data.github_repo || null;

  if (data.domain === 'project') {
    if (data.syncToProjectGitHub && data.github_repo) {
      // Project task with GitHub sync to project's repo
      syncStatus = 'pending';
      githubRepo = data.github_repo;
    } else {
      // Local only
      syncStatus = 'local_only';
    }
  } else if (data.github_issue_number) {
    syncStatus = 'synced'; // Already linked to GitHub
  }

  const result = db.run(
    `INSERT INTO unified_tasks (
      title, description, status, priority, domain,
      github_issue_number, github_issue_url, github_sync_status, github_repo,
      component, repro_steps, known_fix, context,
      session_id, learning_id, project_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.title,
      data.description || null,
      data.status || 'open',
      data.priority || 'normal',
      data.domain,
      data.github_issue_number || null,
      data.github_issue_url || null,
      syncStatus,
      githubRepo,
      data.component || null,
      data.repro_steps || null,
      data.known_fix || null,
      contextJson,
      data.session_id || null,
      data.learning_id || null,
      data.project_path || null,
    ]
  );

  const id = Number(result.lastInsertRowid);
  return getUnifiedTaskById(id)!;
}

/**
 * Update a unified task
 */
export function updateUnifiedTask(id: number, data: UnifiedTaskUpdate): UnifiedTask | null {
  const updates: string[] = [];
  const values: any[] = [];

  if (data.title !== undefined) {
    updates.push('title = ?');
    values.push(data.title);
  }
  if (data.description !== undefined) {
    updates.push('description = ?');
    values.push(data.description);
  }
  if (data.status !== undefined) {
    updates.push('status = ?');
    values.push(data.status);
  }
  if (data.priority !== undefined) {
    updates.push('priority = ?');
    values.push(data.priority);
  }
  if (data.component !== undefined) {
    updates.push('component = ?');
    values.push(data.component);
  }
  if (data.repro_steps !== undefined) {
    updates.push('repro_steps = ?');
    values.push(data.repro_steps);
  }
  if (data.known_fix !== undefined) {
    updates.push('known_fix = ?');
    values.push(data.known_fix);
  }
  if (data.context !== undefined) {
    updates.push('context = ?');
    values.push(JSON.stringify(data.context));
  }
  if (data.github_issue_number !== undefined) {
    updates.push('github_issue_number = ?');
    values.push(data.github_issue_number);
  }
  if (data.github_issue_url !== undefined) {
    updates.push('github_issue_url = ?');
    values.push(data.github_issue_url);
  }
  if (data.github_sync_status !== undefined) {
    updates.push('github_sync_status = ?');
    values.push(data.github_sync_status);
  }
  if (data.github_repo !== undefined) {
    updates.push('github_repo = ?');
    values.push(data.github_repo);
  }

  if (updates.length === 0) return getUnifiedTaskById(id);

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  db.run(
    `UPDATE unified_tasks SET ${updates.join(', ')} WHERE id = ?`,
    values
  );

  return getUnifiedTaskById(id);
}

/**
 * Simple helper to update just the status of a unified task
 */
export function updateUnifiedTaskStatus(id: number, status: 'open' | 'in_progress' | 'blocked' | 'done'): void {
  db.run(
    `UPDATE unified_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, id]
  );
}

/**
 * Get a unified task by ID
 */
export function getUnifiedTaskById(id: number): UnifiedTask | null {
  const row = db.query(`SELECT * FROM unified_tasks WHERE id = ?`).get(id) as any;
  if (!row) return null;

  return {
    ...row,
    context: row.context ? JSON.parse(row.context) : null,
  };
}

/**
 * Get unified tasks with filters
 */
export function getUnifiedTasks(options: {
  domain?: UnifiedTaskDomain;
  status?: UnifiedTaskStatus | UnifiedTaskStatus[];
  component?: string;
  projectPath?: string;
  limit?: number;
  includeCompleted?: boolean;
} = {}): UnifiedTask[] {
  const conditions: string[] = [];
  const values: any[] = [];

  if (options.domain) {
    conditions.push('domain = ?');
    values.push(options.domain);
  }

  if (options.status) {
    if (Array.isArray(options.status)) {
      conditions.push(`status IN (${options.status.map(() => '?').join(', ')})`);
      values.push(...options.status);
    } else {
      conditions.push('status = ?');
      values.push(options.status);
    }
  } else if (!options.includeCompleted) {
    // By default, exclude completed tasks
    conditions.push('status NOT IN (?, ?)');
    values.push('done', 'wont_fix');
  }

  if (options.component) {
    conditions.push('component = ?');
    values.push(options.component);
  }

  if (options.projectPath) {
    conditions.push('project_path = ?');
    values.push(options.projectPath);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit || 50;
  values.push(limit);

  const rows = db.query(`
    SELECT * FROM unified_tasks
    ${whereClause}
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        WHEN 'low' THEN 4
      END,
      created_at DESC
    LIMIT ?
  `).all(...values) as any[];

  return rows.map(row => ({
    ...row,
    context: row.context ? JSON.parse(row.context) : null,
  }));
}

/**
 * Get task by GitHub issue number
 */
export function getTaskByGitHubIssue(issueNumber: number): UnifiedTask | null {
  const row = db.query(
    `SELECT * FROM unified_tasks WHERE github_issue_number = ?`
  ).get(issueNumber) as any;

  if (!row) return null;
  return {
    ...row,
    context: row.context ? JSON.parse(row.context) : null,
  };
}

/**
 * Mark a task's GitHub sync status
 */
export function markTaskSynced(id: number, issueNumber: number, issueUrl: string): void {
  db.run(
    `UPDATE unified_tasks
     SET github_issue_number = ?,
         github_issue_url = ?,
         github_sync_status = 'synced',
         github_synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [issueNumber, issueUrl, id]
  );
}

/**
 * Mark task sync error
 */
export function markTaskSyncError(id: number, error?: string): void {
  const context = error ? JSON.stringify({ sync_error: error }) : null;
  db.run(
    `UPDATE unified_tasks
     SET github_sync_status = 'error',
         context = COALESCE(json_patch(context, ?), ?),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [context, context, id]
  );
}

/**
 * Promote a project task to system (triggers GitHub sync)
 */
export function promoteTaskToSystem(id: number): UnifiedTask | null {
  const task = getUnifiedTaskById(id);
  if (!task || task.domain !== 'project') return null;

  db.run(
    `UPDATE unified_tasks
     SET domain = 'system',
         github_sync_status = 'pending',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [id]
  );

  return getUnifiedTaskById(id);
}

/**
 * Get tasks pending GitHub sync
 */
export function getTasksPendingSync(): UnifiedTask[] {
  const rows = db.query(`
    SELECT * FROM unified_tasks
    WHERE domain = 'system'
      AND github_sync_status = 'pending'
    ORDER BY created_at ASC
  `).all() as any[];

  return rows.map(row => ({
    ...row,
    context: row.context ? JSON.parse(row.context) : null,
  }));
}

/**
 * Get task counts by domain and status
 */
export function getUnifiedTaskStats(): {
  system: { open: number; in_progress: number; done: number; blocked: number };
  project: { open: number; in_progress: number; done: number; blocked: number };
  pending_sync: number;
} {
  const stats = db.query(`
    SELECT
      domain,
      status,
      COUNT(*) as count
    FROM unified_tasks
    GROUP BY domain, status
  `).all() as { domain: string; status: string; count: number }[];

  const result = {
    system: { open: 0, in_progress: 0, done: 0, blocked: 0 },
    project: { open: 0, in_progress: 0, done: 0, blocked: 0 },
    pending_sync: 0,
  };

  for (const row of stats) {
    const domain = row.domain as 'system' | 'project';
    const status = row.status as keyof typeof result.system;
    if (result[domain] && status in result[domain]) {
      result[domain][status] = row.count;
    }
  }

  // Count pending sync separately
  const pendingRow = db.query(`
    SELECT COUNT(*) as count FROM unified_tasks
    WHERE domain = 'system' AND github_sync_status = 'pending'
  `).get() as { count: number };
  result.pending_sync = pendingRow.count;

  return result;
}
