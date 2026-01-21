# Session Snapshot - Claude Sub-Agent Orchestration System
**Date:** 2026-01-16 (Updated)

## Current State

### Stack
- **Runtime**: Bun/TypeScript
- **Embeddings**: Transformers.js (nomic-embed-text-v1.5, 768 dims, 8192 context) - ~5ms queries
- **Vector DB**: ChromaDB via Docker on port 8100 (auto-restart)
- **Database**: SQLite (agents.db) - 3,500+ ops/sec

### Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    YOU (Orchestrator)                        │
│                    Claude Code (Max plan)                    │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Tools (27)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               MCP Server (src/mcp-server.ts)                 │
│  Agent Tools | Memory Tools | Vector Tools | Analytics       │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────────┐
    │ ChromaDB │   │ SQLite   │   │ Agent Pool   │
    │ :8100    │   │ agents.db│   │ tmux panes   │
    └──────────┘   └──────────┘   └──────────────┘
```

## Memory Commands (Slash-style)
```bash
bun memory save           # Save session before /clear
bun memory recall "query" # Semantic search
bun memory export         # Generate LEARNINGS.md
bun memory stats          # Show statistics
bun memory list sessions  # List sessions
bun memory context        # Context bundle for new session
```

## MCP Tools

### Session Memory
| Tool | Purpose |
|------|---------|
| `save_session` | Save with auto-linking |
| `recall_session` | Semantic search |
| `get_session` | Full details + links |
| `list_sessions` | List with filters |
| `link_sessions` | Create relationship |

### Learnings
| Tool | Purpose |
|------|---------|
| `add_learning` | Add with auto-linking |
| `recall_learnings` | Semantic search |
| `get_learning` | Full details + links |
| `list_learnings` | List with filters |
| `validate_learning` | Increase confidence |
| `link_learnings` | Create relationship |

### Analytics
| Tool | Purpose |
|------|---------|
| `get_session_stats` | Statistics |
| `get_improvement_report` | Learning metrics |
| `get_context_bundle` | Context for new session |
| `export_learnings` | Generate LEARNINGS.md |

### Agent Orchestration
| Tool | Purpose |
|------|---------|
| `assign_task` | Send task to specific agent |
| `broadcast_task` | Send to all agents |
| `get_task_result` | Get completed result |
| `get_agents` | List agents with status |

## Key Files
| File | Purpose |
|------|---------|
| `src/vector-db.ts` | ChromaDB + auto-linking |
| `src/db.ts` | SQLite (sessions, learnings, links) |
| `src/mcp/tools/handlers/session.ts` | Session tools |
| `src/mcp/tools/handlers/learning.ts` | Learning tools |
| `src/mcp/tools/handlers/analytics.ts` | Stats/export |
| `scripts/memory/` | CLI commands |
| `LEARNINGS.md` | Auto-generated |

## Performance Benchmarks
| Operation | Latency | Notes |
|-----------|---------|-------|
| Embedding (short) | ~3ms | After warmup |
| Embedding (long) | ~20ms | 150 words |
| ChromaDB query | ~6ms | Semantic search |
| SQLite insert | 0.28ms | 3,500 ops/sec |
| SQLite query | 0.04ms | 24,000 ops/sec |

Run: `bun run scripts/test-integration.ts`

## ChromaDB Collections (7)
| Collection | Purpose |
|------------|---------|
| `task_prompts` | Agent task prompts |
| `task_results` | Agent results |
| `messages_inbound` | Orchestrator → Agent |
| `messages_outbound` | Agent → Orchestrator |
| `shared_context` | Agent shared context |
| `orchestrator_sessions` | Session memory |
| `orchestrator_learnings` | Learning memory |

## Commands
```bash
# Memory CLI
bun memory save
bun memory recall "query"
bun memory export

# ChromaDB
docker start chromadb
curl http://localhost:8100/api/v2/heartbeat

# Tests
bun run scripts/test-integration.ts
bun run test:semantic
```

## To Resume
1. `bun memory context` - Get context bundle
2. `bun memory recall "topic"` - Search relevant sessions
3. `bun memory stats` - Check current state

## Integration Gaps (Future Work)
1. **Inject learnings into agent prompts** - Agents could benefit from proven learnings
2. **Auto-save agent sessions** - Track agent work as mini-sessions
3. **Link agent tasks to sessions** - Enable "what did agents do?" queries
4. **Context propagation** - Share session context with agents

## This Session Summary
- Built enhanced memory system with SQLite + ChromaDB sync
- Added learning.ts and analytics.ts MCP handlers (16 new tools)
- Created memory CLI scripts (slash-command style)
- Performance tested: embedding 3ms, query 6ms, SQLite 3,500 ops/sec
- Analyzed agent integration gaps and created roadmap
- Updated all documentation (CLAUDE.md, README.md, SESSION_SNAPSHOT.md)
