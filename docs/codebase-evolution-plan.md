# Agent Orchestra: Comprehensive Evolution Plan

> **Version:** 5.0 — Final Consolidated Plan  
> **Date:** January 20, 2026  
> **Status:** Ready for Implementation

## ⚠️ Known Issues

| Issue | Status | Root Cause | Resolution |
|-------|--------|------------|------------|
| **ChromaDB Corrupted** | 🔴 Active | Concurrent access from multiple agents | Run ChromaDB as server (port 8100) instead of embedded, or add write locks |
| Python Memory removed | ✅ Done | — | Cleaned from `recall-service.ts` |

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
agent-watcher.ts → Polls /tmp/agent_inbox every 1000ms
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

## ✅ Implementation Phases

### Phase 1: Communication Layer (Week 1) — HIGH PRIORITY

**Goal:** Replace file polling with WebSocket push.

#### 1.1 Add Events to MissionQueue
```typescript
// src/pty/mission-queue.ts
import { EventEmitter } from 'events';

export class MissionQueue extends EventEmitter implements IMissionQueue {
  enqueue(...) {
    // existing...
    this.emit('mission:queued', fullMission);
  }
  complete(...) {
    // existing...
    this.emit('mission:completed', missionId, result);
  }
}
```

#### 1.2 Add HTTP/WS Server to Orchestrator
```typescript
// src/orchestrator.ts
Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/api/agents') return Response.json(getAllAgents());
    if (url.pathname === '/api/missions') return Response.json(queue.getAllMissions());
    if (url.pathname === '/api/oracle/insights') return Response.json(oracle.getEfficiencyInsights());
  },
  websocket: {
    open(ws) { queue.on('mission:*', (e, d) => ws.send(JSON.stringify({ event: e, data: d }))); },
  }
});
```

#### 1.3 Upgrade Agent Watcher
```typescript
// src/agent-watcher.ts
const ws = new WebSocket(`ws://localhost:3000/agents/${AGENT_ID}`);
ws.on('message', async (data) => {
  const task = JSON.parse(data);
  await processTask(task.id);
});
// Keep file polling as fallback for 2 weeks
```

---

### Phase 2: Cleanup & Simplification (Week 1)

**Goal:** Remove complexity, single memory system.

| Task | File |
|------|------|
| Remove Python Memory import | `src/services/recall-service.ts` (line 32) |
| Remove semanticSearch call | `src/services/recall-service.ts` (line 343) |
| Remove hybridContext from RecallResult | `src/services/recall-service.ts` |
| Delete bridge file | `src/services/hybrid-memory-bridge.ts` |
| Archive Python scripts | Move `scripts/python_memory/` to `_archive/` |

---

### Phase 3: Web Dashboard (Week 2)

**Goal:** Visual monitoring and control.

```bash
cd src && npx -y create-vite@latest dashboard --template react-ts
```

| Component | Data Source |
|-----------|-------------|
| `AgentGrid` | `GET /api/agents` + WebSocket |
| `MissionQueue` | WebSocket `mission:*` events |
| `OracleInsights` | `GET /api/oracle/insights` |
| `LearningExplorer` | `GET /api/learnings` |

---

### Phase 4: Telemetry (Week 2-3)

**Goal:** Structured event logging for debugging.

```sql
-- telemetry.db (separate from agents.db)
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  source TEXT,
  event_type TEXT,
  payload TEXT
);
```

---

## 🚀 Future Enhancements (Phase 5+)

### 5.1 Advanced Memory Features
| Feature | Description | When to Add |
|---------|-------------|-------------|
| **Cross-Encoder Re-ranking** | Use a small model to re-score top-K results for relevance | When retrieval quality becomes a problem |
| **Hybrid Search** | Combine keyword (BM25) + semantic search | When you have >1000 documents |
| **Memory Compression** | Summarize old sessions to save tokens | When context window fills up |
| **Forgetting Curve** | Auto-decay unused learnings over time | Already exists (`decayStaleConfidence`) |

### 5.2 Agent Intelligence
| Feature | Description |
|---------|-------------|
| **Self-Critique Loop** | Agent reviews own output before submitting |
| **Tool Learning** | Agent learns which MCP tools work best for which tasks |
| **Collaborative Memory** | Agents share learnings automatically via `visibility: shared` |
| **Task Decomposition** | OracleOrchestrator auto-splits complex tasks into subtasks |

### 5.3 Observability & DevEx
| Feature | Description |
|---------|-------------|
| **Time-Travel Debugging** | Replay any task execution from telemetry |
| **Cost Tracking** | Track token usage per agent/task for budgeting |
| **Performance Profiling** | Identify slow agents, optimize prompts |
| **Diff Viewer** | See what an agent changed in the codebase |

### 5.4 Multi-Project Support
| Feature | Description |
|---------|-------------|
| **Project Isolation** | Separate ChromaDB collections per project |
| **Context Switching** | Agent can switch projects without restart |
| **Cross-Project Search** | Search learnings across all projects |

### 5.5 External Integrations
| Feature | Description |
|---------|-------------|
| **GitHub Integration** | Auto-create PRs from agent work |
| **Slack/Discord Alerts** | Notify on task completion or failure |
| **CI/CD Hooks** | Trigger agent tasks from pipeline events |
| **Voice Interface** | (from Matrix project patterns) |

---

## � Implementation Checklist

### Week 1
- [ ] **FIX: ChromaDB concurrent access** — Run as server (port 8100) or add write mutex
- [ ] Add EventEmitter to `MissionQueue`
- [ ] Add `Bun.serve` to `orchestrator.ts`
- [ ] Refactor `agent-watcher.ts` (WebSocket + file fallback)
- [x] Remove Python Memory from `recall-service.ts`
- [ ] Delete/archive `hybrid-memory-bridge.ts` and `scripts/python_memory/`

### Week 2
- [ ] Scaffold React dashboard
- [ ] Implement AgentGrid + MissionQueue views
- [ ] Create telemetry middleware

### Week 3
- [ ] Implement OracleInsights + LearningExplorer
- [ ] Deprecate ANSI console dashboard
- [ ] Write integration tests

---

## 📁 Files to Modify

| File | Action |
|------|--------|
| `src/pty/mission-queue.ts` | Add EventEmitter |
| `src/orchestrator.ts` | Add Bun.serve HTTP/WS |
| `src/agent-watcher.ts` | WebSocket client |
| `src/services/recall-service.ts` | Remove Python imports |
| `src/services/hybrid-memory-bridge.ts` | **DELETE** |
| `scripts/python_memory/` | **ARCHIVE** |
| `src/dashboard/` | **NEW** |

---

**This is the single source of truth for evolution work.**
