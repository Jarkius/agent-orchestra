/**
 * Behavioral Logging - Track user/agent interactions for analytics and AI coordination
 *
 * Implements the "Nothing is Deleted" philosophy by logging:
 * - Search queries (user intent)
 * - Oracle consultations (guidance audit trail)
 * - Architectural decisions (AI-to-AI coordination)
 * - Resource access (intellectual trail)
 * - Learning events (thought evolution)
 */

import { db } from './core';

// ============================================================================
// Schema Creation
// ============================================================================

export function initBehavioralLogsSchema(): void {
  // Search query logging (preserves user intent)
  db.run(`
    CREATE TABLE IF NOT EXISTS search_logs (
      id TEXT PRIMARY KEY,
      agent_id INTEGER,
      query TEXT NOT NULL,
      query_type TEXT CHECK(query_type IN ('code', 'knowledge', 'semantic', 'hybrid', 'fts')),
      result_count INTEGER DEFAULT 0,
      latency_ms INTEGER,
      source TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Oracle consultation logging (guidance audit trail)
  db.run(`
    CREATE TABLE IF NOT EXISTS consult_logs (
      id TEXT PRIMARY KEY,
      agent_id INTEGER,
      task_id TEXT,
      question TEXT NOT NULL,
      question_type TEXT CHECK(question_type IN ('approach', 'stuck', 'review', 'escalate')),
      guidance_given TEXT,
      learnings_cited TEXT,
      escalated INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Architectural decisions (AI-to-AI coordination)
  db.run(`
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT,
      context TEXT,
      alternatives TEXT,
      supersedes TEXT,
      related_task_id TEXT,
      agent_id INTEGER,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'deprecated')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Document/resource access logging (intellectual trail)
  db.run(`
    CREATE TABLE IF NOT EXISTS access_logs (
      id TEXT PRIMARY KEY,
      agent_id INTEGER,
      resource_type TEXT CHECK(resource_type IN ('session', 'learning', 'code_file', 'decision')),
      resource_id TEXT NOT NULL,
      action TEXT CHECK(action IN ('read', 'search', 'cited', 'validated')),
      context TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Learning formation events (thought evolution)
  db.run(`
    CREATE TABLE IF NOT EXISTS learn_logs (
      id TEXT PRIMARY KEY,
      learning_id INTEGER NOT NULL,
      event_type TEXT CHECK(event_type IN ('created', 'validated', 'maturity_advanced', 'linked', 'deprecated')),
      previous_value TEXT,
      new_value TEXT,
      source_event TEXT,
      agent_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (learning_id) REFERENCES learnings(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Indexes for query performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_search_logs_query ON search_logs(query)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_search_logs_created ON search_logs(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_consult_logs_agent ON consult_logs(agent_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_consult_logs_type ON consult_logs(question_type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_decisions_title ON decisions(title)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_access_logs_resource ON access_logs(resource_type, resource_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_learn_logs_learning ON learn_logs(learning_id)`);
}

// ============================================================================
// Types
// ============================================================================

export interface SearchLogEntry {
  query: string;
  query_type: 'code' | 'knowledge' | 'semantic' | 'hybrid' | 'fts';
  result_count: number;
  latency_ms?: number;
  source?: string;
  agent_id?: number;
}

export interface SearchLog extends SearchLogEntry {
  id: string;
  created_at: string;
}

export interface ConsultLogEntry {
  agent_id?: number;
  task_id?: string;
  question: string;
  question_type: 'approach' | 'stuck' | 'review' | 'escalate';
  guidance_given?: string;
  learnings_cited?: number[];
  escalated?: boolean;
}

export interface ConsultLog extends ConsultLogEntry {
  id: string;
  created_at: string;
}

export interface DecisionEntry {
  title: string;
  decision: string;
  rationale?: string;
  context?: string;
  alternatives?: string[];
  supersedes?: string;
  related_task_id?: string;
  agent_id?: number;
}

export interface Decision extends DecisionEntry {
  id: string;
  status: 'active' | 'superseded' | 'deprecated';
  created_at: string;
}

export interface AccessLogEntry {
  resource_type: 'session' | 'learning' | 'code_file' | 'decision';
  resource_id: string;
  action: 'read' | 'search' | 'cited' | 'validated';
  context?: string;
  agent_id?: number;
}

export interface AccessLog extends AccessLogEntry {
  id: string;
  created_at: string;
}

export interface LearnLogEntry {
  learning_id: number;
  event_type: 'created' | 'validated' | 'maturity_advanced' | 'linked' | 'deprecated';
  previous_value?: string;
  new_value?: string;
  source_event?: string;
  agent_id?: number;
}

export interface LearnLog extends LearnLogEntry {
  id: string;
  created_at: string;
}

export interface SearchAnalytics {
  totalQueries: number;
  avgLatency: number;
  topQueries: Array<{ query: string; count: number; avg_results: number }>;
  queryTypeBreakdown: Array<{ query_type: string; count: number }>;
}

export interface ConsultAnalytics {
  totalConsults: number;
  escalationRate: number;
  commonStuckPoints: Array<{ question: string; count: number }>;
  questionTypeBreakdown: Array<{ question_type: string; count: number }>;
}

// ============================================================================
// Search Logging
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function logSearch(entry: SearchLogEntry): void {
  const id = generateId('search');
  db.run(
    `INSERT INTO search_logs (id, agent_id, query, query_type, result_count, latency_ms, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.agent_id ?? null,
      entry.query,
      entry.query_type,
      entry.result_count,
      entry.latency_ms ?? null,
      entry.source ?? null,
    ]
  );
}

export function getRecentSearches(limit = 50): SearchLog[] {
  return db.query(
    `SELECT * FROM search_logs ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as SearchLog[];
}

export function getSearchAnalytics(): SearchAnalytics {
  const total = db.query(`SELECT COUNT(*) as count FROM search_logs`).get() as { count: number };
  const avgLatency = db.query(`SELECT AVG(latency_ms) as avg FROM search_logs WHERE latency_ms IS NOT NULL`).get() as { avg: number };

  const topQueries = db.query(`
    SELECT query, COUNT(*) as count, AVG(result_count) as avg_results
    FROM search_logs
    GROUP BY query
    ORDER BY count DESC
    LIMIT 10
  `).all() as Array<{ query: string; count: number; avg_results: number }>;

  const breakdown = db.query(`
    SELECT query_type, COUNT(*) as count
    FROM search_logs
    GROUP BY query_type
  `).all() as Array<{ query_type: string; count: number }>;

  return {
    totalQueries: total.count,
    avgLatency: avgLatency.avg || 0,
    topQueries,
    queryTypeBreakdown: breakdown,
  };
}

// ============================================================================
// Consultation Logging
// ============================================================================

export function logConsultation(entry: ConsultLogEntry): string {
  const id = generateId('consult');
  db.run(
    `INSERT INTO consult_logs (id, agent_id, task_id, question, question_type, guidance_given, learnings_cited, escalated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.agent_id ?? null,
      entry.task_id ?? null,
      entry.question,
      entry.question_type,
      entry.guidance_given ?? null,
      entry.learnings_cited ? JSON.stringify(entry.learnings_cited) : null,
      entry.escalated ? 1 : 0,
    ]
  );
  return id;
}

export function getConsultHistory(agentId?: number, limit = 50): ConsultLog[] {
  let query = `SELECT * FROM consult_logs`;
  const params: any[] = [];

  if (agentId !== undefined) {
    query += ` WHERE agent_id = ?`;
    params.push(agentId);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.query(query).all(...params) as any[];
  return rows.map(row => ({
    ...row,
    learnings_cited: row.learnings_cited ? JSON.parse(row.learnings_cited) : [],
    escalated: row.escalated === 1,
  }));
}

export function getConsultAnalytics(): ConsultAnalytics {
  const total = db.query(`SELECT COUNT(*) as count FROM consult_logs`).get() as { count: number };
  const escalation = db.query(`SELECT AVG(escalated) as rate FROM consult_logs`).get() as { rate: number };

  const stuckPoints = db.query(`
    SELECT question, COUNT(*) as count
    FROM consult_logs
    WHERE question_type = 'stuck'
    GROUP BY question
    ORDER BY count DESC
    LIMIT 10
  `).all() as Array<{ question: string; count: number }>;

  const breakdown = db.query(`
    SELECT question_type, COUNT(*) as count
    FROM consult_logs
    GROUP BY question_type
  `).all() as Array<{ question_type: string; count: number }>;

  return {
    totalConsults: total.count,
    escalationRate: escalation.rate || 0,
    commonStuckPoints: stuckPoints,
    questionTypeBreakdown: breakdown,
  };
}

// ============================================================================
// Decisions
// ============================================================================

export function recordDecision(entry: DecisionEntry): string {
  const id = generateId('decision');

  // If superseding another decision, mark it as superseded
  if (entry.supersedes) {
    db.run(
      `UPDATE decisions SET status = 'superseded' WHERE id = ?`,
      [entry.supersedes]
    );
  }

  db.run(
    `INSERT INTO decisions (id, title, decision, rationale, context, alternatives, supersedes, related_task_id, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.title,
      entry.decision,
      entry.rationale ?? null,
      entry.context ?? null,
      entry.alternatives ? JSON.stringify(entry.alternatives) : null,
      entry.supersedes ?? null,
      entry.related_task_id ?? null,
      entry.agent_id ?? null,
    ]
  );
  return id;
}

export function getActiveDecisions(searchContext?: string, limit = 20): Decision[] {
  let query = `SELECT * FROM decisions WHERE status = 'active'`;
  const params: any[] = [];

  if (searchContext) {
    query += ` AND (title LIKE ? OR decision LIKE ? OR context LIKE ?)`;
    const pattern = `%${searchContext}%`;
    params.push(pattern, pattern, pattern);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.query(query).all(...params) as any[];
  return rows.map(row => ({
    ...row,
    alternatives: row.alternatives ? JSON.parse(row.alternatives) : [],
  }));
}

export function getDecisionById(id: string): Decision | null {
  const row = db.query(`SELECT * FROM decisions WHERE id = ?`).get(id) as any;
  if (!row) return null;
  return {
    ...row,
    alternatives: row.alternatives ? JSON.parse(row.alternatives) : [],
  };
}

export function checkExistingDecision(query: string): Decision | null {
  // Search for relevant active decisions
  const pattern = `%${query}%`;
  const row = db.query(
    `SELECT * FROM decisions
     WHERE status = 'active'
     AND (title LIKE ? OR decision LIKE ? OR context LIKE ?)
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(pattern, pattern, pattern) as any;

  if (!row) return null;
  return {
    ...row,
    alternatives: row.alternatives ? JSON.parse(row.alternatives) : [],
  };
}

export function supersededDecision(oldId: string, newId: string): void {
  db.run(`UPDATE decisions SET status = 'superseded' WHERE id = ?`, [oldId]);
}

export function deprecateDecision(id: string): void {
  db.run(`UPDATE decisions SET status = 'deprecated' WHERE id = ?`, [id]);
}

export function listAllDecisions(includeInactive = false): Decision[] {
  let query = `SELECT * FROM decisions`;
  if (!includeInactive) {
    query += ` WHERE status = 'active'`;
  }
  query += ` ORDER BY created_at DESC`;

  const rows = db.query(query).all() as any[];
  return rows.map(row => ({
    ...row,
    alternatives: row.alternatives ? JSON.parse(row.alternatives) : [],
  }));
}

// ============================================================================
// Access Logging
// ============================================================================

export function logAccess(entry: AccessLogEntry): void {
  const id = generateId('access');
  db.run(
    `INSERT INTO access_logs (id, agent_id, resource_type, resource_id, action, context)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.agent_id ?? null,
      entry.resource_type,
      entry.resource_id,
      entry.action,
      entry.context ?? null,
    ]
  );
}

export function getAccessHistory(resourceType: string, resourceId: string): AccessLog[] {
  return db.query(
    `SELECT * FROM access_logs
     WHERE resource_type = ? AND resource_id = ?
     ORDER BY created_at DESC`
  ).all(resourceType, resourceId) as AccessLog[];
}

export function getMostAccessedResources(resourceType?: string, limit = 10): Array<{ resource_id: string; resource_type: string; access_count: number }> {
  let query = `
    SELECT resource_id, resource_type, COUNT(*) as access_count
    FROM access_logs
  `;
  const params: any[] = [];

  if (resourceType) {
    query += ` WHERE resource_type = ?`;
    params.push(resourceType);
  }

  query += ` GROUP BY resource_type, resource_id ORDER BY access_count DESC LIMIT ?`;
  params.push(limit);

  return db.query(query).all(...params) as Array<{ resource_id: string; resource_type: string; access_count: number }>;
}

// ============================================================================
// Learning Event Logging
// ============================================================================

export function logLearningEvent(entry: LearnLogEntry): void {
  const id = generateId('learn');
  db.run(
    `INSERT INTO learn_logs (id, learning_id, event_type, previous_value, new_value, source_event, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.learning_id,
      entry.event_type,
      entry.previous_value ?? null,
      entry.new_value ?? null,
      entry.source_event ?? null,
      entry.agent_id ?? null,
    ]
  );
}

export function getLearningHistory(learningId: number): LearnLog[] {
  return db.query(
    `SELECT * FROM learn_logs
     WHERE learning_id = ?
     ORDER BY created_at ASC`
  ).all(learningId) as LearnLog[];
}

export function getRecentLearningEvents(limit = 50): LearnLog[] {
  return db.query(
    `SELECT * FROM learn_logs ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as LearnLog[];
}

export function getLearningEventsByType(eventType: string, limit = 50): LearnLog[] {
  return db.query(
    `SELECT * FROM learn_logs WHERE event_type = ? ORDER BY created_at DESC LIMIT ?`
  ).all(eventType, limit) as LearnLog[];
}
