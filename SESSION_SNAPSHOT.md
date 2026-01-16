# Session Snapshot - Claude Sub-Agent Orchestration System
**Date:** 2026-01-16

## Current State

### Stack
- **Runtime**: Bun/TypeScript
- **Embeddings**: Transformers.js (bge-small-en-v1.5, nomic, minilm)
- **Vector DB**: ChromaDB via Docker on port 8100 (auto-restart enabled)
- **Database**: SQLite (agents.db)

### Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    YOU (Orchestrator)                        │
│                    Claude Code (Max plan)                    │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Tools
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               MCP Server (src/mcp-server.ts)                 │
│  Vector Search | Task Assignment | Session Persistence       │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────────┐
    │ ChromaDB │   │ SQLite   │   │ Agent Pool   │
    │ :8100    │   │ agents.db│   │ claude CLI   │
    └──────────┘   └──────────┘   └──────────────┘
```

## Git Log (8 commits)
```
ac809aa Add Docker auto-start and session persistence MCP tools
6f5ed90 Update session snapshot with simplified stack
6c4db8f Simplify stack: remove FastEmbed, use Docker ChromaDB on port 8100
9b04eba Add session snapshot for context continuity
7557c1b Add ChromaDB health check and auto-start on MCP init
8889828 Switch default embedding provider to Transformers.js
ea8b22d Add configurable embedding providers with Transformers.js support
bb76da9 Add Claude Sub-Agent Orchestration System with FastEmbed semantic search
```

## MCP Tools

### Session Persistence (NEW)
| Tool | Purpose |
|------|---------|
| `save_session` | Save session summary with tags for later recall |
| `recall_session` | Semantic search past sessions |
| `list_sessions` | List recent saved sessions |

### Vector Search
| Tool | Purpose |
|------|---------|
| `search_similar_tasks` | Find similar past tasks |
| `search_similar_results` | Find similar results |
| `get_related_memory` | Combined memory search |
| `health_check` | Check ChromaDB status |

### Task Management
| Tool | Purpose |
|------|---------|
| `assign_task` | Send task to specific agent |
| `broadcast_task` | Send to all agents |
| `get_task_result` | Get completed result |
| `get_agents` | List agents with status |

## Key Files
| File | Purpose |
|------|---------|
| `src/vector-db.ts` | ChromaDB + Docker auto-start |
| `src/embeddings/index.ts` | Embedding factory (Transformers.js) |
| `src/mcp/tools/handlers/session.ts` | Session persistence tools |
| `src/mcp/tools/handlers/vector.ts` | Vector search tools |
| `src/mcp/server.ts` | MCP server with auto-init |

## ChromaDB Collections (6)
| Collection | Purpose |
|------------|---------|
| `task_prompts` | What agents were asked |
| `task_results` | What agents produced |
| `messages_inbound` | Orchestrator → Agent |
| `messages_outbound` | Agent → Orchestrator |
| `shared_context` | Agent shared context |
| `orchestrator_sessions` | Session snapshots |

## Configuration (.env)
```bash
EMBEDDING_MODEL=bge-small-en-v1.5  # or nomic-embed-text-v1.5
CHROMA_URL=http://localhost:8100
CHROMA_PORT=8100
CHROMA_CONTAINER=chromadb
```

## Commands
```bash
# ChromaDB auto-starts, but manual control:
docker start chromadb
docker stop chromadb

# Test embeddings
bun run test:transformers
bun run scripts/test-embeddings.ts nomic

# Test semantic search
bun run test:semantic
```

## To Resume
1. Read this file: `cat SESSION_SNAPSHOT.md`
2. Docker auto-starts ChromaDB (restart policy: unless-stopped)
3. Check health: `curl http://localhost:8100/api/v2/heartbeat`
4. Use MCP tools: `save_session`, `recall_session`

## Session Workflow
```bash
# Before /clear - save context
save_session("Simplified stack, removed FastEmbed, Docker on 8100", tags=["embeddings", "docker"])

# In new session - recall context
recall_session("embedding provider changes")
list_sessions()
```

## This Session Summary
- Removed FastEmbed (Transformers.js is 25x faster)
- Changed ChromaDB port 8000 → 8100
- Switched to Docker for ChromaDB (auto-restart enabled)
- Added session persistence MCP tools
- All 6 collections initialized
