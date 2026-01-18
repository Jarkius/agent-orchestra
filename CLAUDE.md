# CLAUDE.md

## Project Overview

Claude Sub-Agent Orchestration System - spawns real Claude CLI instances as sub-agents using Claude Max plan.

## Quick Start

```bash
./spawn_claude_agents.sh [num_agents]  # Start agents
tmux attach -t claude-agents-<pid>      # View agents
```

## Memory Commands

```bash
bun memory save ["summary"]   # Save session + learnings
bun memory recall ["query"]   # Resume/search sessions
bun memory learn <cat> "title" [--lesson "..." --prevention "..."]
bun memory export             # Export to LEARNINGS.md
bun memory stats              # View statistics
```

Categories: performance, architecture, tooling, process, debugging, security, testing, philosophy, principle, insight, pattern, retrospective

Confidence: low → medium → high → proven (use validate_learning to increase)

## Key Files

- `src/mcp-server.ts` - MCP server with tools
- `src/db.ts` - SQLite: agents, sessions, learnings
- `src/vector-db.ts` - ChromaDB for semantic search
- `spawn_claude_agents.sh` - Agent launcher

## Directory Structure

```
/tmp/agent_inbox/{id}/   # Pending tasks
/tmp/agent_outbox/{id}/  # Results
agents.db                # SQLite DB
```

## Workflow

```bash
bun memory save           # Before /clear
bun memory recall         # Resume session
bun memory context "..."  # Context for new work
```
