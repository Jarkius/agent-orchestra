# Startup Protocol (RUN THIS FIRST)

**Every new session MUST check system health before doing anything else.**

## Automatic Startup Check

Run this immediately when starting a new session:

```bash
bun memory status
```

### If status shows errors or "not running":

```bash
# Full initialization (runs setup if needed)
bun memory init
```

### If this is a fresh clone (no agents.db, empty stats):

```bash
# One-time setup
./scripts/setup.sh
```

## Quick Health Indicators

| Check | Healthy | Action if Unhealthy |
|-------|---------|---------------------|
| Hub | ✅ Running | `bun memory init` |
| Daemon | ✅ Connected | `bun memory init` |
| Indexer | ✅ Watching | `bun memory indexer start` |
| Code Index | Has files | `bun memory index once` |

## After Startup

Once healthy, recall context for this session:

```bash
# Get relevant learnings and recent sessions
bun memory context "what I'm working on"

# Or resume last session
bun memory recall
```

## Why This Matters

Without initialization:
- ❌ No semantic search (embeddings not loaded)
- ❌ No cross-matrix messaging (daemon not connected)
- ❌ No code search (index empty)
- ❌ MCP tools may fail silently

**Don't be lazy - check status first!**
