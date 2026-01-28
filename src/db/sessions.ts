/**
 * Session Memory - Session recording and retrieval
 *
 * This module handles session persistence for work tracking,
 * including continuation bundles for resuming work.
 */

import { db } from './core';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Functions
// ============================================================================

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
