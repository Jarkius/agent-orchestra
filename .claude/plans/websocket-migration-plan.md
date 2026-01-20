# WebSocket Migration & Cross-Matrix Communication Plan

> **Date:** 2026-01-20
> **Status:** Ready for Implementation
> **GitHub Issues:** #7, #8, #9, #10, #11

---

## Session Summary

### Completed This Session

| Task | Status | Commit |
|------|--------|--------|
| SQLite-first fix for distill.ts | ✅ | `0e9448d` |
| `/memory-issue` command | ✅ | `6c25dce` |
| Issue `--list` and `--promote` flags | ✅ | `7e4490c` |
| `/memory-message` command (broadcast + direct) | ✅ | `2d76a40` |
| MCP `get_inbox` tool | ✅ | `65601b7` |
| Codebase evolution docs | ✅ | `9954333` |
| Security audit learnings captured | ✅ | #1516, #1517, #1518 |

### Issues Received from Clone

| ID | Severity | Title | GitHub |
|----|----------|-------|--------|
| #1509 | 🟠 high | ChromaDB save hangs | - |
| #1510 | 🔴 critical | ChromaDB corruption | [#7](https://github.com/Jarkius/agent-orchestra/issues/7) |
| #1518 | 🟠 high | File IPC no auth | [#8](https://github.com/Jarkius/agent-orchestra/issues/8) |

---

## Architecture Analysis

### Current State (File-Based IPC)

```
Orchestrator                    Agent
    │                              │
    ├─► writeFile(/tmp/inbox)      │
    │                              │
    │       (1000ms polling)       │
    │                              │
    │   ◄── readdir + readFile ────┤
    │                              │
    │       processTask()          │
    │                              │
    │   ◄── writeFile(/tmp/outbox)─┤
    │                              │
    ├─► readdir (polling)          │
    │                              │
```

**Problems:**
- 1-4 second round-trip latency
- No authentication (any process can inject tasks)
- Race conditions on concurrent access
- CPU waste from constant polling

### Target State (WebSocket)

```
Orchestrator                    Agent
    │                              │
    │ ◄─────── ws.connect() ───────┤
    │                              │
    ├──── ws.send(task) ──────────►│
    │         (<100ms)             │
    │                              │
    │ ◄──── ws.send(result) ───────┤
    │                              │
```

**Benefits:**
- <100ms latency (90%+ improvement)
- Token-based authentication
- Event-driven (no polling)
- Bidirectional (progress updates)

---

## Implementation Phases

### Phase 1: Add WebSocket Server [GitHub #9]

**Goal:** Run WebSocket alongside existing file system

**Files:**
- `src/orchestrator.ts` - Add Bun.serve on port 8080
- `src/agent-watcher.ts` - Add WebSocket client option

**Code Pattern:**
```typescript
// src/orchestrator.ts
Bun.serve({
  port: 8080,
  fetch(req, server) {
    const token = new URL(req.url).searchParams.get('token');
    if (!validateToken(token)) return new Response('Unauthorized', { status: 401 });
    if (server.upgrade(req, { data: { agentId: getAgentFromToken(token) } })) return;
    return new Response('WebSocket only');
  },
  websocket: {
    open(ws) {
      agents.set(ws.data.agentId, ws);
      console.log(`Agent ${ws.data.agentId} connected`);
    },
    message(ws, msg) {
      const result = JSON.parse(msg);
      handleResult(ws.data.agentId, result);
    },
    close(ws) {
      agents.delete(ws.data.agentId);
    },
  },
});
```

**Verification:**
```bash
# Start orchestrator with WS
bun run src/orchestrator.ts

# Test connection
wscat -c ws://localhost:8080?token=test
```

---

### Phase 2: Replace Polling [GitHub #10]

**Goal:** Agents receive tasks via WebSocket push

**Files:**
- `src/pty/mission-queue.ts` - Add EventEmitter
- `src/agent-watcher.ts` - Replace polling loop
- `src/mcp/tools/handlers/task.ts` - Emit on task create

**Migration:**
1. Keep file polling as fallback (2 weeks)
2. Emit events on task creation
3. Agents subscribe to their channel
4. Remove file polling after stable

---

### Phase 3: Cross-Matrix Communication [GitHub #11]

**Goal:** Real-time notifications between matrix instances

**Files:**
- `src/matrix-hub.ts` - NEW: WebSocket hub
- `scripts/memory/message.ts` - Push notifications
- `src/mcp/tools/handlers/context.ts` - Real-time inbox

**Architecture:**
```
Matrix A                  Hub                  Matrix B
    │                      │                      │
    ├── ws.connect() ─────►│◄───── ws.connect() ──┤
    │                      │                      │
    ├── send(msg, to:B) ──►│                      │
    │                      ├──── push(msg) ──────►│
    │                      │                      │
```

---

## New Commands Reference

### /memory-issue
```bash
# Report issue
bun memory issue "Title" -s critical -c chromadb --repro "Steps" --fix "Solution"

# List pending (not on GitHub)
bun memory issue --list

# Promote to GitHub
bun memory issue --promote 1510
```

### /memory-message
```bash
# Broadcast to all matrices
bun memory message "Hello all"

# Direct to specific matrix
bun memory message "Hello" --to /path/to/clone

# Check inbox
bun memory message --inbox
```

### MCP Tools
```bash
# Check inbox via MCP
mcp__agent-orchestrator__get_inbox

# Update shared context
mcp__agent-orchestrator__update_shared_context
```

---

## Learnings Captured

| ID | Category | Title |
|----|----------|-------|
| #1240 | architecture | SQLite-first pattern (4x validated, high confidence) |
| #1511 | architecture | SQLite-first saves require reindex for semantic search |
| #1516 | security | File-based IPC is a security risk |
| #1517 | architecture | Replace file polling with WebSocket |

---

## Communication Channels

| Channel | Behavior | Use For |
|---------|----------|---------|
| `shared_context` | Overwrite | Mission briefs |
| `[broadcast]` learnings | Append | Announcements |
| `[msg:*]` learnings | Append | Cross-matrix messages |
| `messages` table | Append | Agent status |
| `[component]` issues | Append | Bug tracking |

---

## Next Steps

1. **Implement Phase 1** - WebSocket server alongside file IPC
2. **Test with agents** - Verify connection and task delivery
3. **Migrate agents** - Switch to WebSocket client
4. **Remove file polling** - After 2 weeks stable
5. **Add matrix hub** - Cross-matrix real-time

---

## Verification Commands

```bash
# Check issues
bun memory issue --list

# Check inbox
bun memory message --inbox

# Stats
bun memory stats

# Recall session
bun memory recall

# Reindex vectors
bun memory reindex
```
