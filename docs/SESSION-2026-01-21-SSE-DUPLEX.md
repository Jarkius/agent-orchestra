# Session Summary: SSE Duplex Fix & Memory Upgrades
**Date**: 2026-01-21
**Duration**: ~3 hours
**Session ID**: session_1769013473176

## What Was Accomplished

### 1. SSE Duplex Communication Fix
Fixed bidirectional messaging between matrices (agent-orchestra ↔ test-spawns).

**Bugs Found & Fixed:**
- Message type mismatch: daemon sent `type: 'direct'`, hub expected `type: 'message'`
- Heartbeat race condition: daemon 30s = hub timeout 30s (changed to 15s)
- Ping protocol: daemon used WebSocket ping frames, hub expected JSON `{ type: 'ping' }`
- Missing ping handler: daemon didn't respond to hub pings with pong
- Inbox reading wrong table: `learnings` instead of `matrix_messages`

**Key Fix (matrix-daemon.ts:307-313):**
```typescript
// Hub expects type: 'message' for both direct and broadcast
const payload = type === 'broadcast'
  ? { type: 'message', content, id: messageId }
  : { type: 'message', to, content, id: messageId };
```

### 2. Documentation Updates
- Added `matrix-daemon.ts` and `matrix-watch.ts` to README file structure
- Exported learnings to `docs/LEARNINGS-2026-01-21.md`

### 3. Export Script Improvement
Updated `scripts/memory/export.ts` to auto-add date suffix:
- Default: `docs/LEARNINGS-YYYY-MM-DD.md`
- Custom path: `myfile.md` → `myfile-YYYY-MM-DD.md`

### 4. Memory Performance Upgrades (from test-spawns)
Pulled commit `feafea1` with +376 lines of improvements:

| Feature | Details |
|---------|---------|
| Embedding Model | nomic-embed-text-v1.5 (768 dims) |
| Query Cache | 5 min TTL, 100 entry LRU |
| MMR Reranking | λ=0.7 for result diversity |
| Hybrid Search | 0.36/0.64 vector/keyword weights |
| HNSW Tuning | M=32, ef=200/50 |
| Confidence Decay | For stale learnings |

### 5. Cross-Matrix Collaboration
- Sent embedding model comparison to test-spawns
- Received implemented solution via matrix messaging
- Demonstrates real-time collaborative development between Claude instances

## Key Learnings

1. **Hub Protocol**: All messages use `type: 'message'` with optional `to` field
2. **Heartbeat**: Daemon interval must be shorter than hub timeout
3. **nomic-embed-text-v1.5**: Good alternative to bge models
   - Matryoshka support for dimension flexibility
   - ~500ms init (faster than bge-large)
   - Good for technical/code content
4. **Cross-Matrix Messaging**: Enables parallel development workflows

## Files Changed

| File | Changes |
|------|---------|
| `src/matrix-daemon.ts` | Message type fix, heartbeat, ping handler |
| `scripts/memory/message.ts` | Inbox reads from matrix_messages table |
| `scripts/memory/export.ts` | Auto-add date suffix |
| `README.md` | Added matrix-daemon.ts, matrix-watch.ts |
| `src/vector-db.ts` | nomic-embed-text-v1.5, cache, HNSW |
| `src/services/recall-service.ts` | MMR reranking, hybrid search |

## Commits

- `c447540` - fix: SSE duplex communication between matrices
- `19b5a6a` - docs: Add matrix-daemon and matrix-watch to file structure
- `a73d428` - docs: Export learnings to LEARNINGS-2026-01.md
- `7978b8d` - docs: Rename learnings with full date suffix
- `79609ef` - fix: Auto-add date suffix to learnings export filename
- `feafea1` - feat: Comprehensive memory system performance improvements (pulled)

## Test Results

- test-spawns → agent-orchestra: Messages delivered ✓
- agent-orchestra → test-spawns: Messages delivered ✓
- Hub logs show "delivered" for both directions ✓
- Inbox shows received messages with [NEW] indicator ✓
