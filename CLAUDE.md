# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Claude Sub-Agent Orchestration System** that spawns real Claude CLI instances as sub-agents. Each agent can think, code, and collaborate - using your Claude Max plan.

## Commands

```bash
# Real Claude agents (recommended)
./spawn_claude_agents.sh [num_agents]

# MCP-enabled agents (file watcher mode)
./spawn_mcp.sh [num_agents]

# Attach to view
tmux attach -t claude-agents-<pid>

# Assign task to agent
echo '{"id":"task1","prompt":"Your task here"}' > /tmp/agent_inbox/1/task1.json

# Check results
cat /tmp/agent_outbox/1/*.json
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    YOU (Orchestrator)                        │
│                    Claude Code (Max plan)                    │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Tools: assign_task, get_result
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               MCP Server (src/mcp-server.ts)                 │
│  assign_task | broadcast_task | get_task_result             │
│  update_shared_context | get_agents                         │
└─────────────────────────┬───────────────────────────────────┘
                          │ File-based task queue (/tmp/agent_inbox/)
                          ▼
┌───────────────┬───────────────┬───────────────┬─────────────┐
│   Agent 1     │   Agent 2     │   Agent 3     │             │
│  claude CLI   │  claude CLI   │  claude CLI   │             │
│  (REAL AI!)   │  (REAL AI!)   │  (REAL AI!)   │             │
└───────────────┴───────────────┴───────────────┴─────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `src/claude-agent.ts` | Wrapper for running `claude -p` CLI |
| `src/agent-watcher.ts` | Watches inbox, runs Claude CLI, writes results |
| `src/mcp-server.ts` | MCP server with orchestration tools |
| `src/db.ts` | SQLite schema for agent status/messages |
| `spawn_claude_agents.sh` | Launches real Claude agents in tmux |

## MCP Tools Available

| Tool | Arguments | Description |
|------|-----------|-------------|
| `assign_task` | agent_id, task, context? | Send task to specific agent |
| `broadcast_task` | task, context? | Send to all agents |
| `get_task_result` | task_id, agent_id | Get completed result |
| `get_agents` | none | List agents with status |
| `update_shared_context` | content | Update shared context |
| `get_all_results` | agent_id | Get all results from agent |

## Task JSON Format

```json
{
  "id": "task_1234",
  "prompt": "Write a function that...",
  "context": "We're building a...",
  "priority": "high"
}
```

## Directory Structure

```
/tmp/agent_inbox/{agent_id}/     # Tasks waiting to be processed
/tmp/agent_outbox/{agent_id}/    # Completed task results
/tmp/agent_shared/               # Shared context between agents
agents.db                        # SQLite database for status
```

## Key Patterns

- Each agent runs `claude -p` (non-interactive mode)
- Tasks are JSON files in `/tmp/agent_inbox/{id}/`
- Results are JSON files in `/tmp/agent_outbox/{id}/`
- SQLite tracks agent status and message history
- MCP server provides structured tool access
