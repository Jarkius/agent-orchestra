/**
 * Database Core - Foundation module for all database operations
 *
 * Exports:
 * - db: The SQLite database instance
 * - getVectorDb: Async function to get vector DB module
 *
 * All schema initialization and migrations are handled here.
 * Other db modules should import { db } from './core'
 */

import { Database } from "bun:sqlite";
import { existsSync, unlinkSync, writeFileSync, readFileSync } from "fs";

export const DB_PATH = "./agents.db";
const LOCK_PATH = "./agents.db.init.lock";
const LOCK_TIMEOUT_MS = 30000; // 30 second timeout for stale locks

// Optional vector DB import - may not be initialized
let vectorDbModule: any = null;
export async function getVectorDb() {
  if (!vectorDbModule) {
    try {
      vectorDbModule = await import('../vector-db');
    } catch {
      vectorDbModule = { isInitialized: () => false };
    }
  }
  return vectorDbModule;
}

// File-based lock for initialization coordination
function acquireInitLock(): boolean {
  try {
    // Check for stale lock
    if (existsSync(LOCK_PATH)) {
      try {
        const lockData = readFileSync(LOCK_PATH, 'utf-8');
        const lockTime = parseInt(lockData, 10);
        if (Date.now() - lockTime > LOCK_TIMEOUT_MS) {
          // Stale lock, remove it
          unlinkSync(LOCK_PATH);
        } else {
          // Lock is held by another process
          return false;
        }
      } catch {
        // Corrupted lock file, remove it
        try { unlinkSync(LOCK_PATH); } catch {}
      }
    }

    // Try to create lock file atomically using exclusive flag
    writeFileSync(LOCK_PATH, Date.now().toString(), { flag: 'wx' });
    return true;
  } catch (e: any) {
    // EEXIST means another process grabbed the lock
    if (e.code === 'EEXIST') return false;
    // Other errors - try to proceed anyway
    return true;
  }
}

function releaseInitLock(): void {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // Lock already removed or never existed
  }
}

function waitForInitLock(maxWaitMs: number = 10000): void {
  const startTime = Date.now();
  const sleepMs = 50;

  while (existsSync(LOCK_PATH)) {
    if (Date.now() - startTime > maxWaitMs) {
      // Timeout - lock might be stale, try to clean up
      try {
        const lockData = readFileSync(LOCK_PATH, 'utf-8');
        const lockTime = parseInt(lockData, 10);
        if (Date.now() - lockTime > LOCK_TIMEOUT_MS) {
          unlinkSync(LOCK_PATH);
          break;
        }
      } catch {
        try { unlinkSync(LOCK_PATH); } catch {}
        break;
      }
      break;
    }
    // Busy wait with small delay
    Bun.sleepSync(sleepMs);
  }
}

export const db = new Database(DB_PATH);

// Configure for concurrent access from multiple processes
// These PRAGMAs may fail during concurrent startup - retry with backoff
function configurePragmas(): void {
  const maxRetries = 5;
  const baseDelayMs = 50;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Set busy_timeout first to help with subsequent operations
      db.run("PRAGMA busy_timeout=5000");     // Wait up to 5 seconds if database is locked
      db.run("PRAGMA journal_mode=WAL");      // Allow concurrent reads during writes
      db.run("PRAGMA synchronous=NORMAL");    // Balance between safety and performance
      return; // Success
    } catch (e: any) {
      if (e.code === 'SQLITE_BUSY' && attempt < maxRetries) {
        // Database locked - wait and retry with exponential backoff
        Bun.sleepSync(baseDelayMs * attempt);
        continue;
      }
      throw e; // Rethrow on last attempt or non-busy errors
    }
  }
}
configurePragmas();

// Check if schema is already initialized (tables exist)
function isSchemaInitialized(): boolean {
  try {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
    return result !== null;
  } catch {
    return false;
  }
}

// Initialize schema with file-based lock coordination
function initializeSchema(): void {
  // Skip if already initialized and we don't hold the lock
  if (isSchemaInitialized() && existsSync(LOCK_PATH)) {
    // Another process is initializing, wait for it
    waitForInitLock();
    return;
  }

  // Try to acquire lock for initialization
  const gotLock = acquireInitLock();

  if (!gotLock) {
    // Another process is initializing, wait and return
    waitForInitLock();
    return;
  }

  try {
    // Double-check after acquiring lock
    if (isSchemaInitialized()) {
      // Schema already exists, nothing to do
      return;
    }

    // Run all schema creation in a transaction for atomicity
    db.run("BEGIN IMMEDIATE");

    try {
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

// Entity relationships table for knowledge graph edges between entities
db.run(`
  CREATE TABLE IF NOT EXISTS entity_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_entity_id INTEGER NOT NULL,
    target_entity_id INTEGER NOT NULL,
    relationship_type TEXT NOT NULL CHECK(relationship_type IN (
      'depends_on', 'enables', 'conflicts_with', 'alternative_to',
      'specializes', 'generalizes', 'precedes', 'follows', 'complements'
    )),
    strength REAL DEFAULT 1.0,
    bidirectional INTEGER DEFAULT 0,
    reasoning TEXT,
    source_learning_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_entity_id, target_entity_id, relationship_type),
    FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (source_learning_id) REFERENCES learnings(id) ON DELETE SET NULL
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

// ============ Task Linking Schema (Phases 2-4) ============

// Add unified_task_id to link agent work back to business requirements
try {
  db.run(`ALTER TABLE agent_tasks ADD COLUMN unified_task_id INTEGER REFERENCES unified_tasks(id)`);
} catch { /* Column already exists */ }
db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_unified ON agent_tasks(unified_task_id)`);

// Add mission_id to link sub-tasks to their parent orchestration mission
try {
  db.run(`ALTER TABLE agent_tasks ADD COLUMN parent_mission_id TEXT`);
} catch { /* Column already exists */ }
db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_parent_mission ON agent_tasks(parent_mission_id)`);

// Add execution_id for task idempotency - prevents duplicate execution on crash recovery
try {
  db.run(`ALTER TABLE agent_tasks ADD COLUMN execution_id TEXT`);
} catch { /* Column already exists */ }
db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_execution ON agent_tasks(execution_id)`);

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

// Add source_task_id to link learnings back to the task that generated them
try {
  db.run(`ALTER TABLE learnings ADD COLUMN source_task_id TEXT`);
} catch { /* Column already exists */ }
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_task ON learnings(source_task_id)`);

// Add source_mission_id to link learnings back to their orchestration mission
try {
  db.run(`ALTER TABLE learnings ADD COLUMN source_mission_id TEXT`);
} catch { /* Column already exists */ }
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_mission ON learnings(source_mission_id)`);

// Add source_unified_task_id to link learnings to business requirements
try {
  db.run(`ALTER TABLE learnings ADD COLUMN source_unified_task_id INTEGER`);
} catch { /* Column already exists */ }
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_unified ON learnings(source_unified_task_id)`);

// Add source_code_file_id to link learnings to source code files
try {
  db.run(`ALTER TABLE learnings ADD COLUMN source_code_file_id TEXT`);
} catch { /* Column already exists */ }
db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_code_file ON learnings(source_code_file_id)`);

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
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'delivered', 'failed')),
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

// ============ Code Files Index Schema ============

db.run(`
  CREATE TABLE IF NOT EXISTS code_files (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    real_path TEXT,
    project_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    language TEXT,
    line_count INTEGER DEFAULT 0,
    size_bytes INTEGER DEFAULT 0,
    chunk_count INTEGER DEFAULT 0,
    functions TEXT,
    classes TEXT,
    imports TEXT,
    exports TEXT,
    is_external INTEGER DEFAULT 0,
    indexed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(file_path, project_id)
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_code_files_path ON code_files(file_path)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_code_files_real ON code_files(real_path)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_code_files_language ON code_files(language)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_code_files_name ON code_files(file_name)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_code_files_project ON code_files(project_id)`);

// ============ Symbol Index (Queryable Symbols from Code) ============
// Extracts functions, classes, exports from code_files JSON for fast lookup

db.run(`
  CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_file_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('function', 'class', 'export', 'import')),
    line_start INTEGER,
    line_end INTEGER,
    signature TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (code_file_id) REFERENCES code_files(id) ON DELETE CASCADE
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(code_file_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type)`);

// ============ Code Patterns (Detected Design Patterns) ============
// Stores patterns detected by code-analyzer.ts for persistent pattern tracking

db.run(`
  CREATE TABLE IF NOT EXISTS code_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_file_id TEXT NOT NULL,
    pattern_name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    evidence TEXT,
    line_number INTEGER,
    confidence REAL DEFAULT 0.5,
    detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (code_file_id) REFERENCES code_files(id) ON DELETE CASCADE
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS idx_code_patterns_file ON code_patterns(code_file_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_code_patterns_name ON code_patterns(pattern_name)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_code_patterns_category ON code_patterns(category)`);

// ============ Learning-Code Links (Many-to-Many) ============
// Bi-directional linking between learnings and source code files

db.run(`
  CREATE TABLE IF NOT EXISTS learning_code_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    learning_id INTEGER NOT NULL,
    code_file_id TEXT NOT NULL,
    link_type TEXT DEFAULT 'derived_from' CHECK(link_type IN ('derived_from', 'applies_to', 'example_in', 'pattern_match')),
    relevance_score REAL DEFAULT 1.0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (learning_id) REFERENCES learnings(id) ON DELETE CASCADE,
    FOREIGN KEY (code_file_id) REFERENCES code_files(id) ON DELETE CASCADE,
    UNIQUE(learning_id, code_file_id, link_type)
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learning_code_learning ON learning_code_links(learning_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_learning_code_file ON learning_code_links(code_file_id)`);

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

      // Commit all schema changes atomically
      db.run("COMMIT");

      // ============ Idempotent Migrations (always run) ============
      // These use IF NOT EXISTS and try-catch, so they're safe to run on every load
      // They run AFTER the transaction commits successfully

      // Migration: Add code learning tables for symbol extraction and pattern detection
      db.run(`
        CREATE TABLE IF NOT EXISTS symbols (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code_file_id TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('function', 'class', 'export', 'import')),
          line_start INTEGER,
          line_end INTEGER,
          signature TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(code_file_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type)`);

      db.run(`
        CREATE TABLE IF NOT EXISTS code_patterns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code_file_id TEXT NOT NULL,
          pattern_name TEXT NOT NULL,
          category TEXT,
          description TEXT,
          evidence TEXT,
          line_number INTEGER,
          confidence REAL DEFAULT 0.5,
          detected_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_code_patterns_name ON code_patterns(pattern_name)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_code_patterns_file ON code_patterns(code_file_id)`);

      db.run(`
        CREATE TABLE IF NOT EXISTS learning_code_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          learning_id INTEGER NOT NULL,
          code_file_id TEXT NOT NULL,
          link_type TEXT DEFAULT 'derived_from' CHECK(link_type IN ('derived_from', 'applies_to', 'example_in', 'pattern_match')),
          relevance_score REAL DEFAULT 1.0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(learning_id, code_file_id, link_type)
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_learning_code_links_learning ON learning_code_links(learning_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_learning_code_links_file ON learning_code_links(code_file_id)`);

      // Migration: Add source_code_file_id to learnings for code-learning links
      try {
        db.run(`ALTER TABLE learnings ADD COLUMN source_code_file_id TEXT`);
      } catch { /* Column already exists */ }
      db.run(`CREATE INDEX IF NOT EXISTS idx_learnings_code_file ON learnings(source_code_file_id)`);

      // Migration: Add sequence_number column to matrix_messages for ordering
      try {
        db.run(`ALTER TABLE matrix_messages ADD COLUMN sequence_number INTEGER DEFAULT 0`);
      } catch { /* Column already exists */ }

      // Migration: Add next_retry_at column for exponential backoff
      try {
        db.run(`ALTER TABLE matrix_messages ADD COLUMN next_retry_at TEXT`);
      } catch { /* Column already exists */ }

      // Migration: Add attempted_at column for tracking last retry attempt
      try {
        db.run(`ALTER TABLE matrix_messages ADD COLUMN attempted_at TEXT`);
      } catch { /* Column already exists */ }

      // Create index for ordering messages by sequence within a matrix
      db.run(`CREATE INDEX IF NOT EXISTS idx_matrix_messages_sequence ON matrix_messages(from_matrix, sequence_number)`);

      // Create index for efficient retry queries
      db.run(`CREATE INDEX IF NOT EXISTS idx_matrix_messages_retry ON matrix_messages(status, next_retry_at)`);

      // Migration: Add content column to code_files for full source code storage
      try {
        db.run(`ALTER TABLE code_files ADD COLUMN content TEXT`);
      } catch { /* Column already exists */ }

      // Sequence counter table for atomic message ordering per matrix
      db.run(`
        CREATE TABLE IF NOT EXISTS matrix_sequence_counters (
          matrix_id TEXT PRIMARY KEY,
          next_sequence INTEGER DEFAULT 1
        )
      `);

      // ============ Unified Tasks Schema ============
      db.run(`
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
          github_sync_status TEXT DEFAULT 'pending' CHECK(github_sync_status IN ('pending', 'synced', 'error', 'local_only')),
          github_repo TEXT,
          component TEXT,
          repro_steps TEXT,
          known_fix TEXT,
          context TEXT,
          session_id TEXT,
          learning_id INTEGER,
          project_path TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id),
          FOREIGN KEY (learning_id) REFERENCES learnings(id)
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_domain ON unified_tasks(domain)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_status ON unified_tasks(status)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_github ON unified_tasks(github_issue_number)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_component ON unified_tasks(component)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_project ON unified_tasks(project_path)`);

      // Migration: Add github_repo column for multi-repo support
      try {
        db.run(`ALTER TABLE unified_tasks ADD COLUMN github_repo TEXT`);
      } catch { /* Column already exists */ }

      db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_repo ON unified_tasks(github_repo)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_session ON unified_tasks(session_id)`);

      // Migration: Update domain constraint to include 'session'
      try {
        const tableInfo = db.query(`PRAGMA table_info(unified_tasks)`).all() as any[];
        const domainCol = tableInfo.find((c: any) => c.name === 'domain');

        if (domainCol && !domainCol.dflt_value?.includes('session')) {
          try {
            db.run(`INSERT INTO unified_tasks (title, domain, status) VALUES ('__test__', 'session', 'open')`);
            db.run(`DELETE FROM unified_tasks WHERE title = '__test__'`);
          } catch {
            db.run(`PRAGMA foreign_keys=OFF`);
            db.run(`
              CREATE TABLE unified_tasks_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'done', 'blocked', 'wont_fix')),
                priority TEXT DEFAULT 'normal' CHECK(priority IN ('critical', 'high', 'normal', 'low')),
                domain TEXT NOT NULL CHECK(domain IN ('system', 'project', 'session')),
                github_issue_number INTEGER,
                github_issue_url TEXT,
                github_synced_at TEXT,
                github_sync_status TEXT DEFAULT 'pending' CHECK(github_sync_status IN ('pending', 'synced', 'error', 'local_only')),
                github_repo TEXT,
                component TEXT,
                repro_steps TEXT,
                known_fix TEXT,
                context TEXT,
                session_id TEXT,
                learning_id INTEGER,
                project_path TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions(id),
                FOREIGN KEY (learning_id) REFERENCES learnings(id)
              )
            `);
            db.run(`INSERT INTO unified_tasks_new SELECT * FROM unified_tasks`);
            db.run(`DROP TABLE unified_tasks`);
            db.run(`ALTER TABLE unified_tasks_new RENAME TO unified_tasks`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_domain ON unified_tasks(domain)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_status ON unified_tasks(status)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_github ON unified_tasks(github_issue_number)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_component ON unified_tasks(component)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_project ON unified_tasks(project_path)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_repo ON unified_tasks(github_repo)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_unified_tasks_session ON unified_tasks(session_id)`);
            db.run(`PRAGMA foreign_keys=ON`);
          }
        }
      } catch { /* Migration already done or table just created */ }

      // Migration: Migrate session_tasks to unified_tasks
      try {
        const sessionTasks = db.query(`SELECT * FROM session_tasks WHERE 1=1`).all() as any[];
        if (sessionTasks.length > 0) {
          for (const task of sessionTasks) {
            const statusMap: Record<string, string> = {
              'pending': 'open',
              'in_progress': 'in_progress',
              'done': 'done',
              'blocked': 'blocked'
            };
            const status = statusMap[task.status] || 'open';
            db.run(`
              INSERT INTO unified_tasks (
                title, description, status, priority, domain, session_id, context, created_at
              ) VALUES (?, ?, ?, ?, 'session', ?, ?, ?)
            `, [
              task.description,
              task.notes || null,
              status,
              task.priority || 'normal',
              task.session_id,
              task.notes || null,
              task.created_at
            ]);
          }
          db.run(`DELETE FROM session_tasks`);
          console.log(`Migrated ${sessionTasks.length} session tasks to unified_tasks`);
        }
      } catch { /* Migration already done or no session_tasks */ }

      // ============ Missions Schema ============
      db.run(`
        CREATE TABLE IF NOT EXISTS missions (
          id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          context TEXT,
          priority TEXT DEFAULT 'normal' CHECK(priority IN ('critical', 'high', 'normal', 'low')),
          type TEXT CHECK(type IN ('extraction', 'analysis', 'synthesis', 'review', 'general')),
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'queued', 'running', 'completed', 'failed', 'retrying', 'blocked', 'cancelled')),
          timeout_ms INTEGER DEFAULT 300000,
          max_retries INTEGER DEFAULT 3,
          retry_count INTEGER DEFAULT 0,
          retry_delay_ms INTEGER,
          depends_on TEXT,
          assigned_to INTEGER,
          error TEXT,
          result TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          completed_at TEXT,
          unified_task_id INTEGER,
          FOREIGN KEY (assigned_to) REFERENCES agents(id),
          FOREIGN KEY (unified_task_id) REFERENCES unified_tasks(id)
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_missions_priority ON missions(priority)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_missions_assigned ON missions(assigned_to)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_missions_unified ON missions(unified_task_id)`);

      // ============ Agent Conversations (Agent-to-Agent RPC) ============
      db.run(`
        CREATE TABLE IF NOT EXISTS agent_conversations (
          id TEXT PRIMARY KEY,
          participants TEXT NOT NULL,
          topic TEXT,
          status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed', 'archived')),
          message_count INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS agent_conversation_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          thread_id TEXT,
          correlation_id TEXT,
          from_agent INTEGER NOT NULL,
          to_agent INTEGER,
          message_type TEXT NOT NULL CHECK(message_type IN ('rpc.request', 'rpc.response', 'event', 'ack', 'error')),
          method TEXT,
          content TEXT NOT NULL,
          ok INTEGER,
          deadline_ms INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id),
          FOREIGN KEY (from_agent) REFERENCES agents(id)
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON agent_conversation_messages(conversation_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_conv_messages_thread ON agent_conversation_messages(thread_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_conv_messages_correlation ON agent_conversation_messages(correlation_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_conv_messages_from ON agent_conversation_messages(from_agent)`);

    } catch (schemaError) {
      // Rollback on any error
      try { db.run("ROLLBACK"); } catch {}
      throw schemaError;
    }
  } finally {
    // Always release lock
    releaseInitLock();
  }
}

// Run schema initialization at module load
initializeSchema();
