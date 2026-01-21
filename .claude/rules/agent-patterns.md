# Agent Orchestration Patterns

## Quick Start

```bash
# Start agents
./scripts/spawn/spawn_claude_agents.sh [n]

# View agents
tmux attach -t claude-agents-<pid>
```

## Agent Roles

| Role | Purpose |
|------|---------|
| `coder` | Implementation tasks |
| `tester` | Test writing/verification |
| `analyst` | Code analysis |
| `reviewer` | Code review |
| `architect` | Design decisions |
| `debugger` | Bug investigation |
| `researcher` | Information gathering |
| `scribe` | Documentation |
| `oracle` | Orchestration oversight |
| `generalist` | Any task |

## Agent Models

| Model | Use Case |
|-------|----------|
| `haiku` | Fast, simple tasks |
| `sonnet` | Balanced (default) |
| `opus` | Complex reasoning |

## Task Distribution

1. **Priority queue:** critical > high > normal > low
2. **Specialist matching:** Find idle agent with matching role
3. **Load balancing:** Fallback to least-busy agent
4. **Auto-retry:** Exponential backoff on failure

## Health & Recovery

- Auto-restart on crash (2s delay)
- Health checks every 5s
- Process monitoring via `kill -0`
- Resource tracking (memory, CPU)

## Agent States

```
starting → idle ↔ busy → stopping → stopped
              ↓
           crashed → restart
```

## MCP Tools

```
agent spawn [role] [model]    # Spawn single agent
agent spawn_pool [n]          # Spawn pool
agent kill [id]               # Terminate agent
agent restart [id]            # Restart agent
agent health [id]             # Check health
agent status                  # List all agents
```

## Worktree Isolation

Each agent can have its own git worktree for parallel work:

```
worktree provision [agent_id] [task_id]  # Create isolated branch
worktree merge [agent_id]                # Merge back to main
worktree cleanup                         # Remove stale worktrees
```
