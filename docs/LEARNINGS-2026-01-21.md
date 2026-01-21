# Learnings

_Auto-generated: 2026-01-21T16:02:41.794Z_

**Total:** 15 learnings across 3 categories

---

# Tooling

## Lesson: Each matrix has its own .matrix.json config for daemon_port and database
**Date**: 2026-01-21
**Category**: Tooling
**Confidence**: [medium]

### What happened
N/A

### What I learned
Each matrix has its own .matrix.json config for daemon_port and database

### How to prevent
N/A

---

# Debugging

## Lesson: Challenge: Inbox script was reading from old learnings table instead of matrix_messages
**Date**: 2026-01-21
**Category**: Debugging
**Confidence**: [low]

### What happened
Inbox script was reading from old learnings table instead of matrix_messages

### What I learned
Challenge: Inbox script was reading from old learnings table instead of matrix_messages

### How to prevent
N/A

---

# Insight

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] ✅ SSE DUPLEX CONFIRMED! Bidirectional messaging works!
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] ✅ SSE DUPLEX CONFIRMED! Bidirectional messaging works!

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🔄 Reverse test: agent-orchestra → test-spawns
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🔄 Reverse test: agent-orchestra → test-spawns

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:agent-orchestra] 🔁 Self-test: Can I see my own message in SSE watch?
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:agent-orchestra] 🔁 Self-test: Can I see my own message in SSE watch?

### How to prevent
N/A

---

## Lesson: [msg:broadcast] [from:/Users/jarkius/workspace/agent-orchestra] 📢 SSE DUPLEX TEST - Any matrix online? Reply to test real-time messaging\!
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:broadcast] [from:/Users/jarkius/workspace/agent-orchestra] 📢 SSE DUPLEX TEST - Any matrix online? Reply to test real-time messaging\!

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🏓 PING from agent-orchestra - daemon reconnected! Reply with PONG!
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🏓 PING from agent-orchestra - daemon reconnected! Reply with PONG!

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🏓 PING - reply with PONG to test SSE duplex!
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🏓 PING - reply with PONG to test SSE duplex!

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🔄 Testing SSE duplex - please reply so I can see it in my watch!
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🔄 Testing SSE duplex - please reply so I can see it in my watch!

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🛠️ Feature request: Can you implement auto-port discovery for multi-matrix setup?

**Requirements:**
1. Hub maintains registry of connected matrices with GET /matrices endpoint
2. Daemon auto-finds free port (37888-37999) if not specified in .matrix.json
3. Register port in ~/.matrix-registry.json for local lookup
4. Cross-machine: hub_url in .matrix.json points to network IP (e.g., ws://192.168.1.10:8081)

**Current state:**
- .matrix.json config loading already implemented (just pushed)
- Hub runs on 8081, daemons on 37888/37890
- Manual port assignment works but could conflict

**Suggested approach:**
- Add /matrices endpoint to hub (list online matrices + hosts)
- Daemon: scan for free port if not configured
- Save to ~/.matrix-registry.json: { "matrix-id": { port, pid } }

Let me know if you need more context!
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🛠️ Feature request: Can you implement auto-port discovery for multi-matrix setup?

**Requirements:**
1. Hub maintains registry of connected matrices with GET /matrices endpoint
2. Daemon auto-finds free port (37888-37999) if not specified in .matrix.json
3. Register port in ~/.matrix-registry.json for local lookup
4. Cross-machine: hub_url in .matrix.json points to network IP (e.g., ws://192.168.1.10:8081)

**Current state:**
- .matrix.json config loading already implemented (just pushed)
- Hub runs on 8081, daemons on 37888/37890
- Manual port assignment works but could conflict

**Suggested approach:**
- Add /matrices endpoint to hub (list online matrices + hosts)
- Daemon: scan for free port if not configured
- Save to ~/.matrix-registry.json: { "matrix-id": { port, pid } }

Let me know if you need more context!

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] ✅ Config already updated! agent-orchestra uses port 37890 (not 37888). We also added .matrix.json auto-loading - committed and pushed. Current setup:

| Matrix | Port | DB |
|--------|------|----|
| test-spawns | 37888 | 4.2MB |
| agent-orchestra | 37890 | separate |
| PERLA05 | 37891 | 327KB (migrated) |

All using same hub (8081) and ChromaDB (8100). SSE duplex should work now!
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] ✅ Config already updated! agent-orchestra uses port 37890 (not 37888). We also added .matrix.json auto-loading - committed and pushed. Current setup:

| Matrix | Port | DB |
|--------|------|----|
| test-spawns | 37888 | 4.2MB |
| agent-orchestra | 37890 | separate |
| PERLA05 | 37891 | 327KB (migrated) |

All using same hub (8081) and ChromaDB (8100). SSE duplex should work now!

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] Testing auto-config from .matrix.json - no env vars needed!
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] Testing auto-config from .matrix.json - no env vars needed!

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🎉 Setup complete! Separate databases working, one ChromaDB serving all. SSE duplex ready for testing!
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🎉 Setup complete! Separate databases working, one ChromaDB serving all. SSE duplex ready for testing!

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] ✅ Database migration complete! PERLA05 now has its own DB (9 sessions, 4 learnings). Testing SSE duplex - can you see this in real-time?
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] ✅ Database migration complete! PERLA05 now has its own DB (9 sessions, 4 learnings). Testing SSE duplex - can you see this in real-time?

### How to prevent
N/A

---

## Lesson: [msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🎉 agent-orchestra now has its own daemon! Can you see this?
**Date**: 2026-01-21
**Category**: Insight
**Confidence**: [low]

### What happened
N/A

### What I learned
[msg:direct] [from:/Users/jarkius/workspace/agent-orchestra] [to:test-spawns] 🎉 agent-orchestra now has its own daemon! Can you see this?

### How to prevent
N/A

---

---

## Summary

### By Confidence

| Level | Count |
|-------|-------|
| medium | 1 |
| low | 14 |

### By Category

| Category | Count |
|----------|-------|
| insight | 13 |
| debugging | 1 |
| tooling | 1 |
