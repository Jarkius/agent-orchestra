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

db.run(`
  CREATE TABLE IF NOT EXISTS tasks (
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
db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id)`);

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
    times_validated INTEGER DEFAULT 1,
    last_validated_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_session_id) REFERENCES sessions(id)
  )
`);

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

// ============ Schema Migrations (idempotent) ============

// Add next_steps and challenges columns to sessions table
try {
  db.run(`ALTER TABLE sessions ADD COLUMN next_steps TEXT`);
} catch { /* Column already exists */ }

try {
  db.run(`ALTER TABLE sessions ADD COLUMN challenges TEXT`);
} catch { /* Column already exists */ }

// Add session_id column to tasks table for task-session linking
try {
  db.run(`ALTER TABLE tasks ADD COLUMN session_id TEXT REFERENCES sessions(id)`);
} catch { /* Column already exists */ }

// Create index for task-session queries
db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)`);

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

// Create indexes for agent-scoped queries
db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_agent ON learnings(agent_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_visibility ON sessions(visibility)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_visibility ON learnings(visibility)`);

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
    `INSERT INTO tasks (id, agent_id, prompt, context, priority, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP)`,
    [taskId, agentId, prompt, context || null, priority]
  );
  logMessage(agentId, 'inbound', `Task queued: ${prompt.substring(0, 100)}...`, 'task', 'orchestrator');
  logEvent(agentId, 'task_queued', { task_id: taskId, priority });
}

export function startTask(taskId: string) {
  db.run(
    `UPDATE tasks SET status = 'processing', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
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
    `UPDATE tasks SET
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
    `UPDATE tasks SET
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
  return db.query(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as any;
}

export function getAgentTasks(agentId: number, status?: string, limit = 20) {
  if (status) {
    return db.query(
      `SELECT * FROM tasks WHERE agent_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`
    ).all(agentId, status, limit);
  }
  return db.query(
    `SELECT * FROM tasks WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`
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
    FROM tasks
    GROUP BY status
  `).all();
}

export function cancelTask(taskId: string) {
  const task = getTask(taskId);
  if (task && task.status !== 'completed' && task.status !== 'failed') {
    db.run(
      `UPDATE tasks SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
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
  db.run(`DELETE FROM tasks`);
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

export interface FullContext {
  // Session outcomes
  wins?: string[];
  issues?: string[];
  key_decisions?: string[];
  challenges?: string[];
  next_steps?: string[];
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
  created_at?: string;
}

export function createSession(session: SessionRecord): void {
  db.run(
    `INSERT INTO sessions (id, previous_session_id, summary, full_context, duration_mins, commits_count, tags, agent_id, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  };
}

export interface ListSessionsOptions {
  tag?: string;
  since?: string;
  limit?: number;
  agentId?: number | null;
  includeShared?: boolean;
}

export function listSessionsFromDb(options?: ListSessionsOptions): SessionRecord[] {
  const { tag, since, limit = 20, agentId, includeShared = true } = options || {};
  let query = `SELECT * FROM sessions WHERE 1=1`;
  const params: any[] = [];

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
  }));
}

// ============ Learning Functions ============

export interface LearningRecord {
  id?: number;
  category: string;
  title: string;
  description?: string;
  context?: string;
  source_session_id?: string;
  confidence?: 'low' | 'medium' | 'high' | 'proven';
  times_validated?: number;
  last_validated_at?: string;
  agent_id?: number | null;
  visibility?: Visibility;
  created_at?: string;
  // Structured learning fields
  what_happened?: string;
  lesson?: string;
  prevention?: string;
}

export function createLearning(learning: LearningRecord): number {
  const result = db.run(
    `INSERT INTO learnings (category, title, description, context, source_session_id, confidence, agent_id, visibility, what_happened, lesson, prevention)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      learning.category,
      learning.title,
      learning.description || null,
      learning.context || null,
      learning.source_session_id || null,
      learning.confidence || 'medium',
      learning.agent_id ?? null,
      learning.visibility || 'public',
      learning.what_happened || null,
      learning.lesson || null,
      learning.prevention || null,
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
  };
}

export interface ListLearningsOptions {
  category?: string;
  confidence?: string;
  limit?: number;
  agentId?: number | null;
  includeShared?: boolean;
}

export function listLearningsFromDb(options?: ListLearningsOptions): LearningRecord[] {
  const { category, confidence, limit = 50, agentId, includeShared = true } = options || {};
  let query = `SELECT * FROM learnings WHERE 1=1`;
  const params: any[] = [];

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
  }));
}

export function validateLearning(learningId: number): LearningRecord | null {
  const learning = getLearningById(learningId);
  if (!learning) return null;

  const newCount = (learning.times_validated || 1) + 1;
  let newConfidence = learning.confidence || 'medium';

  // Confidence progression
  if (newCount >= 5) newConfidence = 'proven';
  else if (newCount >= 3) newConfidence = 'high';
  else if (newCount >= 2) newConfidence = 'medium';

  db.run(
    `UPDATE learnings SET times_validated = ?, confidence = ?, last_validated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newCount, newConfidence, learningId]
  );

  return getLearningById(learningId);
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
      `UPDATE tasks SET session_id = ? WHERE id = ?`,
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
    `SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(sessionId, limit);
}

/**
 * Get the session associated with a task
 */
export function getSessionByTask(taskId: string): SessionRecord | null {
  const task = db.query(`SELECT session_id FROM tasks WHERE id = ?`).get(taskId) as any;
  if (!task?.session_id) return null;
  return getSessionById(task.session_id);
}

/**
 * Get tasks that are not linked to any session
 */
export function getUnlinkedTasks(agentId?: number, limit = 50): any[] {
  if (agentId) {
    return db.query(
      `SELECT * FROM tasks WHERE session_id IS NULL AND agent_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(agentId, limit);
  }
  return db.query(
    `SELECT * FROM tasks WHERE session_id IS NULL ORDER BY created_at DESC LIMIT ?`
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
