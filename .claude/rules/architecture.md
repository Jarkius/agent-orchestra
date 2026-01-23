# System Architecture

## Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| MCP Server | `src/mcp/server.ts` | Tool handlers, orchestration entry |
| Database | `src/db.ts` | SQLite (agents, sessions, learnings) |
| Vector DB | `src/vector-db.ts` | ChromaDB semantic search |
| Agent Spawner | `src/pty/spawner.ts` | PTY-based agent lifecycle |
| Mission Queue | `src/pty/mission-queue.ts` | Priority task distribution |
| Oracle | `src/oracle/orchestrator.ts` | Workload analysis, auto-rebalancing |
| Learning Loop | `src/learning/loop.ts` | Knowledge extraction from tasks |
| Distill Engine | `src/learning/distill-engine.ts` | Smart code/doc learning |
| Code Analyzer | `src/learning/code-analyzer.ts` | Deep learning from repos |
| Code Indexer | `src/indexer/code-indexer.ts` | Semantic code search |
| Indexer Daemon | `src/indexer/indexer-daemon.ts` | Auto-update file watcher |
| Matrix Hub | `src/matrix-hub.ts` | Cross-matrix WebSocket server |
| Matrix Daemon | `src/matrix-daemon.ts` | Persistent hub connection |
| Matrix Client | `src/matrix-client.ts` | Client library |

## Data Paths

| Path | Purpose |
|------|---------|
| `agents.db` | SQLite database |
| `./data/agent_inbox/{id}/` | Task queue (persistent) |
| `./data/agent_outbox/{id}/` | Results (persistent) |
| `./data/agent_shared/` | Shared context |
| `~/.matrix-daemon/` | Matrix daemon PID/socket |
| `~/.indexer-daemon/` | Indexer daemon PID file |

**Note:** Agent paths moved from `/tmp/` to `./data/` for persistence across reboots.

## Ports

| Port | Service | Configurable |
|------|---------|--------------|
| 8080 | WebSocket server (agent comm) | `WS_PORT` |
| 8081 | Matrix Hub (cross-matrix) | `MATRIX_HUB_PORT` |
| 37888 | Matrix Daemon HTTP API | `MATRIX_DAEMON_PORT` |
| 37889 | Indexer Daemon HTTP API | `INDEXER_DAEMON_PORT` |

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Server (entry)                      │
└───────────────────────────┬─────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
   ┌──────────┐      ┌───────────┐      ┌───────────┐
   │ Spawner  │      │  Mission  │      │  Learning │
   │   PTY    │◄────►│   Queue   │─────►│   Loop    │
   └────┬─────┘      └─────┬─────┘      └─────┬─────┘
        │                  │                  │
        ▼                  ▼                  ▼
   ┌──────────┐      ┌───────────┐      ┌───────────┐
   │  Agents  │      │   Oracle  │      │ Vector DB │
   │  (tmux)  │◄────►│ Orchestr. │      │ ChromaDB  │
   └──────────┘      └───────────┘      └───────────┘
```

## Agent Communication (3 layers)

1. **WebSocket** (primary) - Real-time task delivery via port 8080
2. **File-based** (fallback) - `./data/agent_inbox/` polling at 1s
3. **Matrix Hub** (cross-matrix) - Port 8081 for multi-project messaging

## When to Use What

| Need | Use | Why |
|------|-----|-----|
| Assign task to sub-agent | MCP `assign_task` | Local orchestration within project |
| Get agent results | MCP `get_task_result` | Results in `./data/agent_outbox/` |
| Share context with agents | MCP `update_shared_context` | Writes to `./data/agent_shared/` |
| Message another project | Matrix `matrix_send` | Cross-project via hub on :8081 |
| Coordinate across machines | Matrix Hub | LAN/remote via `MATRIX_HUB_URL` |

**Rule of thumb:**
- Same project, sub-agents → **MCP tools** (uses `./data/`)
- Different projects/machines → **Matrix Hub** (uses WebSocket :8081)

## Storage

```
SQLite (agents.db)
├── agents          # Agent registry + stats
├── tasks           # Task history + results
├── sessions        # Session recordings
├── learnings       # Knowledge base
├── lessons         # Past solutions
├── events          # Agent lifecycle events
├── messages        # Inbox/outbox logs
└── matrix_registry # Cross-matrix discovery

ChromaDB (vector embeddings)
├── sessions        # Session semantic search
├── learnings       # Learning retrieval
├── lessons         # Similar problem lookup
└── code_index      # Semantic code search
```
