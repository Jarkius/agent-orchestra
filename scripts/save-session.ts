#!/usr/bin/env bun
/**
 * Save session context to vector database
 * Use this to snapshot progress before clearing context
 */

import { initVectorDB, embedContext, checkChromaHealth, ensureChromaRunning } from "../src/vector-db";

const SESSION_CONTEXT = `
# Session Summary - FastEmbed & Transformers.js Integration (2026-01-16)

## Completed Work

### 1. FastEmbed-JS Integration (Commit: bb76da9)
- Added \`fastembed\` npm package for local ONNX embeddings
- Replaced hash-based SimpleEmbeddingFunction with real semantic embeddings
- Model: bge-small-en-v1.5 (384 dims, ~33MB)
- Fixed Float32Array → number[] conversion for ChromaDB compatibility

### 2. Transformers.js Provider (Commit: ea8b22d)
- Added \`@huggingface/transformers\` as alternative embedding provider
- Created modular embedding system: src/embeddings/
  - index.ts - Factory & config
  - fastembed-provider.ts - FastEmbed wrapper
  - transformers-provider.ts - Transformers.js wrapper
- Configurable via EMBEDDING_PROVIDER env var
- Both providers achieve 100% semantic accuracy

### 3. Default Provider Switch (Commit: 8889828)
- Switched default from fastembed to transformers
- Reason: 28x faster queries (2ms vs 70ms after warmup)

### 4. ChromaDB Health Check & Auto-Start (Commit: 7557c1b)
- checkChromaHealth() - Ping server with timeout
- ensureChromaRunning() - Auto-start if not running
- getHealthStatus() - Full health report
- health_check MCP tool
- MCP server now auto-initializes everything on startup

## Key Files Modified
- src/vector-db.ts - Main vector DB module with health checks
- src/embeddings/* - Embedding provider modules
- src/mcp/server.ts - Auto-init on startup
- src/mcp/tools/handlers/vector.ts - Health check tool
- package.json - Added dependencies and scripts
- .env.example - Configuration template
- README.md - Documentation

## Configuration
\`\`\`bash
EMBEDDING_PROVIDER=transformers  # or fastembed
EMBEDDING_MODEL=bge-small-en-v1.5
CHROMA_URL=http://localhost:8000
SKIP_VECTORDB=true  # to disable auto-init
\`\`\`

## Test Commands
\`\`\`bash
bun run test:fastembed
bun run test:transformers
bun run test:compare
bun run test:semantic
\`\`\`

## Performance Results
| Provider | Init | Query | Accuracy |
|----------|------|-------|----------|
| FastEmbed | 280ms | 70ms | 100% |
| Transformers.js | 200ms* | 2ms | 100% |
*cached model

## Git Log
- 7557c1b Add ChromaDB health check and auto-start on MCP init
- 8889828 Switch default embedding provider to Transformers.js
- ea8b22d Add configurable embedding providers with Transformers.js support
- bb76da9 Add Claude Sub-Agent Orchestration System with FastEmbed semantic search

## Next Steps (TODO)
- Test full agent workflow with semantic search
- Add more embedding models (nomic-embed-text-v1.5)
- Consider adding embedding dimension reduction (Matryoshka)
- Performance tuning for production
`;

async function main() {
  console.log("Saving session context to vector database...\n");

  // Ensure ChromaDB is running
  const healthy = await checkChromaHealth();
  if (!healthy) {
    console.log("Starting ChromaDB...");
    await ensureChromaRunning();
  }

  // Initialize vector DB
  await initVectorDB();

  // Save session context
  const sessionId = `session_${Date.now()}`;
  await embedContext(sessionId, SESSION_CONTEXT, {
    updated_by: "claude-session",
    created_at: new Date().toISOString(),
  });

  console.log(`✓ Session saved with ID: ${sessionId}`);
  console.log("\nTo retrieve later, search for:");
  console.log('  - "FastEmbed Transformers.js integration"');
  console.log('  - "embedding provider session"');
  console.log('  - "ChromaDB health check auto-start"');
}

main().catch(console.error);
