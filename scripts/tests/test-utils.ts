/**
 * Test Utilities - Shared helpers for bun:test
 *
 * Provides:
 * - Temp database creation/cleanup
 * - Common assertions
 * - Test fixtures
 * - Timeout wrappers
 */

import { Database } from "bun:sqlite";
import { existsSync, unlinkSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ============================================================================
// Temp Database Management
// ============================================================================

const MAIN_DB_PATH = "./agents.db";
let tempDbPath: string | null = null;
let tempDb: Database | null = null;

/**
 * Create an isolated temp database for testing
 * Copies schema from main DB but with no data
 */
export function createTempDb(): Database {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  tempDbPath = join(tmpdir(), `test-agents-${timestamp}-${random}.db`);

  // Create fresh database
  tempDb = new Database(tempDbPath);

  // Initialize schema (copied from src/db.ts essentials)
  tempDb.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      summary TEXT,
      tags TEXT,
      git_branch TEXT,
      git_commits TEXT,
      git_files TEXT,
      context TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      agent_id INTEGER,
      visibility TEXT DEFAULT 'private'
    )
  `);

  tempDb.run(`
    CREATE TABLE IF NOT EXISTS learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      context TEXT,
      confidence TEXT DEFAULT 'low',
      validation_count INTEGER DEFAULT 0,
      source_session_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      agent_id INTEGER,
      visibility TEXT DEFAULT 'private'
    )
  `);

  tempDb.run(`
    CREATE TABLE IF NOT EXISTS unified_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'done', 'blocked', 'wont_fix')),
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('critical', 'high', 'normal', 'low')),
      domain TEXT NOT NULL CHECK(domain IN ('system', 'project', 'session')),
      github_issue_number INTEGER,
      github_issue_url TEXT,
      github_synced_at TEXT,
      github_sync_status TEXT DEFAULT 'pending',
      github_repo TEXT,
      component TEXT,
      session_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Matrix registry table
  tempDb.run(`
    CREATE TABLE IF NOT EXISTS matrix_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matrix_id TEXT NOT NULL UNIQUE,
      display_name TEXT,
      last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'offline' CHECK(status IN ('online', 'offline', 'away')),
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Matrix messages table with full constraints
  tempDb.run(`
    CREATE TABLE IF NOT EXISTS matrix_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE,
      from_matrix TEXT NOT NULL,
      to_matrix TEXT,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'broadcast' CHECK(message_type IN ('broadcast', 'direct')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'delivered', 'failed')),
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      error TEXT,
      sequence_number INTEGER DEFAULT 0,
      next_retry_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      sent_at TEXT,
      delivered_at TEXT,
      read_at TEXT
    )
  `);

  // Sequence counters for message ordering
  tempDb.run(`
    CREATE TABLE IF NOT EXISTS matrix_sequence_counters (
      matrix_id TEXT PRIMARY KEY,
      next_sequence INTEGER DEFAULT 1
    )
  `);

  // Agents table with full schema
  tempDb.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY,
      name TEXT,
      pane_id TEXT,
      pid INTEGER,
      status TEXT DEFAULT 'pending',
      role TEXT DEFAULT 'generalist',
      model TEXT DEFAULT 'sonnet',
      current_task_id TEXT,
      tasks_completed INTEGER DEFAULT 0,
      tasks_failed INTEGER DEFAULT 0,
      total_duration_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Mission queue table
  tempDb.run(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      context TEXT,
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('critical', 'high', 'normal', 'low')),
      type TEXT DEFAULT 'general' CHECK(type IN ('extraction', 'analysis', 'synthesis', 'review', 'general')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'queued', 'running', 'completed', 'failed', 'retrying', 'blocked')),
      assigned_to INTEGER,
      depends_on TEXT,
      timeout_ms INTEGER DEFAULT 120000,
      max_retries INTEGER DEFAULT 3,
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      result TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      unified_task_id INTEGER
    )
  `);

  // Agent tasks table (task history) - matches production schema
  tempDb.run(`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      agent_id INTEGER,
      prompt TEXT,
      context TEXT,
      priority TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'queued', 'processing', 'running', 'completed', 'failed', 'retrying', 'blocked', 'cancelled')),
      result TEXT,
      error TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      duration_ms INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      type TEXT,
      timeout_ms INTEGER DEFAULT 120000,
      max_retries INTEGER DEFAULT 3,
      retry_count INTEGER DEFAULT 0,
      depends_on TEXT,
      assigned_to INTEGER,
      session_id TEXT,
      unified_task_id INTEGER,
      parent_mission_id TEXT,
      execution_id TEXT
    )
  `);

  // Add indexes for task linking
  tempDb.run(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_unified ON agent_tasks(unified_task_id)`);
  tempDb.run(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_mission ON agent_tasks(parent_mission_id)`);
  tempDb.run(`CREATE INDEX IF NOT EXISTS idx_missions_unified ON missions(unified_task_id)`);

  // Add task linking columns to learnings (if not present via default schema)
  try {
    tempDb.run(`ALTER TABLE learnings ADD COLUMN source_task_id TEXT`);
  } catch { /* Column may already exist */ }
  try {
    tempDb.run(`ALTER TABLE learnings ADD COLUMN source_mission_id TEXT`);
  } catch { /* Column may already exist */ }
  try {
    tempDb.run(`ALTER TABLE learnings ADD COLUMN source_unified_task_id INTEGER`);
  } catch { /* Column may already exist */ }

  tempDb.run(`CREATE INDEX IF NOT EXISTS idx_learnings_task ON learnings(source_task_id)`);
  tempDb.run(`CREATE INDEX IF NOT EXISTS idx_learnings_mission ON learnings(source_mission_id)`);
  tempDb.run(`CREATE INDEX IF NOT EXISTS idx_learnings_unified ON learnings(source_unified_task_id)`);

  return tempDb;
}

/**
 * Get the current temp database
 */
export function getTempDb(): Database {
  if (!tempDb) {
    throw new Error("Temp database not created. Call createTempDb() first.");
  }
  return tempDb;
}

/**
 * Get temp database path
 */
export function getTempDbPath(): string {
  if (!tempDbPath) {
    throw new Error("Temp database not created. Call createTempDb() first.");
  }
  return tempDbPath;
}

/**
 * Cleanup temp database
 */
export function cleanupTempDb(): void {
  if (tempDb) {
    try {
      tempDb.close();
    } catch {
      // Already closed
    }
    tempDb = null;
  }

  if (tempDbPath && existsSync(tempDbPath)) {
    try {
      unlinkSync(tempDbPath);
    } catch {
      // File already removed
    }
    tempDbPath = null;
  }
}

// ============================================================================
// Test Fixtures
// ============================================================================

export interface TestSession {
  id: string;
  summary: string;
  tags?: string;
}

export interface TestLearning {
  id?: number;
  category: string;
  title: string;
  description?: string;
  confidence?: string;
}

export interface TestTask {
  id?: number;
  title: string;
  domain: "system" | "project" | "session";
  status?: string;
  priority?: string;
}

/**
 * Create a test session
 */
export function createTestSession(db: Database, data: Partial<TestSession> = {}): TestSession {
  const session: TestSession = {
    id: data.id ?? `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    summary: data.summary ?? "Test session",
    tags: data.tags ?? "test",
  };

  db.run(
    `INSERT INTO sessions (id, summary, tags) VALUES (?, ?, ?)`,
    [session.id, session.summary, session.tags]
  );

  return session;
}

/**
 * Create a test learning
 */
export function createTestLearning(db: Database, data: Partial<TestLearning> = {}): TestLearning {
  const learning: TestLearning = {
    category: data.category || "testing",
    title: data.title || "Test learning",
    description: data.description || "Test description",
    confidence: data.confidence || "low",
  };

  const result = db.run(
    `INSERT INTO learnings (category, title, description, confidence) VALUES (?, ?, ?, ?)`,
    [learning.category, learning.title, learning.description, learning.confidence]
  );

  learning.id = Number(result.lastInsertRowid);
  return learning;
}

/**
 * Create a test task
 */
export function createTestTask(db: Database, data: Partial<TestTask> = {}): TestTask {
  const task: TestTask = {
    title: data.title || "Test task",
    domain: data.domain || "session",
    status: data.status || "open",
    priority: data.priority || "normal",
  };

  const result = db.run(
    `INSERT INTO unified_tasks (title, domain, status, priority) VALUES (?, ?, ?, ?)`,
    [task.title, task.domain, task.status, task.priority]
  );

  task.id = Number(result.lastInsertRowid);
  return task;
}

// ============================================================================
// Matrix Test Fixtures
// ============================================================================

export interface TestMessage {
  id?: number;
  message_id?: string;
  from_matrix: string;
  to_matrix?: string;
  content: string;
  message_type?: "broadcast" | "direct";
  status?: "pending" | "sending" | "sent" | "delivered" | "failed";
  retry_count?: number;
  sequence_number?: number;
}

export interface TestMatrix {
  id?: number;
  matrix_id: string;
  display_name?: string;
  status?: "online" | "offline" | "away";
}

/**
 * Create a test matrix message
 */
export function createTestMessage(db: Database, data: Partial<TestMessage> = {}): TestMessage {
  const message: TestMessage = {
    message_id: data.message_id ?? `msg_${Date.now()}_${randomString(4)}`,
    from_matrix: data.from_matrix ?? "test-matrix",
    to_matrix: data.to_matrix,
    content: data.content ?? "Test message",
    message_type: data.message_type ?? (data.to_matrix ? "direct" : "broadcast"),
    status: data.status ?? "pending",
    retry_count: data.retry_count ?? 0,
    sequence_number: data.sequence_number ?? 0,
  };

  const result = db.run(
    `INSERT INTO matrix_messages
      (message_id, from_matrix, to_matrix, content, message_type, status, retry_count, sequence_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.message_id,
      message.from_matrix,
      message.to_matrix ?? null,
      message.content,
      message.message_type,
      message.status,
      message.retry_count,
      message.sequence_number,
    ]
  );

  message.id = Number(result.lastInsertRowid);
  return message;
}

/**
 * Create a test matrix in registry
 */
export function createTestMatrix(db: Database, data: Partial<TestMatrix> = {}): TestMatrix {
  const matrix: TestMatrix = {
    matrix_id: data.matrix_id ?? `matrix_${randomString(6)}`,
    display_name: data.display_name,
    status: data.status ?? "offline",
  };

  const result = db.run(
    `INSERT INTO matrix_registry (matrix_id, display_name, status) VALUES (?, ?, ?)`,
    [matrix.matrix_id, matrix.display_name ?? null, matrix.status]
  );

  matrix.id = Number(result.lastInsertRowid);
  return matrix;
}

/**
 * Get next sequence number for a matrix (atomic)
 */
export function getNextSequence(db: Database, matrixId: string): number {
  db.run(
    `INSERT INTO matrix_sequence_counters (matrix_id, next_sequence)
     VALUES (?, 1)
     ON CONFLICT(matrix_id) DO UPDATE SET next_sequence = next_sequence + 1`,
    [matrixId]
  );
  const row = db.query(`SELECT next_sequence FROM matrix_sequence_counters WHERE matrix_id = ?`).get(matrixId) as { next_sequence: number };
  return row.next_sequence;
}

// ============================================================================
// Agent Test Fixtures
// ============================================================================

export type AgentRole = "coder" | "tester" | "analyst" | "reviewer" | "architect" | "debugger" | "researcher" | "scribe" | "oracle" | "generalist";
export type AgentModel = "haiku" | "sonnet" | "opus";
export type AgentStatus = "pending" | "idle" | "busy" | "working" | "error" | "stopped";

export interface TestAgent {
  id: number;
  name?: string;
  status?: AgentStatus;
  role?: AgentRole;
  model?: AgentModel;
  tasks_completed?: number;
  tasks_failed?: number;
}

export interface TestMission {
  id?: string;
  prompt: string;
  priority?: "critical" | "high" | "normal" | "low";
  type?: "extraction" | "analysis" | "synthesis" | "review" | "general";
  status?: "pending" | "queued" | "running" | "completed" | "failed" | "retrying" | "blocked";
  assigned_to?: number;
  depends_on?: string[];
  retry_count?: number;
  unified_task_id?: number;
}

export interface TestAgentTask {
  id?: string;
  agent_id: number;
  prompt: string;
  context?: string;
  priority?: string;
  status?: "pending" | "running" | "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  session_id?: string;
  unified_task_id?: number;
  parent_mission_id?: string;
}

/**
 * Create a test agent
 */
export function createTestAgent(db: Database, data: Partial<TestAgent> = {}): TestAgent {
  const agent: TestAgent = {
    id: data.id ?? Math.floor(Math.random() * 10000),
    name: data.name ?? `agent-${randomString(4)}`,
    status: data.status ?? "pending",
    role: data.role ?? "generalist",
    model: data.model ?? "sonnet",
    tasks_completed: data.tasks_completed ?? 0,
    tasks_failed: data.tasks_failed ?? 0,
  };

  db.run(
    `INSERT INTO agents (id, name, status, role, model, tasks_completed, tasks_failed) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [agent.id, agent.name, agent.status, agent.role, agent.model, agent.tasks_completed, agent.tasks_failed]
  );

  return agent;
}

/**
 * Create a test mission
 */
export function createTestMission(db: Database, data: Partial<TestMission> = {}): TestMission {
  const mission: TestMission = {
    id: data.id ?? `mission_${randomString(8)}`,
    prompt: data.prompt ?? "Test mission prompt",
    priority: data.priority ?? "normal",
    type: data.type ?? "general",
    status: data.status ?? "pending",
    assigned_to: data.assigned_to,
    depends_on: data.depends_on,
    retry_count: data.retry_count ?? 0,
    unified_task_id: data.unified_task_id,
  };

  db.run(
    `INSERT INTO missions (id, prompt, priority, type, status, assigned_to, depends_on, retry_count, unified_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mission.id,
      mission.prompt,
      mission.priority,
      mission.type,
      mission.status,
      mission.assigned_to ?? null,
      mission.depends_on ? JSON.stringify(mission.depends_on) : null,
      mission.retry_count,
      mission.unified_task_id ?? null,
    ]
  );

  return mission;
}

/**
 * Create a test agent task
 */
export function createTestAgentTask(db: Database, data: Partial<TestAgentTask> = {}): TestAgentTask {
  const task: TestAgentTask = {
    id: data.id ?? `task_${Date.now()}_${randomString(6)}`,
    agent_id: data.agent_id ?? 1,
    prompt: data.prompt ?? "Test task prompt",
    context: data.context,
    priority: data.priority ?? "normal",
    status: data.status ?? "pending",
    result: data.result,
    error: data.error,
    duration_ms: data.duration_ms,
    input_tokens: data.input_tokens,
    output_tokens: data.output_tokens,
    session_id: data.session_id,
    unified_task_id: data.unified_task_id,
    parent_mission_id: data.parent_mission_id,
  };

  db.run(
    `INSERT INTO agent_tasks (id, agent_id, prompt, context, priority, status, result, error, duration_ms, input_tokens, output_tokens, session_id, unified_task_id, parent_mission_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.agent_id,
      task.prompt,
      task.context ?? null,
      task.priority,
      task.status,
      task.result ?? null,
      task.error ?? null,
      task.duration_ms ?? null,
      task.input_tokens ?? null,
      task.output_tokens ?? null,
      task.session_id ?? null,
      task.unified_task_id ?? null,
      task.parent_mission_id ?? null,
    ]
  );

  return task;
}

/**
 * Update agent task status (simulates completion)
 */
export function completeTestAgentTask(
  db: Database,
  taskId: string,
  result: string,
  durationMs = 1000
): void {
  db.run(
    `UPDATE agent_tasks SET status = 'completed', result = ?, duration_ms = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [result, durationMs, taskId]
  );
}

/**
 * Create a test learning with task linking
 */
export function createTestLinkedLearning(
  db: Database,
  data: Partial<TestLearning> & {
    source_task_id?: string;
    source_mission_id?: string;
    source_unified_task_id?: number;
  } = {}
): TestLearning & { source_task_id?: string; source_mission_id?: string; source_unified_task_id?: number } {
  const learning = {
    category: data.category || "testing",
    title: data.title || "Test learning",
    description: data.description || "Test description",
    confidence: data.confidence || "low",
    source_task_id: data.source_task_id,
    source_mission_id: data.source_mission_id,
    source_unified_task_id: data.source_unified_task_id,
  };

  const result = db.run(
    `INSERT INTO learnings (category, title, description, confidence, source_task_id, source_mission_id, source_unified_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      learning.category,
      learning.title,
      learning.description,
      learning.confidence,
      learning.source_task_id ?? null,
      learning.source_mission_id ?? null,
      learning.source_unified_task_id ?? null,
    ]
  );

  return { ...learning, id: Number(result.lastInsertRowid) };
}

/**
 * Increment agent task stats
 */
export function incrementAgentStats(db: Database, agentId: number, success: boolean, durationMs = 0): void {
  if (success) {
    db.run(
      `UPDATE agents SET tasks_completed = tasks_completed + 1, total_duration_ms = total_duration_ms + ? WHERE id = ?`,
      [durationMs, agentId]
    );
  } else {
    db.run(
      `UPDATE agents SET tasks_failed = tasks_failed + 1 WHERE id = ?`,
      [agentId]
    );
  }
}

// ============================================================================
// Assertions
// ============================================================================

/**
 * Assert a record exists in a table
 */
export function assertExists(db: Database, table: string, id: number | string, idColumn = "id"): void {
  const row = db.query(`SELECT * FROM ${table} WHERE ${idColumn} = ?`).get(id);
  if (!row) {
    throw new Error(`Expected ${table} with ${idColumn}=${id} to exist, but it doesn't`);
  }
}

/**
 * Assert a record does NOT exist
 */
export function assertNotExists(db: Database, table: string, id: number | string, idColumn = "id"): void {
  const row = db.query(`SELECT * FROM ${table} WHERE ${idColumn} = ?`).get(id);
  if (row) {
    throw new Error(`Expected ${table} with ${idColumn}=${id} to NOT exist, but it does`);
  }
}

/**
 * Assert row count in a table
 */
export function assertRowCount(db: Database, table: string, expected: number, where = ""): void {
  const whereClause = where ? `WHERE ${where}` : "";
  const result = db.query(`SELECT COUNT(*) as count FROM ${table} ${whereClause}`).get() as { count: number };
  if (result.count !== expected) {
    throw new Error(`Expected ${expected} rows in ${table} ${whereClause}, got ${result.count}`);
  }
}

/**
 * Assert field value
 */
export function assertFieldEquals(
  db: Database,
  table: string,
  id: number | string,
  field: string,
  expected: any,
  idColumn = "id"
): void {
  const row = db.query(`SELECT ${field} FROM ${table} WHERE ${idColumn} = ?`).get(id) as Record<string, any>;
  if (!row) {
    throw new Error(`Record ${table}.${idColumn}=${id} not found`);
  }
  if (row[field] !== expected) {
    throw new Error(`Expected ${table}.${field}=${expected}, got ${row[field]}`);
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Run a function with timeout
 */
export async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Sleep for ms milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate random string
 */
export function randomString(length = 8): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

/**
 * Run multiple async operations in parallel
 */
export async function parallel<T>(fns: (() => Promise<T>)[]): Promise<T[]> {
  return Promise.all(fns.map((fn) => fn()));
}
