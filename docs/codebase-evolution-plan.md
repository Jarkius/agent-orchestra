# Agent Orchestra: Comprehensive Evolution Plan

> **Version:** 6.0 — Post-WebSocket Implementation
> **Date:** January 20, 2026
> **Status:** Core Infrastructure Complete

## ✅ Completed Items

| Item | Status | Commit/PR |
|------|--------|-----------|
| **ChromaDB Corruption Fix** | ✅ Done | Write queue + circuit breaker (c54e4b5) |
| **WebSocket Server (Phase 1)** | ✅ Done | `src/ws-server.ts` |
| **Replace Polling (Phase 2)** | ✅ Done | `src/mcp/tools/handlers/task.ts` |
| **Cross-Matrix Hub (Phase 3)** | ✅ Done | `src/matrix-hub.ts`, `src/matrix-client.ts` |
| **Python Memory Removal** | ✅ Done | Deleted `hybrid-memory-bridge.ts`, cleaned `recall-service.ts` |

## ⚠️ Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| None critical | — | System stable |

---

## 🔬 Deep Codebase Analysis

### Existing Architecture (53 TypeScript files, ~10,000+ lines)

| Module | Lines | Capability |
|--------|-------|------------|
| `OracleOrchestrator` | 686 | Workload analysis, bottleneck detection, auto-rebalancing |
| `LearningLoop` | 666 | Knowledge harvesting, dual-collection (knowledge/lessons), pattern detection |
| `MissionQueue` | 371 | Priority queuing with retry, timeout, dependencies |
| `AgentSpawner` | 252 | Role-based spawning, model tier selection (haiku/sonnet/opus) |
| `PTYManager` | 359 | tmux management, health checks, worktree isolation |
| `vector-db.ts` | 1310 | **10 ChromaDB collections** with agent-scoped semantic search |
| `db.ts` | 1994 | 15+ SQLite tables with `agent_id` isolation |

### 💡 Key Insight: The Real Bottleneck

The orchestration logic is **already sophisticated**. The constraint is:

```
agent-watcher.ts → Polls ./data/agent_inbox every 1000ms
orchestrator.ts  → ANSI console only, no API
```

**File-based IPC is the problem**, not the memory or ML systems.

### 🧹 Decision: Remove Python Memory Layer

After analysis, we're **removing** `scripts/python_memory/` and `hybrid-memory-bridge.ts`:

| Reason | Detail |
|--------|--------|
| Duplicate effort | `vector-db.ts` already has 10 collections covering all use cases |
| 800ms latency | Python subprocess spawn penalty per query |
| Two ChromaDB instances | Confusing to manage port 8100 + local |
| Marginal GPU benefit | Corpus is small (~50 docs), CPU is fast enough |

**Action:** Remove Python Memory integration from `recall-service.ts` (line 32, 343).

---

## ✅ Completed Phases

### Phase 1: Communication Layer ✅

**Implemented:** WebSocket server for real-time task delivery

| Component | File | Status |
|-----------|------|--------|
| WebSocket Server | `src/ws-server.ts` | ✅ |
| Task Handler Integration | `src/mcp/tools/handlers/task.ts` | ✅ |

### Phase 2: Cleanup & Simplification ✅

| Task | Status |
|------|--------|
| Remove Python Memory import | ✅ Removed from `recall-service.ts` |
| Delete `hybrid-memory-bridge.ts` | ✅ Deleted |
| Archive Python scripts | ✅ `scripts/python_memory/` removed |

### Phase 3: Cross-Matrix Communication ✅

**Implemented:** WebSocket hub for multi-instance communication

| Component | File | Status |
|-----------|------|--------|
| Matrix Hub Server | `src/matrix-hub.ts` | ✅ |
| Matrix Client | `src/matrix-client.ts` | ✅ |
| Hub Launcher | `scripts/start-hub.sh` | ✅ |
| Message Integration | `scripts/memory/message.ts` | ✅ |
| MCP Integration | `src/mcp/server.ts` | ✅ |

---

## 🔜 Remaining Phases

### Phase 4: Web Dashboard (Future)

**Goal:** Visual monitoring and control.

| Component | Data Source |
|-----------|-------------|
| `AgentGrid` | `GET /api/agents` + WebSocket |
| `MissionQueue` | WebSocket `mission:*` events |
| `OracleInsights` | `GET /api/oracle/insights` |
| `LearningExplorer` | `GET /api/learnings` |

**GitHub Issue:** #13

---

### Phase 5: Telemetry (Future)

**Goal:** Structured event logging for debugging.

**GitHub Issue:** #14

---

## 🚀 Future Enhancements (Phase 6+)

### 6.1 Advanced Memory Features
| Feature | Description | When to Add |
|---------|-------------|-------------|
| **Cross-Encoder Re-ranking** | Use a small model to re-score top-K results for relevance | When retrieval quality becomes a problem |
| **Hybrid Search** | Combine keyword (BM25) + semantic search | When you have >1000 documents |
| **Memory Compression** | Summarize old sessions to save tokens | When context window fills up |
| **Forgetting Curve** | Auto-decay unused learnings over time | Already exists (`decayStaleConfidence`) |

### 6.2 Agent Intelligence
| Feature | Description |
|---------|-------------|
| **Self-Critique Loop** | Agent reviews own output before submitting |
| **Tool Learning** | Agent learns which MCP tools work best for which tasks |
| **Collaborative Memory** | Agents share learnings automatically via `visibility: shared` |
| **Task Decomposition** | OracleOrchestrator auto-splits complex tasks into subtasks |

### 6.3 Observability & DevEx
| Feature | Description |
|---------|-------------|
| **Time-Travel Debugging** | Replay any task execution from telemetry |
| **Cost Tracking** | Track token usage per agent/task for budgeting |
| **Performance Profiling** | Identify slow agents, optimize prompts |
| **Diff Viewer** | See what an agent changed in the codebase |

### 6.4 Multi-Project Support
| Feature | Description |
|---------|-------------|
| **Project Isolation** | Separate ChromaDB collections per project |
| **Context Switching** | Agent can switch projects without restart |
| **Cross-Project Search** | Search learnings across all projects |

### 6.5 External Integrations
| Feature | Description |
|---------|-------------|
| **GitHub Integration** | Auto-create PRs from agent work |
| **Slack/Discord Alerts** | Notify on task completion or failure |
| **CI/CD Hooks** | Trigger agent tasks from pipeline events |
| **Voice Interface** | (from Matrix project patterns) |

---

## Implementation Checklist

### Completed
- [x] **FIX: ChromaDB concurrent access** — Write queue + circuit breaker (c54e4b5)
- [x] WebSocket Server for real-time task delivery
- [x] Cross-Matrix Hub for multi-instance communication
- [x] Remove Python Memory from `recall-service.ts`
- [x] Delete `hybrid-memory-bridge.ts`
- [x] Archive `scripts/python_memory/`

### Recently Completed
- [x] Smart Learn command with auto-detect (ad23ba9)
  - File learning: `bun memory learn ./docs/file.md`
  - URL learning: `bun memory learn https://example.com/article`
  - YouTube learning: `bun memory learn https://youtube.com/watch?v=x`
  - Git learning: `bun memory learn HEAD~3`

### Future Work
- [ ] Scaffold React dashboard (Phase 4, Issue #13)
- [ ] Implement AgentGrid + MissionQueue views
- [ ] Create telemetry middleware (Phase 5, Issue #14)
- [ ] Implement OracleInsights + LearningExplorer

---

## Key Files

| File | Purpose |
|------|---------|
| `src/ws-server.ts` | WebSocket server for agent task delivery |
| `src/matrix-hub.ts` | Cross-matrix communication hub |
| `src/matrix-client.ts` | Hub client for matrices |
| `src/vector-db.ts` | ChromaDB semantic search |
| `src/db.ts` | SQLite storage |
| `src/mcp/server.ts` | MCP server entry point |

---

**This is the single source of truth for evolution work.**
