# Memory System: Design & Architecture

## Overview

The Memory System enables persistent knowledge capture across Claude Code sessions. It solves the problem of context loss when conversations are cleared, allowing insights, learnings, and session context to be preserved and recalled.

---

## Problem Statement

**Challenge:** Claude Code sessions are ephemeral. When you `/clear` or start a new session, all context is lost - including valuable insights, decisions made, and lessons learned.

**Solution:** A dual-storage memory system that captures:
1. **Sessions** - Ephemeral context (what happened, what worked, challenges)
2. **Learnings** - Persistent knowledge (reusable insights, principles, patterns)

---

## User Stories

| As a... | I want to... | So that... |
|---------|--------------|------------|
| Developer | Save session context before clearing | I can resume where I left off |
| Developer | Capture insights with categories | Knowledge is organized and searchable |
| Developer | Search past learnings semantically | I can find relevant knowledge quickly |
| Developer | Extract learnings from old sessions | I don't lose insights I forgot to capture |
| Developer | See confidence levels on learnings | I know which insights are battle-tested |

---

## Command Reference

### Primary Commands

| Command | Purpose | Creates |
|---------|---------|---------|
| `bun memory save` | End session, capture context + learnings | Session + Learnings |
| `bun memory learn <cat> "title"` | Quick insight capture | Learning only |
| `bun memory distill` | Extract from past sessions | Learnings |
| `bun memory recall [query]` | Search or resume | - |

### Full Command List

```bash
# Session Management
bun memory save                    # Interactive save with learning prompts
bun memory save "quick summary"    # Quick save (still prompts for learnings)
bun memory recall                  # Resume last session
bun memory recall "query"          # Semantic search
bun memory recall "#5"             # Specific learning by ID
bun memory recall "session_123"    # Specific session by ID

# Learning Capture
bun memory learn <category> "title" ["context"]
bun memory learn insight "Tests document behavior" "Not just for catching bugs"
bun memory learn philosophy "Simplicity over cleverness"

# Extraction
bun memory distill                 # From last session
bun memory distill session_123     # From specific session
bun memory distill --last 5 --yes  # Batch with auto-accept

# Utilities
bun memory list sessions           # List recent sessions
bun memory list learnings          # List learnings
bun memory stats                   # Statistics
bun memory export [path]           # Export to markdown
bun memory context [query]         # Context bundle for new session
```

---

## Categories

### Technical (7)
| Category | Icon | Description |
|----------|------|-------------|
| `performance` | ⚡ | Speed, memory, optimization |
| `architecture` | 🏛️ | System design, patterns |
| `tooling` | 🔧 | Tools, configs, environment |
| `process` | 📋 | Workflow, methodology |
| `debugging` | 🔍 | Problem diagnosis, troubleshooting |
| `security` | 🔒 | Security practices, hardening |
| `testing` | 🧪 | Test strategies, quality |

### Wisdom (5)
| Category | Icon | Description |
|----------|------|-------------|
| `philosophy` | 🌟 | Core beliefs, approaches |
| `principle` | ⚖️ | Guiding rules, non-negotiables |
| `insight` | 💡 | Deep realizations, "aha" moments |
| `pattern` | 🔄 | Recurring observations |
| `retrospective` | 📖 | Lessons from experience |

---

## Confidence Model

| Source | Starting Confidence | Rationale |
|--------|---------------------|-----------|
| `save` (user confirmed) | `medium` | Explicitly validated during session |
| `learn` (quick capture) | `low` | Hypothesis, needs validation |
| `distill` (extracted) | `low` | Auto-suggested, needs confirmation |

### Progression
```
low → medium → high → proven
     (1 validation)  (2 validations)  (2 validations)
```

Use `validate_learning` MCP tool to increase confidence based on real-world validation.

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    WORKING SESSION                           │
│              (conversation, code, decisions)                 │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌──────────┐   ┌──────────┐   ┌──────────┐
       │  save    │   │  learn   │   │ distill  │
       │(session) │   │ (quick)  │   │ (batch)  │
       └────┬─────┘   └────┬─────┘   └────┬─────┘
            │              │              │
            ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                      LEARNINGS TABLE                         │
│          (Single Source of Truth for Knowledge)              │
│   id | category | title | confidence | source_session_id    │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────────┐   ┌──────────┐
    │  SQLite  │   │   ChromaDB   │   │  Export  │
    │ (Truth)  │   │  (Search)    │   │   (.md)  │
    └──────────┘   └──────────────┘   └──────────┘
```

### Storage Layer

#### SQLite (Source of Truth)
```sql
-- Sessions: Ephemeral context
sessions (
  id TEXT PRIMARY KEY,
  summary TEXT,
  full_context JSON,      -- what_worked, challenges, etc.
  duration_mins INTEGER,
  commits_count INTEGER,
  tags JSON,
  agent_id INTEGER,       -- For per-agent isolation
  visibility TEXT,        -- private, shared, public
  created_at TEXT
)

-- Learnings: Persistent knowledge
learnings (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  context TEXT,
  source_session_id TEXT, -- Links to origin session
  confidence TEXT,        -- low, medium, high, proven
  times_validated INTEGER,
  agent_id INTEGER,
  visibility TEXT,
  created_at TEXT
)

-- Relationships
session_links (from_session_id, to_session_id, link_type, similarity)
learning_links (from_learning_id, to_learning_id, link_type, similarity)
session_tasks (session_id, description, status, notes)
```

#### ChromaDB (Semantic Search)
| Collection | Purpose |
|------------|---------|
| `sessions_search` | Semantic session search |
| `learnings_search` | Semantic learning search |
| `task_search` | Task-based search |

Embedding model: `bge-small-en-v1.5` via Transformers.js (~3ms per query)

### Auto-Linking Algorithm

When a new learning is created:
1. Generate embedding for content
2. Query ChromaDB for similar learnings
3. Create links based on similarity:
   - `> 0.85` → Auto-link (strong relationship)
   - `0.70 - 0.85` → Suggest link (show to user)
   - `< 0.70` → No link

---

## Design Decisions

### Sessions are Ephemeral, Learnings are Persistent

**Decision:** Sessions capture "what happened", learnings capture "what I know"

**Rationale:**
- Sessions are context-heavy, time-bound
- Learnings are distilled, reusable across contexts
- Separating them prevents duplication and confusion

### Single Source of Truth

**Decision:** Learnings table is THE place for knowledge (not session.full_context)

**Rationale:**
- Previously, learnings were in both places
- Created duplication and confusion
- Now: full_context is raw notes, learnings table is structured knowledge

### Unified Confidence Model

**Decision:** All learnings start at same base (source-dependent), not category-dependent

**Rationale:**
- Previously: "wisdom" categories auto-started at medium
- This was arbitrary - a quick philosophy note isn't more validated than a tested tooling tip
- Now: Source matters (save=medium, learn/distill=low)

### Three Entry Points, Clear Purposes

| Entry | When | Why |
|-------|------|-----|
| `save` | End of session | Capture everything, user is reflecting |
| `learn` | Quick insight | No session context, just the insight |
| `distill` | Retrospective | Mine old sessions for missed insights |

---

## File Structure

```
scripts/memory/
├── index.ts          # Command router
├── save-session.ts   # Session save with learning prompts
├── learn.ts          # Quick learning capture
├── distill.ts        # Extract from sessions
├── recall.ts         # Smart recall (ID detection + search)
├── list.ts           # List sessions/learnings
├── stats.ts          # Statistics
├── export.ts         # Export to markdown
└── context.ts        # Context bundle

src/
├── db.ts             # SQLite schema and CRUD
├── vector-db.ts      # ChromaDB integration
├── services/
│   ├── recall-service.ts       # Unified recall logic
│   └── agent-memory-service.ts # Per-agent memory
└── mcp/tools/handlers/
    ├── session.ts    # Session MCP tools
    ├── learning.ts   # Learning MCP tools
    └── analytics.ts  # Stats and export
```

---

## Performance

| Operation | Latency |
|-----------|---------|
| Embedding (short text) | ~3ms |
| Embedding (long text) | ~20ms |
| ChromaDB query | ~6ms |
| SQLite insert | ~0.3ms |
| SQLite query | ~0.04ms |

---

## Future Considerations

1. **Cross-session learning propagation** - Automatically surface relevant learnings in new sessions
2. **Learning decay** - Mark learnings as outdated over time
3. **Contradiction detection** - Flag conflicting learnings
4. **Team sharing** - Share learnings across team members
5. **Integration with Claude's memory** - Sync with Anthropic's memory features when available
