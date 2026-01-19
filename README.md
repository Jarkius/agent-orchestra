# Agent Orchestra

Expert Multi-Agent Orchestration System for spawning and coordinating real Claude CLI agents with PTY management, git worktree isolation, and MCP tools.

[![Bun](https://img.shields.io/badge/Bun-1.0+-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

## Features

- **PTY Management** - Spawn agents in tmux panes with health checks and auto-restart
- **Git Worktree Isolation** - Each agent works in its own branch, no file conflicts
- **Role-Based Agents** - Specialized roles: coder, tester, analyst, oracle, debugger, etc.
- **Model Tier Selection** - Automatic model selection (haiku/sonnet/opus) based on task complexity
- **Mission Queue** - Priority-based task queue with retry logic and dependencies
- **MCP Integration** - 31 consolidated tools for orchestration, memory, and analytics
- **Session Memory** - Persistent context across sessions with semantic search
- **Learning Loop** - Closed-loop learning with auto-distill, confidence tracking, and knowledge harvesting
- **Dual-Collection Pattern** - Separate knowledge (facts) and lessons (problem→solution→outcome) stores

## Prerequisites

- **Bun** 1.0+ ([install](https://bun.sh))
- **Docker** (for ChromaDB vector database)
- **tmux** (for agent PTY management)

## Quick Start

```bash
# Install dependencies
bun install

# Start ChromaDB (persisted, auto-restarts)
docker run -d --name chromadb --restart unless-stopped \
  -p 8100:8000 -v $(pwd)/chroma_data:/data \
  chromadb/chroma

# Spawn 3 agents with worktree isolation
bun run spawn --count 3 --isolation worktree

# Or use the shell script
./scripts/spawn/spawn_claude_agents.sh 3
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator (You)                        │
│                    Claude Code / CLI                         │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Tools
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     MCP Server                               │
│  PTY Tools | Worktree Tools | Memory Tools | Analytics       │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────────┐  ┌──────────────┐
    │ ChromaDB │   │   SQLite     │  │ Agent Pool   │
    │ (Vector) │   │ (Metadata)   │  │ (tmux panes) │
    └──────────┘   └──────────────┘  └──────────────┘
                                            │
                          ┌─────────────────┼─────────────────┐
                          ▼                 ▼                 ▼
                    ┌──────────┐      ┌──────────┐      ┌──────────┐
                    │ Agent 1  │      │ Agent 2  │      │ Agent 3  │
                    │ coder    │      │ tester   │      │ oracle   │
                    │ worktree │      │ worktree │      │ worktree │
                    └──────────┘      └──────────┘      └──────────┘
```

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

```typescript
// Spawn agent with worktree isolation
await spawner.spawnAgent({
  role: 'coder',
  model: 'sonnet',
  isolationMode: 'worktree',
});
```

## MCP Tools

Tools are consolidated with `action` parameters for efficiency.

### Orchestration

| Tool | Actions | Description |
|------|---------|-------------|
| `agent` | spawn, spawn_pool, kill, restart, health, health_all, status | Agent lifecycle management |
| `mission` | distribute, complete, fail, status | Mission queue operations |
| `worktree` | provision, merge, sync, cleanup, status, list | Git worktree isolation |

### Memory & Search

| Tool | Description |
|------|-------------|
| `save_session` | Save session with context |
| `recall_session` | Search past sessions |
| `add_learning` | Capture a learning |
| `recall_learnings` | Search learnings |
| `search` | Semantic search (tasks, results, messages, memory) |
| `stats` | System stats (session, improvement, vector, dashboard) |
| `get_context_bundle` | Get context for new session |
| `export_learnings` | Export to markdown |

## Memory Commands

```bash
# Save session
bun memory save "what was accomplished"
bun memory save                 # full interactive save with prompts

# Recall/search (with auto-completion detection)
bun memory recall               # resume last session + detect completed tasks
bun memory recall "query"       # semantic search
bun memory recall "#5"          # recall learning by ID

# Learnings
bun memory learn insight "Title" --lesson "Key insight"
bun memory distill              # extract from last session
bun memory distill --last 5     # extract from last 5 sessions
bun memory distill --all        # extract from ALL sessions
bun memory export               # export to LEARNINGS.md

# Tasks
bun memory task list            # list pending tasks across sessions
bun memory task <id> done       # mark task as completed
bun memory task <id> in_progress # update task status

# Knowledge Graph
bun memory graph                # explore entities and relationships
bun memory graph "chromadb"     # find learnings about a topic

# Maintenance
bun memory stats                # statistics
bun memory list sessions        # list sessions
bun memory list learnings       # list learnings
bun memory purge sessions --keep 10      # keep last 10 sessions
bun memory purge learnings --duplicates  # remove duplicates
bun memory reindex              # re-index vectors after changes
```

## Configuration

### Environment Variables

```bash
# .env
CHROMA_URL=http://localhost:8100
CHROMA_PORT=8100
CHROMA_CONTAINER=chromadb
EMBEDDING_PROVIDER=transformers
EMBEDDING_MODEL=bge-small-en-v1.5
```

### MCP Server

Add to Claude Code settings (`~/.claude/settings.json`):

```json
{
  "enableAllProjectMcpServers": true
}
```

## Development

```bash
# Run tests
bun test

# Run PTY tests only
bun test src/pty/tests/

# Type check
bunx tsc --noEmit

# Start MCP server
bun run src/mcp-server.ts
```

## Project Structure

```
agent-orchestra/
├── src/
│   ├── pty/                    # PTY orchestration
│   │   ├── manager.ts          # PTYManager - tmux management
│   │   ├── spawner.ts          # AgentSpawner - role-based spawning
│   │   ├── mission-queue.ts    # MissionQueue - task queue
│   │   ├── worktree-manager.ts # WorktreeManager - git isolation
│   │   └── tests/              # 105 passing tests
│   ├── interfaces/             # TypeScript interfaces
│   ├── mcp/                    # MCP server & tools
│   │   └── tools/handlers/     # Tool implementations
│   ├── services/               # Memory, sessions, etc.
│   └── embeddings/             # Vector embeddings
├── scripts/
│   ├── spawn/                  # Agent spawning scripts
│   └── memory/                 # Memory CLI commands
├── config/                     # Configuration files
│   └── statusline.sh           # Claude statusline config
└── docs/                       # Documentation
```

## Documentation

- [Memory System](docs/memory-system.md) - Session persistence, learnings, and auto-completion detection
- [Learning Loop](docs/learning-loop.md) - Closed-loop learning with knowledge/lessons dual-collection
- [PTY Orchestration](docs/pty-orchestration.md) - Agent spawning and management
- [Worktree Isolation](docs/worktree-isolation.md) - Git worktree integration

## License

MIT
