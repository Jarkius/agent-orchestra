# Claude Sub-Agent Orchestration System

Spawns real Claude CLI instances as sub-agents via MCP.

@.claude/rules/architecture.md
@.claude/rules/memory-first.md
@.claude/rules/agent-patterns.md
@.claude/rules/matrix-comms.md

## MCP vs Matrix

| Need | Use | Port |
|------|-----|------|
| Control local agents | MCP tools (`assign_task`, `get_task_result`) | stdio |
| Message other projects | Matrix (`matrix_send`, `bun memory message`) | 8081 |

**Data paths:** `./data/agent_inbox/` (tasks) → `./data/agent_outbox/` (results)

## Quick Start

```bash
./scripts/spawn/spawn_claude_agents.sh [n]   # Start n agents (includes watch pane)
tmux attach -t claude-agents-<pid>           # View agents + matrix watch
bun memory <cmd>                             # Memory system
bun memory message                           # Cross-matrix messaging
bun memory watch                             # Live message feed
bun memory init                              # Start hub + daemon
```

## Matrix Setup (Cross-Machine)

```bash
# Hub host (Machine A)
MATRIX_HUB_HOST=0.0.0.0 bun run src/matrix-hub.ts

# Client (Machine B)
MATRIX_HUB_URL=ws://192.168.1.x:8081 bun run src/matrix-daemon.ts start
```
