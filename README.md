# Agent Orchestra

**Expert Multi-Agent Orchestration System** - Spawn and coordinate real Claude CLI agents with PTY management, persistent memory, semantic search, and self-evolving knowledge.

[![Bun](https://img.shields.io/badge/Bun-1.0+-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Why Agent Orchestra?

### The Problem

When working with AI agents on complex tasks:

- **Context Loss** - Sessions end, context vanishes. You repeat yourself constantly.
- **No Learning** - Same mistakes happen repeatedly. No institutional memory.
- **Single Agent Limits** - One agent can't parallelize. Complex tasks take forever.
- **File Conflicts** - Multiple agents editing same files = chaos.
- **Fragile Infrastructure** - Vector databases corrupt, searches break, work stops.

### The Solution

Agent Orchestra provides:

| Problem | Solution |
|---------|----------|
| Context Loss | **Persistent Memory** - Sessions, learnings, and tasks survive across conversations |
| No Learning | **Self-Evolving Knowledge** - Automatic distillation, validation, and confidence tracking |
| Single Agent | **Multi-Agent Orchestration** - Spawn pools of specialized agents |
| File Conflicts | **Git Worktree Isolation** - Each agent works on its own branch |
| Fragile Infra | **Resilient Architecture** - SQLite source of truth, ChromaDB as rebuildable index |

### Key Benefits

- **10x Faster** - Parallelize work across multiple specialized agents
- **Zero Repetition** - Recall any past session or learning with semantic search
- **Self-Improving** - System learns from every session automatically
- **Crash-Proof** - Corrupted vector index? Rebuild in 30 seconds from SQLite
- **Production Ready** - Retry logic, health checks, auto-restart, graceful degradation

---

## Features

### Multi-Agent Orchestration
- **PTY Management** - Spawn agents in tmux panes with health checks and auto-restart
- **Git Worktree Isolation** - Each agent works in its own branch, no file conflicts
- **Role-Based Agents** - Specialized roles: coder, tester, analyst, oracle, debugger
- **Model Tier Selection** - Auto-select haiku/sonnet/opus based on task complexity
- **Mission Queue** - Priority-based task queue with retry logic and dependencies
- **WebSocket Communication** - Real-time task delivery (no more polling)
- **Matrix Hub** - Cross-instance communication for multi-matrix setups
- **SSE Streaming** - Real-time duplex message visibility via Server-Sent Events
- **Watch Pane** - Dedicated tmux pane for live matrix message feed
- **Cross-Machine Support** - LAN/remote matrix communication via `MATRIX_HUB_HOST`

### Persistent Memory System
- **Session Persistence** - Save/recall sessions with full context
- **Semantic Search** - Find relevant sessions and learnings by meaning, not keywords
- **Task Tracking** - Track pending tasks across sessions with auto-completion detection
- **Knowledge Graph** - Entity extraction and relationship mapping

### Self-Evolving Knowledge
- **Learning Loop** - Automatic distillation from sessions to learnings
- **Confidence Tracking** - Learnings progress: low → medium → high → proven
- **Dual-Collection Pattern** - Separate knowledge (facts) and lessons (problem→solution)
- **Consolidation Engine** - Auto-merge duplicate learnings
- **Context-Aware Retrieval** - Smart retrieval based on task type (debugging/architecture/etc.)

### Resilient Architecture
- **SQLite as Source of Truth** - All data persisted in SQLite, always safe
- **SQLite-First Save Pattern** - Data saves immediately to SQLite, vector ops are secondary
- **ChromaDB as Search Index** - Rebuildable vector index for semantic search
- **Best-Effort Writes** - ChromaDB failures don't crash the system
- **Retry with Backoff** - Automatic retry for transient failures
- **WAL Mode for Concurrency** - Multi-project access without database locks
- **Index Status Tracking** - Know when reindex is needed

---

## Quick Start

### Prerequisites

- **Bun** 1.0+ - [Install Bun](https://bun.sh)
- **Docker** - For ChromaDB vector database
- **tmux** - For agent PTY management (optional, for multi-agent)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/agent-orchestra.git
cd agent-orchestra

# Install dependencies
bun install

# Initialize the system (starts ChromaDB, creates database, indexes)
bun run init
```

### One-Command Setup

```bash
# This script handles everything:
# 1. Checks prerequisites (bun, docker, tmux)
# 2. Installs dependencies
# 3. Starts ChromaDB container
# 4. Initializes SQLite database
# 5. Builds initial vector index
./scripts/setup.sh
```

### Manual Setup

```bash
# 1. Install dependencies
bun install

# 2. Start ChromaDB (persisted, auto-restarts)
docker run -d --name chromadb --restart unless-stopped \
  -p 8100:8000 -v $(pwd)/chroma_data:/data \
  chromadb/chroma

# 3. Wait for ChromaDB to be ready
sleep 5

# 4. Initialize database and build index
bun memory reindex
```

### Verify Installation

```bash
# Check system health
bun memory stats

# Test semantic search
bun memory recall "test query"

# View ChromaDB status
curl http://localhost:8100/api/v2/heartbeat
```

---

## Usage

### Memory Commands (Single Agent)

```bash
# Save session with summary
bun memory save "Implemented feature X with tests"
bun memory save --auto "Auto-capture from Claude Code history"

# Recall sessions
bun memory recall                    # Resume last session
bun memory recall "authentication"   # Semantic search
bun memory recall session_123456     # Exact ID lookup
bun memory recall "#42"              # Recall learning by ID

# Capture learnings - Smart Mode (auto-detect)
bun memory learn ./docs/file.md      # Extract from file
bun memory learn HEAD~3              # Extract from git commits
bun memory learn https://example.com # Extract from URL

# Capture learnings - Traditional Mode
bun memory learn debugging "Fixed null pointer" --lesson "Always check for null"
bun memory distill                   # Extract learnings from last session
bun memory distill --all             # Extract from all sessions

# Task management
bun memory task list                 # List pending tasks
bun memory task 5 done               # Mark task complete

# Knowledge graph
bun memory graph                     # Explore all entities
bun memory graph "chromadb"          # Find related learnings

# Maintenance
bun memory stats                     # View statistics
bun memory reindex                   # Rebuild vector index
bun memory purge sessions --keep 20  # Cleanup old sessions
```

### Multi-Agent Orchestration

```bash
# Spawn 3 agents with worktree isolation (includes watch pane)
./scripts/spawn/spawn_claude_agents.sh 3

# Or programmatically
bun run spawn --count 3 --isolation worktree

# View agents (watch pane shows matrix messages on the right)
tmux attach -t claude-agents-<pid>

# Assign tasks via MCP tools (from Claude Code)
# Use: agent, mission, worktree tools
```

### Matrix Communication (Cross-Instance)

```bash
# Quick setup - starts hub and daemon
bun memory init

# Send messages between matrices
bun memory message "Hello everyone!"           # Broadcast to all
bun memory message --to other-proj "Hey!"      # Direct message
bun memory message --inbox                     # Check inbox

# Watch live message feed
bun memory watch                               # Dedicated watch process
```

**Cross-Machine Setup (LAN):**
```bash
# Machine A (Hub Host) - bind to all interfaces
MATRIX_HUB_HOST=0.0.0.0 bun run src/matrix-hub.ts

# Machine B (Client) - point to hub IP
MATRIX_HUB_URL=ws://192.168.1.100:8081 bun run src/matrix-daemon.ts start
```

### Slash Commands (from Claude Code)

```
/memory-save          # Save current session
/memory-recall        # Resume or search sessions
/memory-learn         # Capture learning (smart auto-detect or manual)
/memory-distill       # Extract learnings from sessions
/memory-validate      # Increase learning confidence
/memory-graph         # Explore knowledge graph
/memory-stats         # View statistics
/matrix-connect       # Start matrix daemon for cross-project messaging
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    You (Orchestrator)                            │
│                    Claude Code / CLI                             │
└─────────────────────────┬───────────────────────────────────────┘
                          │ MCP Tools (31 consolidated)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       MCP Server                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ Agent Tools │ │Memory Tools │ │Worktree Ops │ │ Analytics │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│                         │                                        │
│  ┌──────────────────────┴──────────────────────┐                │
│  │            Data Layer                        │                │
│  │  ┌────────────────┐  ┌────────────────────┐ │                │
│  │  │    SQLite      │  │     ChromaDB       │ │                │
│  │  │ (Source of     │  │  (Search Index)    │ │                │
│  │  │   Truth)       │◄─┤  - Rebuildable     │ │                │
│  │  │ - Sessions     │  │  - Best-effort     │ │                │
│  │  │ - Learnings    │  │  - Retry logic     │ │                │
│  │  │ - Knowledge    │  │                    │ │                │
│  │  │ - Lessons      │  │                    │ │                │
│  │  └────────────────┘  └────────────────────┘ │                │
│  └─────────────────────────────────────────────┘                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Agent Pool (tmux panes)                      │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │   │
│  │  │ Agent 1  │  │ Agent 2  │  │ Agent 3  │  │ Agent N  │  │   │
│  │  │ coder    │  │ tester   │  │ oracle   │  │ ...      │  │   │
│  │  │ worktree │  │ worktree │  │ worktree │  │ worktree │  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow: Learning Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                    LEARNING LOOP PIPELINE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. SESSION SAVE                                                │
│     └─► SQLite sessions + ChromaDB index                        │
│                          ↓                                      │
│  2. DISTILL (extract learnings)                                 │
│     └─► wins → learning (medium confidence)                     │
│     └─► challenges → learning (low, debugging)                  │
│     └─► insights → learning (medium)                            │
│                          ↓                                      │
│  3. CONSOLIDATE (merge duplicates)                              │
│     └─► Find similar (>85% similarity)                          │
│     └─► Merge: keep highest confidence, sum validations         │
│                          ↓                                      │
│  4. VALIDATE (increase confidence)                              │
│     └─► low → medium → high → proven                            │
│     └─► Auto-validate frequently-used learnings                 │
│                          ↓                                      │
│  5. RETRIEVE (context-aware)                                    │
│     └─► Detect task type (debugging/architecture/impl)          │
│     └─► Boost relevant categories                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Resilient ChromaDB System

The vector database is designed for resilience:

### Architecture

```
┌─────────────────────────────────────────┐
│       SQLite (Source of Truth)          │
│  - All writes go here FIRST             │
│  - Data is ALWAYS safe                  │
│  - WAL mode for concurrent access       │
│  - busy_timeout prevents lock errors    │
├─────────────────────────────────────────┤
│    ChromaDB (Disposable Search Index)   │
│  - Best-effort writes with retry        │
│  - Failures → continue without crash    │
│  - Corruption → rebuild from SQLite     │
│  - Embedding init doesn't block saves   │
└─────────────────────────────────────────┘
```

### Features

| Feature | Description |
|---------|-------------|
| **SQLite-First Save** | Data saves to SQLite immediately, vector ops are async/optional |
| **WAL Mode** | Multi-project concurrent access without database locks |
| **Retry with Backoff** | 3 retries with 100ms → 200ms → 400ms delays |
| **Best-Effort Writes** | Failures don't crash - just mark index stale |
| **Staleness Tracking** | Know when reindex is needed |
| **Batch Rebuild** | Rebuild 500+ items in ~30 seconds |

### Recovery Commands

```bash
# If ChromaDB becomes corrupted:
docker stop chromadb
rm -rf chroma_data/*
docker start chromadb
bun memory reindex

# Check index status
bun -e "console.log(require('./src/vector-db').getIndexStatus())"
```

### Programmatic Rebuild

```typescript
import { rebuildFromSqlite, getIndexStatus } from './src/vector-db';

// Check if rebuild needed
const status = getIndexStatus();
if (status.stale) {
  await rebuildFromSqlite({
    collections: ['sessions', 'learnings'],
    batchSize: 50,
    onProgress: (p) => console.log(`Indexed: ${p.learnings.indexed}`)
  });
}
```

---

## Agent Roles

| Role | Model | Purpose |
|------|-------|---------|
| `oracle` | opus | Orchestration, synthesis, critical decisions |
| `architect` | opus | System design, architecture |
| `coder` | sonnet | Implementation, coding |
| `analyst` | sonnet | Requirements analysis, problem breakdown |
| `reviewer` | sonnet | Code review, quality assurance |
| `tester` | sonnet | Test creation, edge cases, coverage |
| `debugger` | sonnet | Bug investigation, fixes |
| `researcher` | haiku | Quick information gathering |
| `scribe` | sonnet | Documentation, session notes |
| `generalist` | sonnet | General-purpose tasks |

---

## Git Worktree Isolation

When multiple agents work simultaneously, each gets an isolated git worktree:

```
/workspace/
├── .git/                    (main repo)
├── src/
└── .worktrees/              (agent worktrees)
    ├── agent-1/             (branch: agent-1/work-xxx)
    ├── agent-2/             (branch: agent-2/work-xxx)
    └── agent-3/             (branch: agent-3/work-xxx)
```

**Benefits:**
- No file conflicts during parallel work
- Each agent has its own branch
- Work merges back when tasks complete
- Conflicts handled at merge time (not during work)

---

## MCP Tools

Tools are consolidated with `action` parameters for efficiency.

### Orchestration Tools

| Tool | Actions | Description |
|------|---------|-------------|
| `agent` | spawn, spawn_pool, kill, restart, health, health_all, status | Agent lifecycle |
| `mission` | distribute, complete, fail, status, rebalance | Mission queue |
| `worktree` | provision, merge, sync, cleanup, status, list | Git worktree |

### Memory Tools

| Tool | Description |
|------|-------------|
| `save_session` | Save session with full context |
| `recall_session` | Search past sessions |
| `add_learning` | Capture a learning with structured fields |
| `recall_learnings` | Search learnings by query |
| `consolidate_learnings` | Merge duplicate learnings |
| `search` | Semantic search across all collections |
| `get_context_bundle` | Get relevant context for new session |
| `export_learnings` | Export to LEARNINGS.md |
| `stats` | System statistics |

### Matrix Communication Tools

| Tool | Description |
|------|-------------|
| `get_inbox` | Check cross-matrix messages with hub status |
| `matrix_send` | Send message to other matrices (broadcast or direct) |

---

## Configuration

### Environment Variables

```bash
# .env
CHROMA_URL=http://localhost:8100
CHROMA_PORT=8100
CHROMA_CONTAINER=chromadb

# Embedding model (local, no API costs)
EMBEDDING_PROVIDER=transformers
EMBEDDING_MODEL=bge-small-en-v1.5

# Matrix Communication
MATRIX_HUB_HOST=localhost     # Use 0.0.0.0 for LAN access
MATRIX_HUB_PORT=8081          # Hub WebSocket port
MATRIX_HUB_URL=ws://localhost:8081  # Hub URL for clients
MATRIX_DAEMON_PORT=37888      # Daemon HTTP API port
```

### Claude Code Integration

Add to `~/.claude/settings.json`:

```json
{
  "enableAllProjectMcpServers": true
}
```

### Context Protection Hooks (Optional)

Auto-save before context compaction:

```json
{
  "hooks": {
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "/path/to/pre-compact-autosave.sh"
      }]
    }]
  }
}
```

---

## Project Structure

```
agent-orchestra/
├── src/
│   ├── pty/                    # PTY orchestration
│   │   ├── manager.ts          # PTYManager - tmux management
│   │   ├── spawner.ts          # AgentSpawner - role-based spawning
│   │   ├── mission-queue.ts    # MissionQueue - task queue
│   │   └── worktree-manager.ts # Git worktree isolation
│   ├── learning/               # Learning system
│   │   ├── loop.ts             # Learning loop (harvest, distill)
│   │   ├── consolidation.ts    # Duplicate merging
│   │   ├── content-router.ts   # Route to knowledge/lessons
│   │   └── context-router.ts   # Task-aware retrieval
│   ├── services/               # Core services
│   │   └── recall-service.ts   # Unified recall with smart routing
│   ├── mcp/                    # MCP server & tools
│   │   └── tools/handlers/     # Tool implementations
│   ├── db.ts                   # SQLite operations
│   ├── vector-db.ts            # ChromaDB with resilience
│   ├── ws-server.ts            # WebSocket server for real-time tasks
│   ├── matrix-hub.ts           # Cross-matrix communication hub
│   ├── matrix-daemon.ts        # Persistent hub connection manager
│   ├── matrix-client.ts        # Hub client library
│   ├── matrix-watch.ts         # SSE streaming for real-time messages
│   └── embeddings/             # Vector embeddings
├── scripts/
│   ├── spawn/                  # Agent spawning
│   ├── memory/                 # Memory CLI
│   └── setup.sh                # One-command setup
├── docs/                       # Documentation
└── config/                     # Configuration files
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Memory System](docs/memory-system.md) | Session persistence, learnings, auto-completion |
| [Learning Loop](docs/learning-loop.md) | Closed-loop learning, dual-collection pattern |
| [PTY Orchestration](docs/pty-orchestration.md) | Agent spawning and management |
| [Worktree Isolation](docs/worktree-isolation.md) | Git worktree integration |
| [Session Snapshot](docs/SESSION_SNAPSHOT.md) | Session capture and recovery |

---

## Troubleshooting

### ChromaDB Issues

```bash
# Connection refused
docker ps | grep chromadb  # Check if running
docker start chromadb      # Start if stopped

# Compaction errors (corruption)
docker stop chromadb
rm -rf chroma_data/*
docker start chromadb
bun memory reindex

# Check health
curl http://localhost:8100/api/v2/heartbeat
```

### Memory Search Not Working

```bash
# Rebuild index from SQLite
bun memory reindex

# Check stats
bun memory stats
```

### Agent Spawn Fails

```bash
# Check tmux
tmux list-sessions

# Kill all agent sessions
tmux kill-server

# Check docker
docker ps
```

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- Built with [Claude](https://anthropic.com/claude) by Anthropic
- Vector search powered by [ChromaDB](https://www.trychroma.com/)
- Local embeddings via [Transformers.js](https://huggingface.co/docs/transformers.js)
