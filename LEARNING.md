# Learning Journal: Agent Orchestration Evolution

This document tracks our journey from simple parallel shell scripts to a full agent orchestration system.

## Phase 1: Simple Parallel Execution (Starting Point)

**What we had:**
- Bash scripts spawning background processes
- tmux for visual split panes
- No communication between agents
- No central coordination

**Scripts:**
- `spawn_test.sh` - Background processes with interleaved output
- `spawn_tmux.sh` - Visual panes, but isolated agents
- `spawn_ghostty.sh` - Terminal-native splits

**Limitation:** Agents couldn't share state or receive commands.

---

## Phase 2: Orchestrated Agents with SQLite (Current)

**Architecture:**
```
┌─────────────────────────────────────────┐
│           ORCHESTRATOR (Bun)            │
│  - Monitors all agents                  │
│  - Sends commands                       │
│  - Displays dashboard                   │
├─────────────────────────────────────────┤
│              SQLite DB                  │
│  agents │ messages │ tasks              │
├─────────┬───────────┬───────────────────┤
│ Agent 1 │ Agent 2   │ Agent 3           │
│  (bash) │  (bash)   │  (bash)           │
└─────────┴───────────┴───────────────────┘
```

**New components:**
- `src/db.ts` - Database schema and helpers
- `src/orchestrator.ts` - Central dashboard
- `src/agent-report.ts` - CLI for agents to report status
- `spawn_orchestrated.sh` - tmux layout with orchestrator pane

**Communication flow:**
1. Agent spawns → registers in SQLite
2. Agent works → updates status in SQLite
3. Orchestrator polls SQLite → displays dashboard
4. ~~Orchestrator sends command → writes to messages table~~
5. ~~Agent checks messages → receives command~~

### Improved: Direct Control via tmux

We discovered that using SQLite for real-time messaging was awkward. Better approach:

```
Orchestrator                          Agent Panes
     │                                     │
     │──── tmux send-keys ────────────────►│ (instant input)
     │                                     │
     │◄─── SQLite (status/logs) ──────────│ (async reporting)
```

**Separation:**
- **SQLite** = logging, history, status (async, read-only for orchestrator)
- **tmux send-keys** = real-time control (direct stdin injection)

**Key learnings:**
- SQLite works great for local IPC (inter-process communication)
- File-based DB = zero config, easy to inspect
- Bun's built-in SQLite is fast and simple
- tmux `send-keys` can inject commands into panes

**Run it:**
```bash
./spawn_orchestrated.sh 3
```

---

## Phase 3: Future Evolution (Planned)

### 3a. Add Task Queue
- Orchestrator assigns tasks from queue
- Agents pull tasks when idle
- Track task history and results

### 3b. Add ChromaDB for Semantic Memory
```
┌─────────────────────────────────────────┐
│           ORCHESTRATOR                  │
├──────────────────┬──────────────────────┤
│     SQLite       │      ChromaDB        │
│  - Task queue    │  - Agent memories    │
│  - Agent status  │  - Similar tasks     │
│  - Messages      │  - Shared context    │
└──────────────────┴──────────────────────┘
```

**Use cases:**
- Find similar past tasks and reuse solutions
- Share learned patterns between agents
- Semantic search over agent outputs

### 3c. Add Web UI
- Real-time dashboard in browser
- WebSocket for live updates
- Control agents without terminal

### 3d. Real AI Agent Integration
- Replace bash "agents" with actual LLM calls
- Each pane runs a Claude/GPT agent
- Orchestrator coordinates multi-agent tasks

---

## Technical Notes

### tmux Tips for Beginners
```bash
# Enable mouse mode (click to switch panes)
tmux set -g mouse on

# Make permanent
echo "set -g mouse on" >> ~/.tmux.conf
```

### SQLite Inspection
```bash
# View database
sqlite3 agents.db

# Show tables
.tables

# Query agents
SELECT * FROM agents;

# Watch messages
SELECT * FROM messages ORDER BY created_at DESC LIMIT 10;
```

### Bun + SQLite
```typescript
import { Database } from "bun:sqlite";
const db = new Database("./agents.db");

// Query
const agents = db.query("SELECT * FROM agents").all();

// Insert
db.run("INSERT INTO agents (id, status) VALUES (?, ?)", [1, "running"]);
```

---

---

## Phase 3: MCP Server for AI Integration (Current)

**Problem solved:** tmux send-keys breaks with special characters (`$`, `"`, newlines). AI can't reliably send code snippets to agents.

**Solution:** MCP (Model Context Protocol) server for direct tool-based communication.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Claude                                │
│        tool_call: send_to_agent(1, "any code...")           │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Protocol (stdio JSON-RPC)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               MCP Server (src/mcp-server.ts)                 │
│  Tools:                                                      │
│   - send_to_agent(id, message) → writes to inbox file       │
│   - get_agents() → returns agent status from SQLite         │
│   - get_agent_messages(id) → returns agent's output         │
│   - get_agent_response(id) → reads from outbox              │
└─────────────────────────┬───────────────────────────────────┘
                          │ File-based (inbox/outbox)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Agent Watcher (src/agent-watcher.ts)            │
│  - Polls /tmp/agent_inbox/{id}/ for new .txt files          │
│  - Processes messages                                        │
│  - Writes responses to /tmp/agent_outbox/{id}/              │
│  - Updates SQLite status                                     │
└─────────────────────────────────────────────────────────────┘
```

### New Components

| File | Purpose |
|------|---------|
| `src/mcp-server.ts` | MCP server exposing tools to Claude |
| `src/agent-watcher.ts` | Bun-based inbox watcher for agents |
| `spawn_mcp.sh` | Launches MCP-enabled tmux session |
| `.mcp.json` | Config for Claude Code to find the server |

### Key Learnings

1. **MCP vs tmux send-keys:** MCP provides structured, type-safe communication. No shell escaping.
2. **File-based messaging:** Simple and reliable for any content (code, multi-line, special chars).
3. **Inbox/Outbox pattern:** Clean separation of concerns - one directory per agent.
4. **Polling vs Events:** Polling is simpler and works across all platforms.

### Usage

```bash
# Start MCP-enabled agents
./spawn_mcp.sh 3

# Claude can now use tools:
# - send_to_agent(1, "function test() { ... }")
# - get_agents()
# - get_agent_response(1)
```

---

## Phase 4: Real Claude Sub-Agents (Current)

**The big upgrade:** Each agent is now a **real Claude CLI instance** that can think, code, and solve problems!

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    YOU (Orchestrator)                        │
│                    Claude Code (Max plan)                    │
│                                                              │
│  Use MCP tools: assign_task(1, "Fix the bug...")            │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Protocol
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server v2.0                           │
│  assign_task | broadcast_task | get_task_result             │
│  update_shared_context | get_agents                         │
└─────────────────────────┬───────────────────────────────────┘
                          │ File-based task queue
                          ▼
┌───────────────┬───────────────┬───────────────┬─────────────┐
│   Agent 1     │   Agent 2     │   Agent 3     │             │
│  claude -p    │  claude -p    │  claude -p    │             │
│  (REAL AI!)   │  (REAL AI!)   │  (REAL AI!)   │             │
└───────────────┴───────────────┴───────────────┴─────────────┘
```

### New Components

| File | Purpose |
|------|---------|
| `src/claude-agent.ts` | Wrapper for running `claude` CLI with tasks |
| `src/agent-watcher.ts` | Watches inbox, runs Claude CLI, writes results |
| `spawn_claude_agents.sh` | Launches real Claude agents in tmux |

### Usage

```bash
# Start 3 real Claude agents
./spawn_claude_agents.sh 3

# From orchestrator (MCP tools):
assign_task(1, "Write a Python function to sort a list")
assign_task(2, "Review this code for security issues", context="...")
broadcast_task("What design patterns apply here?")

# Get results:
get_task_result("task_xxx", 1)
get_all_results(1)
```

### Key Learnings

1. **Claude CLI works with Max plan** - No API key needed, uses OAuth
2. **`claude -p` for prompts** - Non-interactive mode for scripting
3. **File-based task queue** - Simple, reliable, debuggable
4. **Shared context** - All agents can access common project context

### Task JSON Format

```json
{
  "id": "task_1234",
  "prompt": "Write a function that...",
  "context": "We're building a...",
  "priority": "high"
}
```

### Result JSON Format

```json
{
  "task_id": "task_1234",
  "agent_id": 1,
  "status": "completed",
  "output": "Here's the function...",
  "duration_ms": 5432
}
```

---

## Questions to Explore

1. **Scaling:** How many agents can SQLite handle efficiently?
2. **Real-time:** Should we use SQLite polling or switch to WebSocket/Redis?
3. **Persistence:** Should agent memory persist across sessions?
4. **Distribution:** Can we run agents on different machines?
5. **MCP:** Can we add more tools (file editing, shell commands per agent)?
6. **Specialization:** Can agents have different "roles" (coder, reviewer, tester)?

---

## Resources

- [Bun SQLite docs](https://bun.sh/docs/api/sqlite)
- [tmux cheatsheet](https://tmuxcheatsheet.com/)
- [ChromaDB](https://www.trychroma.com/) - for future vector storage
- [MCP Protocol](https://modelcontextprotocol.io/) - for AI tool integration
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) - for Max plan integration
