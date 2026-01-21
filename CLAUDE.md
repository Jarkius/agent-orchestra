# Claude Sub-Agent Orchestration System

Spawns real Claude CLI instances as sub-agents via MCP.

@.claude/rules/architecture.md
@.claude/rules/memory-first.md
@.claude/rules/agent-patterns.md
@.claude/rules/matrix-comms.md

## Quick Start

```bash
./scripts/spawn/spawn_claude_agents.sh [n]   # Start n agents
tmux attach -t claude-agents-<pid>           # View agents
bun memory <cmd>                             # Memory system
bun memory message                           # Cross-matrix messaging
```
