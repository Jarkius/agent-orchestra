# Session Snapshot - FastEmbed & Transformers.js Integration
**Date:** 2026-01-16

## Completed Work

### 1. FastEmbed-JS Integration (Commit: bb76da9)
- Added `fastembed` npm package for local ONNX embeddings
- Replaced hash-based SimpleEmbeddingFunction with real semantic embeddings
- Model: bge-small-en-v1.5 (384 dims, ~33MB)
- Fixed Float32Array → number[] conversion for ChromaDB compatibility

### 2. Transformers.js Provider (Commit: ea8b22d)
- Added `@huggingface/transformers` as alternative embedding provider
- Created modular embedding system: `src/embeddings/`
  - `index.ts` - Factory & config
  - `fastembed-provider.ts` - FastEmbed wrapper
  - `transformers-provider.ts` - Transformers.js wrapper
- Configurable via `EMBEDDING_PROVIDER` env var
- Both providers achieve 100% semantic accuracy

### 3. Default Provider Switch (Commit: 8889828)
- Switched default from fastembed to transformers
- Reason: 28x faster queries (2ms vs 70ms after warmup)

### 4. ChromaDB Health Check & Auto-Start (Commit: 7557c1b)
- `checkChromaHealth()` - Ping server with timeout
- `ensureChromaRunning()` - Auto-start if not running
- `getHealthStatus()` - Full health report
- `health_check` MCP tool
- MCP server now auto-initializes everything on startup

## Git Log (4 commits)
```
7557c1b Add ChromaDB health check and auto-start on MCP init
8889828 Switch default embedding provider to Transformers.js
ea8b22d Add configurable embedding providers with Transformers.js support
bb76da9 Add Claude Sub-Agent Orchestration System with FastEmbed semantic search
```

## Key Files
| File | Purpose |
|------|---------|
| `src/vector-db.ts` | ChromaDB integration + health checks |
| `src/embeddings/index.ts` | Embedding provider factory |
| `src/embeddings/fastembed-provider.ts` | FastEmbed wrapper |
| `src/embeddings/transformers-provider.ts` | Transformers.js wrapper |
| `src/mcp/server.ts` | MCP server with auto-init |
| `src/mcp/tools/handlers/vector.ts` | Vector search + health_check tools |

## Configuration (.env)
```bash
EMBEDDING_PROVIDER=transformers  # default (or "fastembed")
EMBEDDING_MODEL=bge-small-en-v1.5
CHROMA_URL=http://localhost:8000
SKIP_VECTORDB=true  # to disable auto-init
```

## Test Commands
```bash
bun run test:fastembed      # Test FastEmbed
bun run test:transformers   # Test Transformers.js
bun run test:compare        # Compare both
bun run test:semantic       # ChromaDB integration
```

## Performance Comparison
| Provider | Init | Query | Accuracy |
|----------|------|-------|----------|
| FastEmbed | 280ms | 70ms | 100% |
| Transformers.js | 200ms* | 2ms | 100% |

*After model cached

## To Resume
1. Read this file: `SESSION_SNAPSHOT.md`
2. Check git log: `git log --oneline -5`
3. Install ChromaDB if needed: `pip install chromadb`
4. Start ChromaDB: `chroma run --path ./chroma_data`
5. Run tests: `bun run test:compare`

## Next Steps (TODO)
- [ ] Install ChromaDB CLI: `pip install chromadb`
- [ ] Test full agent workflow with semantic search
- [ ] Add nomic-embed-text-v1.5 model support
- [ ] Performance tuning for production
