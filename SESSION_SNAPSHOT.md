# Session Snapshot - Claude Sub-Agent Orchestration System
**Date:** 2026-01-16

## Current State

### Stack
- **Runtime**: Bun/TypeScript
- **Embeddings**: Transformers.js (bge-small-en-v1.5, nomic, minilm)
- **Vector DB**: ChromaDB via Docker on port 8100
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
│  Vector Search | Task Assignment | Health Check              │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────────┐
    │ ChromaDB │   │ SQLite   │   │ Agent Pool   │
    │ :8100    │   │ agents.db│   │ claude CLI   │
    └──────────┘   └──────────┘   └──────────────┘
```

## Git Log (6 commits)
```
6c4db8f Simplify stack: remove FastEmbed, use Docker ChromaDB on port 8100
9b04eba Add session snapshot for context continuity
7557c1b Add ChromaDB health check and auto-start on MCP init
8889828 Switch default embedding provider to Transformers.js
ea8b22d Add configurable embedding providers with Transformers.js support
bb76da9 Add Claude Sub-Agent Orchestration System with FastEmbed semantic search
```

## Key Files
| File | Purpose |
|------|---------|
| `src/vector-db.ts` | ChromaDB integration + health checks (port 8100) |
| `src/embeddings/index.ts` | Embedding factory (Transformers.js) |
| `src/embeddings/transformers-provider.ts` | Transformers.js wrapper |
| `src/mcp/server.ts` | MCP server with auto-init |
| `src/mcp/tools/handlers/vector.ts` | Vector search tools |
| `src/db.ts` | SQLite schema for agents |

## Configuration (.env)
```bash
EMBEDDING_MODEL=bge-small-en-v1.5  # or nomic-embed-text-v1.5, all-minilm-l6-v2
CHROMA_URL=http://localhost:8100
CHROMA_PORT=8100
SKIP_VECTORDB=true  # to disable auto-init
```

## Commands
```bash
# Start ChromaDB (Docker)
docker run -d --name chromadb -p 8100:8000 chromadb/chroma

# Test embeddings
bun run test:transformers        # Default model (bge-small)
bun run scripts/test-embeddings.ts nomic   # Nomic model

# Test semantic search (requires ChromaDB running)
bun run test:semantic

# Run MCP server
bun run src/mcp/server.ts
```

## Performance (Transformers.js)
| Model | Init | Query | Dims | Accuracy |
|-------|------|-------|------|----------|
| bge-small-en-v1.5 | 826ms | 2ms | 384 | 100% |
| nomic-embed-text-v1.5 | 5.7s | 4ms | 768 | 100% |

## To Resume
1. Read this file: `SESSION_SNAPSHOT.md`
2. Start ChromaDB: `docker start chromadb` (or run command above)
3. Check health: `curl http://localhost:8100/api/v2/heartbeat`
4. Run tests: `bun run test:semantic`

## Removed (this session)
- FastEmbed provider (slower, more dependencies)
- Python venv requirement (Docker handles ChromaDB)
- Port 8000 (changed to 8100)
