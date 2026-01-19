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

### Slash Commands (via Claude)

| Command | Purpose | Full Context |
|---------|---------|--------------|
| `/memory-save-full` | Save with wins, challenges, learnings (Claude asks questions) | Yes |
| `/memory-save` | Quick save with auto-capture | No |
| `/memory-distill` | Extract learnings from past sessions | - |
| `/memory-recall` | Search or resume sessions | - |
| `/memory-list` | Browse sessions or learnings | - |
| `/memory-learn` | Quick learning capture | - |

### CLI Commands

| Command | Purpose | Creates |
|---------|---------|---------|
| `bun memory save` | Interactive save (prompts for everything) | Session + Learnings |
| `bun memory save "summary"` | Quick save with git context | Session |
| `bun memory learn <cat> "title"` | Quick insight capture | Learning only |
| `bun memory distill` | Extract from past sessions | Learnings |
| `bun memory recall [query]` | Search or resume | - |

### Full Command List

```bash
# Session Management - Slash Commands
/memory-save-full                  # Full context (Claude asks for wins/challenges/learnings)
/memory-save                       # Quick save with auto-capture

# Session Management - CLI
bun memory save                    # Interactive save with learning prompts
bun memory save "quick summary"    # Quick save (still prompts for learnings)
bun memory recall                  # Resume last session
bun memory recall "query"          # Semantic search
bun memory recall "#5"             # Specific learning by ID
bun memory recall "session_123"    # Specific session by ID

# Learning Capture (with structured fields)
bun memory learn <category> "title" ["context"]
bun memory learn <category> "title" --lesson "..." --prevention "..."
bun memory learn insight "Tests document behavior" --lesson "Tests are docs" --prevention "Write tests first"

# Extraction
bun memory distill                 # From last session
bun memory distill session_123     # From specific session
bun memory distill --last 5 --yes  # Batch with auto-accept

# Utilities
bun memory list sessions           # List recent sessions (table view)
bun memory list learnings          # List learnings by category
bun memory list -i                 # Interactive browser (arrow keys, Enter to view)
bun memory stats                   # Statistics
bun memory export [path]           # Export to markdown (structured Lesson format)
bun memory context [query]         # Context bundle for new session
bun memory task list               # List pending tasks across sessions
bun memory task <id> <status>      # Update task (done/pending/blocked/in_progress)
```

### Structured Learnings

Each learning can have three structured fields:
- **what_happened**: The situation/context that led to this learning
- **lesson**: What you learned (key insight)
- **prevention**: How to prevent/apply in future

Use `--lesson` and `--prevention` args, or interactive prompts in `distill`/`save`.

### List Command Details

The `list` command supports multiple display modes:

**Table View** (default):
- Dynamic column widths that adapt to terminal size
- Summary column expands to fill available width
- Shows: Created date, Duration, Commits, Session ID, Summary

**Interactive Mode** (`-i` flag):
- Arrow keys to navigate sessions
- Enter to view full session details (summary, tasks, git context)
- **Copy ID** option to copy session ID to clipboard
- Back to return to list, Quit to exit

```bash
# Table view
bun memory list sessions

# Interactive browser with clipboard copy
bun memory list -i

# Learnings grouped by category with confidence badges
bun memory list learnings
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

## Knowledge Lifecycle

The full lifecycle from session to proven knowledge:

```
┌─────────────────────────────────────────────────────────────┐
│                    WORKING SESSION                           │
│              (conversation, code, decisions)                 │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    bun memory save                           │
│   Captures: wins, challenges, learnings, git context         │
│   Creates: Session record + prompted Learnings (medium)      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   bun memory distill                         │
│   Extracts: wins, challenges, learnings from session         │
│   Interactive: review, categorize, add structure             │
│   Creates: Learnings (low confidence)                        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    LEARNINGS TABLE                           │
│   Confidence: low → medium → high → proven                   │
│   Validation: When learning proves useful, validate it       │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   bun memory export                          │
│   Creates: LEARNINGS.md with structured Lesson format        │
└─────────────────────────────────────────────────────────────┘
```

### How Distill Works

1. **Session Contains Raw Context**
   ```json
   {
     "wins": ["JWT refresh tokens work well"],
     "challenges": ["Cookie SameSite issues on Safari"],
     "learnings": ["Always test on Safari early"]
   }
   ```

2. **Distill Extracts Candidates**
   ```
   Found 3 potential learning(s):
   1. ✓ [architecture] JWT refresh tokens work well
   2. ⚠️ [debugging] Cookie SameSite issues on Safari
   3. 💡 [insight] Always test on Safari early
   ```

3. **Interactive Review** (for each candidate)
   - `Y` - Save with suggested category
   - `n` - Skip this one
   - `c` - Change category
   - `s` - Skip all remaining

4. **Add Structure** (optional prompts)
   ```
   What happened? > Safari blocked cookies in iframe
   What did you learn? > SameSite=None requires Secure flag
   How to prevent? > Test cross-origin flows on Safari first
   ```

5. **Saved as Learning**
   ```
   ✅ Saved as learning #135 (confidence: low)
   ```

6. **Validate When Useful**
   ```bash
   bun memory validate_learning 135
   # confidence: low → medium → high → proven
   ```

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
  full_context JSON,      -- Rich context (see FullContext below)
  duration_mins INTEGER,
  commits_count INTEGER,
  tags JSON,
  agent_id INTEGER,       -- For per-agent isolation
  visibility TEXT,        -- private, shared, public
  created_at TEXT
)

-- FullContext JSON structure:
{
  -- Session outcomes
  "wins": [],             -- What worked well
  "issues": [],           -- Problems encountered
  "key_decisions": [],    -- Decisions made
  "challenges": [],       -- Difficulties faced
  "next_steps": [],       -- What to do next

  -- Ideas and learnings
  "learnings": [],
  "future_ideas": [],
  "blockers_resolved": [],

  -- Git context (auto-captured)
  "git_branch": "main",
  "git_commits": ["abc123 Commit message", ...],
  "files_changed": ["src/file.ts", ...],
  "diff_summary": "5 files changed, 100 insertions(+), 20 deletions(-)"
}

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

### Auto-Capture Features

When saving a session, the system automatically captures:

| Feature | What's Captured |
|---------|-----------------|
| Git branch | Current branch name |
| Git commits | Last 10 commits with messages |
| Files changed | Files modified in recent commits |
| Diff summary | Insertions/deletions summary |

This context is:
- Indexed in ChromaDB for semantic search (e.g., search "statusline" to find sessions that modified statusline files)
- Displayed in recall output for quick context

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

## Auto-Completion Detection

When resuming a session with `/memory-recall`, the system automatically detects tasks that were likely completed by analyzing git commits since the session was created.

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  1. On /memory-recall, get session's pending tasks          │
│  2. Get git commits since session.created_at                │
│  3. For each pending task:                                  │
│     ├─ Extract keywords from task description               │
│     ├─ Search commit messages for keyword matches           │
│     ├─ Calculate confidence score based on match quality    │
│  4. If confidence > 60%:                                    │
│     └─ Show as "LIKELY COMPLETED" with evidence             │
└─────────────────────────────────────────────────────────────┘
```

### Example Output

```
⚡ LIKELY COMPLETED (detected from git)
────────────────────────────────────────
✓? Add ChromaDB collections for knowledge/lessons [80% confidence]
  └─ 74d69c2 Wire failure analysis into mission flow...
✓? Add tests and verify [80% confidence]
  └─ 74d69c2 Wire failure analysis into mission flow...
```

### Confirming Completions

```bash
bun memory task <id> done    # Confirm a detected completion
```

---

## Future Considerations

1. ~~Cross-session learning propagation~~ - **Implemented** via Learning Loop
2. ~~Learning decay~~ - **Implemented** via `decayStaleConfidence()`
3. **Contradiction detection** - Flag conflicting learnings
4. **Team sharing** - Share learnings across team members
5. **Integration with Claude's memory** - Sync with Anthropic's memory features when available
