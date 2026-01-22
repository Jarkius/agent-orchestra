import { Database } from "bun:sqlite";

const DB_PATH = "./agents.db";

// Optional vector DB import - may not be initialized
let vectorDbModule: any = null;
async function getVectorDb() {
  if (!vectorDbModule) {
    try {
      vectorDbModule = await import('./vector-db');
    } catch {
      vectorDbModule = { isInitialized: () => false };
    }
  }
  return vectorDbModule;
}

export const db = new Database(DB_PATH);

// Configure for concurrent access from multiple processes
db.run("PRAGMA journal_mode=WAL");      // Allow concurrent reads during writes
db.run("PRAGMA busy_timeout=5000");     // Wait up to 5 seconds if database is locked
db.run("PRAGMA synchronous=NORMAL");    // Balance between safety and performance

// Initialize schema with comprehensive tracking
db.run(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY,
    name TEXT,
    pane_id TEXT,
    pid INTEGER,
    status TEXT DEFAULT 'pending',
    current_task_id TEXT,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER,
    direction TEXT CHECK(direction IN ('inbound', 'outbound')),
    message_type TEXT DEFAULT 'info',
    content TEXT,
    source TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);

// Migration: handle 'tasks' to 'agent_tasks' rename
const oldTasksTable = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get();
const newTasksTable = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_tasks'").get();
if (oldTasksTable && !newTasksTable) {
  // Simple case: just rename
  db.run(`ALTER TABLE tasks RENAME TO agent_tasks`);
  db.run(`DROP INDEX IF EXISTS idx_tasks_agent`);
  db.run(`DROP INDEX IF EXISTS idx_tasks_status`);
} else if (oldTasksTable && newTasksTable) {
  // Both exist - check if we need to migrate data
  const oldCount = (db.query("SELECT COUNT(*) as c FROM tasks").get() as any)?.c || 0;
  const newCount = (db.query("SELECT COUNT(*) as c FROM agent_tasks").get() as any)?.c || 0;
  if (oldCount > 0 && newCount === 0) {
    // Drop empty agent_tasks and rename tasks (preserves data and constraints)
    db.run(`DROP TABLE agent_tasks`);
    db.run(`ALTER TABLE tasks RENAME TO agent_tasks`);
  } else if (oldCount === 0) {
    // Old table is empty, just drop it
    db.run(`DROP TABLE tasks`);
  }
  // Either way, clean up old indexes
  db.run(`DROP INDEX IF EXISTS idx_tasks_agent`);
  db.run(`DROP INDEX IF EXISTS idx_tasks_status`);
}

db.run(`
  CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    agent_id INTEGER,
    prompt TEXT,
    context TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled')),
    result TEXT,
    error TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    duration_ms INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER,
    event_type TEXT,
    event_data TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);

// Create indexes for faster queries
db.run(`CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agent_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id)`);

// ============ Mission Queue Schema Migration ============
// Add columns for mission persistence (safe migration - checks if column exists)
const taskColumns = db.query("PRAGMA table_info(agent_tasks)").all() as { name: string }[];
const existingColumns = new Set(taskColumns.map(c => c.name));

const missionColumns = [
  { name: 'type', sql: 'ALTER TABLE agent_tasks ADD COLUMN type TEXT' },
  { name: 'timeout_ms', sql: 'ALTER TABLE agent_tasks ADD COLUMN timeout_ms INTEGER DEFAULT 120000' },
  { name: 'max_retries', sql: 'ALTER TABLE agent_tasks ADD COLUMN max_retries INTEGER DEFAULT 3' },
  { name: 'retry_count', sql: 'ALTER TABLE agent_tasks ADD COLUMN retry_count INTEGER DEFAULT 0' },
  { name: 'depends_on', sql: 'ALTER TABLE agent_tasks ADD COLUMN depends_on TEXT' },
  { name: 'assigned_to', sql: 'ALTER TABLE agent_tasks ADD COLUMN assigned_to INTEGER' },
];

for (const col of missionColumns) {
  if (!existingColumns.has(col.name)) {
    db.run(col.sql);
  }
}

// Update CHECK constraint to include mission statuses (running, retrying, blocked)
// SQLite requires table recreation to modify constraints
try {
  // Test if constraint needs updating by trying an insert with 'running' status
  db.run(`INSERT INTO agent_tasks (id, status) VALUES ('__constraint_test__', 'running')`);
  db.run(`DELETE FROM agent_tasks WHERE id = '__constraint_test__'`);
} catch {
  // Constraint is restrictive - need to recreate table
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_tasks_new (
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
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);
  // Copy existing data
  db.run(`INSERT OR IGNORE INTO agent_tasks_new SELECT id, agent_id, prompt, context, priority, status, result, error, input_tokens, output_tokens, duration_ms, created_at, started_at, completed_at, type, timeout_ms, max_retries, retry_count, depends_on, assigned_to FROM agent_tasks`);
  // Drop old table and rename
  db.run(`DROP TABLE agent_tasks`);
  db.run(`ALTER TABLE agent_tasks_new RENAME TO agent_tasks`);
  // Recreate indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agent_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status)`);
}

// ============ Session Memory Schema ============

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    previous_session_id TEXT,
    summary TEXT NOT NULL,
    full_context TEXT,
    duration_mins INTEGER,
    commits_count INTEGER,
    tags TEXT,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (previous_session_id) REFERENCES sessions(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    context TEXT,
    source_session_id TEXT,
    confidence TEXT DEFAULT 'medium' CHECK(confidence IN ('low', 'medium', 'high', 'proven')),
    maturity_stage TEXT DEFAULT 'observation' CHECK(maturity_stage IN ('observation', 'learning', 'pattern', 'principle', 'wisdom')),
    times_validated INTEGER DEFAULT 1,
    last_validated_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_session_id) REFERENCES sessions(id)
  )
`);

// Add maturity_stage column if it doesn't exist (migration for existing DBs)
try {
  db.run(`ALTER TABLE learnings ADD COLUMN maturity_stage TEXT DEFAULT 'observation' CHECK(maturity_stage IN ('observation', 'learning', 'pattern', 'principle', 'wisdom'))`);
} catch {
  // Column already exists
}

// Add started_at and ended_at columns to sessions (migration for existing DBs)
try {
  db.run(`ALTER TABLE sessions ADD COLUMN started_at TEXT`);
} catch {
  // Column already exists
}
try {
  db.run(`ALTER TABLE sessions ADD COLUMN ended_at TEXT`);
} catch {
  // Column already exists
}

// Add project_path column to sessions for project/matrix scoping
try {
  db.run(`ALTER TABLE sessions ADD COLUMN project_path TEXT`);
} catch {
  // Column already exists
}

// Add project_path column to learnings for project/matrix scoping
try {
  db.run(`ALTER TABLE learnings ADD COLUMN project_path TEXT`);
} catch {
  // Column already exists
}

db.run(`
  CREATE TABLE IF NOT EXISTS session_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_session_id TEXT NOT NULL,
    to_session_id TEXT NOT NULL,
    link_type TEXT NOT NULL,
    similarity_score REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_session_id) REFERENCES sessions(id),
    FOREIGN KEY (to_session_id) REFERENCES sessions(id),
    UNIQUE(from_session_id, to_session_id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS learning_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_learning_id INTEGER NOT NULL,
    to_learning_id INTEGER NOT NULL,
    link_type TEXT NOT NULL,
    similarity_score REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_learning_id) REFERENCES learnings(id),
    FOREIGN KEY (to_learning_id) REFERENCES learnings(id),
    UNIQUE(from_learning_id, to_learning_id)
  )
`);

// Entities table for knowledge graph nodes
db.run(`
  CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT DEFAULT 'concept' CHECK(type IN ('concept', 'tool', 'pattern', 'file', 'category')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Learning-entity junction table for knowledge graph edges
db.run(`
  CREATE TABLE IF NOT EXISTS learning_entities (
    learning_id INTEGER NOT NULL,
    entity_id INTEGER NOT NULL,
    relevance REAL DEFAULT 1.0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (learning_id, entity_id),
    FOREIGN KEY (learning_id) REFERENCES learnings(id) ON DELETE CASCADE,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
  )
`);

// Session tasks table for tracking work items per session
db.run(`
  CREATE TABLE IF NOT EXISTS session_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('done', 'pending', 'blocked', 'in_progress')),
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high')),
    started_at TEXT,
    completed_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`);

// Session memory indexes
db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_tags ON sessions(tags)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_confidence ON learnings(confidence)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_session_links_from ON session_links(from_session_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learning_links_from ON learning_links(from_learning_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_session_tasks_session ON session_tasks(session_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_session_tasks_status ON session_tasks(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learning_entities_learning ON learning_entities(learning_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learning_entities_entity ON learning_entities(entity_id)`);

// ============ Schema Migrations (idempotent) ============

// Add next_steps and challenges columns to sessions table
try {
  db.run(`ALTER TABLE sessions ADD COLUMN next_steps TEXT`);
} catch { /* Column already exists */ }

try {
  db.run(`ALTER TABLE sessions ADD COLUMN challenges TEXT`);
} catch { /* Column already exists */ }

// Add session_id column to agent_tasks table for task-session linking
try {
  db.run(`ALTER TABLE agent_tasks ADD COLUMN session_id TEXT REFERENCES sessions(id)`);
} catch { /* Column already exists */ }

// Create index for task-session queries
db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON agent_tasks(session_id)`);

// ============ Phase 1: Per-Agent Memory Schema ============

// Add agent_id column to sessions table (nullable, NULL = orchestrator)
try {
  db.run(`ALTER TABLE sessions ADD COLUMN agent_id INTEGER DEFAULT NULL`);
} catch { /* Column already exists */ }

// Add visibility column to sessions table
try {
  db.run(`ALTER TABLE sessions ADD COLUMN visibility TEXT DEFAULT 'public'`);
} catch { /* Column already exists */ }

// Add agent_id column to learnings table (nullable, NULL = orchestrator)
try {
  db.run(`ALTER TABLE learnings ADD COLUMN agent_id INTEGER DEFAULT NULL`);
} catch { /* Column already exists */ }

// Add visibility column to learnings table
try {
  db.run(`ALTER TABLE learnings ADD COLUMN visibility TEXT DEFAULT 'public'`);
} catch { /* Column already exists */ }

// ============ Structured Learnings Schema ============

// Add what_happened column for "What happened" section
try {
  db.run(`ALTER TABLE learnings ADD COLUMN what_happened TEXT`);
} catch { /* Column already exists */ }

// Add lesson column for "What I learned" section
try {
  db.run(`ALTER TABLE learnings ADD COLUMN lesson TEXT`);
} catch { /* Column already exists */ }

// Add prevention column for "How to prevent" section
try {
  db.run(`ALTER TABLE learnings ADD COLUMN prevention TEXT`);
} catch { /* Column already exists */ }

// Add source_url column for external reference links
try {
  db.run(`ALTER TABLE learnings ADD COLUMN source_url TEXT`);
} catch { /* Column already exists */ }

// Create indexes for agent-scoped queries
db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_agent ON learnings(agent_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_visibility ON sessions(visibility)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_visibility ON learnings(visibility)`);

// Create indexes for project-scoped queries
db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings(project_path)`);

// ============ Dual-Collection Pattern Schema (Knowledge + Lessons) ============

// Knowledge entries - raw facts, observations, findings
db.run(`
  CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    mission_id TEXT,
    category TEXT,
    agent_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Lesson entries - structured problem → solution → outcome
db.run(`
  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    problem TEXT NOT NULL,
    solution TEXT NOT NULL,
    outcome TEXT NOT NULL,
    category TEXT,
    confidence REAL DEFAULT 0.5,
    frequency INTEGER DEFAULT 1,
    agent_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Indexes for knowledge and lessons
db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge(agent_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_mission ON knowledge(mission_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_lessons_category ON lessons(category)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_lessons_agent ON lessons(agent_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_lessons_confidence ON lessons(confidence)`);

// ============ Phase 3: Matrix Registry Schema ============

db.run(`
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

db.run(`CREATE INDEX IF NOT EXISTS idx_matrix_status ON matrix_registry(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_matrix_last_seen ON matrix_registry(last_seen)`);

// ============ Matrix Messages Schema ============

db.run(`
  CREATE TABLE IF NOT EXISTS matrix_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE,
    from_matrix TEXT NOT NULL,
    to_matrix TEXT,
    content TEXT NOT NULL,
    message_type TEXT DEFAULT 'broadcast' CHECK(message_type IN ('broadcast', 'direct')),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'delivered', 'failed')),
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT,
    delivered_at TEXT,
    read_at TEXT
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_matrix_messages_status ON matrix_messages(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_matrix_messages_to ON matrix_messages(to_matrix)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_matrix_messages_from ON matrix_messages(from_matrix)`);

// ============ FTS5 Full-Text Search ============

// Create FTS5 virtual table for learnings (keyword search)
db.run(`
  CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
    title,
    description,
    lesson,
    content='learnings',
    content_rowid='id'
  )
`);

// Triggers to keep FTS in sync with learnings table
db.run(`
  CREATE TRIGGER IF NOT EXISTS learnings_fts_ai AFTER INSERT ON learnings BEGIN
    INSERT INTO learnings_fts(rowid, title, description, lesson)
    VALUES (new.id, new.title, new.description, new.lesson);
  END
`);

db.run(`
  CREATE TRIGGER IF NOT EXISTS learnings_fts_ad AFTER DELETE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, title, description, lesson)
    VALUES ('delete', old.id, old.title, old.description, old.lesson);
  END
`);

db.run(`
  CREATE TRIGGER IF NOT EXISTS learnings_fts_au AFTER UPDATE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, title, description, lesson)
    VALUES ('delete', old.id, old.title, old.description, old.lesson);
    INSERT INTO learnings_fts(rowid, title, description, lesson)
    VALUES (new.id, new.title, new.description, new.lesson);
  END
`);

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

  // Auto-embed message for semantic search (non-blocking)
  getVectorDb().then(vdb => {
    if (vdb.isInitialized && vdb.isInitialized()) {
      vdb.embedMessage(
        `msg_${result.lastInsertRowid}`,
        content,
        direction,
        {
          agent_id: agentId,
          message_type: messageType,
          source: source || undefined,
          created_at: new Date().toISOString(),
        }
      ).catch(() => {}); // Silently ignore embedding errors
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
  priority = 'normal'
) {
  db.run(
    `INSERT INTO agent_tasks (id, agent_id, prompt, context, priority, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP)`,
    [taskId, agentId, prompt, context || null, priority]
  );
  logMessage(agentId, 'inbound', `Task queued: ${prompt.substring(0, 100)}...`, 'task', 'orchestrator');
  logEvent(agentId, 'task_queued', { task_id: taskId, priority });
}

export function startTask(taskId: string) {
  db.run(
    `UPDATE agent_tasks SET status = 'processing', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [taskId]
  );
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
}): void {
  const dependsOnJson = mission.dependsOn ? JSON.stringify(mission.dependsOn) : null;
  const errorJson = mission.error ? JSON.stringify(mission.error) : null;
  const resultJson = mission.result ? JSON.stringify(mission.result) : null;

  db.run(`
    INSERT INTO agent_tasks (id, prompt, context, priority, type, status, timeout_ms, max_retries, retry_count, depends_on, assigned_to, error, result, created_at, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      retry_count = excluded.retry_count,
      assigned_to = excluded.assigned_to,
      error = excluded.error,
      result = excluded.result,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at
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

  params.push(missionId);
  db.run(`UPDATE agent_tasks SET ${updates.join(', ')} WHERE id = ?`, params);
}

export function getMissionFromDb(missionId: string): MissionRecord | null {
  return db.query(`SELECT * FROM agent_tasks WHERE id = ?`).get(missionId) as MissionRecord | null;
}

// ============ Matrix Message Functions ============

export interface MatrixMessageRecord {
  id: number;
  message_id: string;
  from_matrix: string;
  to_matrix: string | null;
  content: string;
  message_type: 'broadcast' | 'direct';
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  retry_count: number;
  max_retries: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
}

/**
 * Save a new outgoing matrix message
 */
export function saveMatrixMessage(msg: {
  messageId: string;
  fromMatrix: string;
  toMatrix?: string;
  content: string;
  messageType: 'broadcast' | 'direct';
  maxRetries?: number;
}): number {
  const result = db.run(`
    INSERT INTO matrix_messages (message_id, from_matrix, to_matrix, content, message_type, max_retries)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    msg.messageId,
    msg.fromMatrix,
    msg.toMatrix || null,
    msg.content,
    msg.messageType,
    msg.maxRetries || 3,
  ]);
  return Number(result.lastInsertRowid);
}

/**
 * Mark message as sent (transmitted to hub)
 */
export function markMessageSent(messageId: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'sent', sent_at = CURRENT_TIMESTAMP
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
 */
export function incrementMessageRetry(messageId: string): number {
  db.run(`
    UPDATE matrix_messages
    SET retry_count = retry_count + 1, status = 'pending'
    WHERE message_id = ?
  `, [messageId]);
  const msg = db.query(`SELECT retry_count FROM matrix_messages WHERE message_id = ?`).get(messageId) as { retry_count: number } | null;
  return msg?.retry_count || 0;
}

/**
 * Get pending messages that need retry
 */
export function getPendingMessages(maxRetries: number = 3): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE status IN ('pending', 'sent')
      AND retry_count < ?
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
 * Save incoming message to inbox
 */
export function saveIncomingMessage(msg: {
  messageId: string;
  fromMatrix: string;
  toMatrix?: string;
  content: string;
  messageType: 'broadcast' | 'direct';
}): number {
  const result = db.run(`
    INSERT OR IGNORE INTO matrix_messages (message_id, from_matrix, to_matrix, content, message_type, status, sent_at, delivered_at)
    VALUES (?, ?, ?, ?, ?, 'delivered', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    msg.messageId,
    msg.fromMatrix,
    msg.toMatrix || null,
    msg.content,
    msg.messageType,
  ]);
  return Number(result.lastInsertRowid);
}

/**
 * Get unread messages for a matrix
 */
export function getUnreadMessages(matrixId: string, limit: number = 50): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE (to_matrix = ? OR to_matrix IS NULL OR message_type = 'broadcast')
      AND from_matrix != ?
      AND status = 'delivered'
      AND read_at IS NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(matrixId, matrixId, limit) as MatrixMessageRecord[];
}

/**
 * Get all inbox messages for a matrix
 */
export function getInboxMessages(matrixId: string, limit: number = 50): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE (to_matrix = ? OR to_matrix IS NULL OR message_type = 'broadcast')
      AND from_matrix != ?
      AND status = 'delivered'
    ORDER BY created_at DESC
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
}

export function createLearning(learning: LearningRecord): number {
  const result = db.run(
    `INSERT INTO learnings (category, title, description, context, source_session_id, source_url, confidence, agent_id, visibility, what_happened, lesson, prevention, project_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  const existing = db.query(`SELECT id FROM entities WHERE name = ?`).get(normalized) as { id: number } | null;
  if (existing) return existing.id;

  const result = db.run(
    `INSERT INTO entities (name, type) VALUES (?, ?)`,
    [normalized, type]
  );
  return Number(result.lastInsertRowid);
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

  // Upsert: insert or update if exists
  const existing = db.query(`SELECT id FROM matrix_registry WHERE matrix_id = ?`).get(matrixId) as { id: number } | null;

  if (existing) {
    db.run(
      `UPDATE matrix_registry SET display_name = COALESCE(?, display_name), last_seen = CURRENT_TIMESTAMP, status = 'online', metadata = COALESCE(?, metadata) WHERE id = ?`,
      [displayName || null, metadataJson, existing.id]
    );
    return existing.id;
  }

  const result = db.run(
    `INSERT INTO matrix_registry (matrix_id, display_name, status, metadata) VALUES (?, ?, 'online', ?)`,
    [matrixId, displayName || null, metadataJson]
  );
  return Number(result.lastInsertRowid);
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
