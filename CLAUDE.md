# Claude Sub-Agent Orchestration System

Spawns real Claude CLI instances as sub-agents via MCP.

## Commands

| Command | Description |
|---------|-------------|
| `./scripts/spawn/spawn_claude_agents.sh [n]` | Start n agents |
| `tmux attach -t claude-agents-<pid>` | View agents |

### Memory (`bun memory <cmd>` or `/memory-<cmd>`)

| Command | Args | Description |
|---------|------|-------------|
| `save` | [summary] | Save session before `/clear` |
| `recall` | [query] | Resume or search sessions |
| `learn` | cat "title" [--lesson --prevention] | Add learning |
| `distill` | [--all] | Extract learnings from sessions |
| `export` | | → LEARNINGS.md |
| `validate` | | Increase confidence |
| `purge` | target [--keep N] | Cleanup |
| `reindex` | | Rebuild vectors |
| `graph` | [entity] | Explore knowledge graph |
| `stats` | | View statistics |
| `context` | "query" | Get context for new work |

**Categories:** performance, architecture, tooling, process, debugging, security, testing, philosophy, principle, insight, pattern, retrospective

**Confidence:** low → medium → high → proven

## Workflow: Search Memory First

Before suggesting workflows or patterns, search for proven learnings:

```bash
bun memory recall "topic keywords"
```

**When to search:** Before suggesting tools, patterns, or "how to" approaches. Proven learnings (20x+ validated) should inform suggestions.

## Architecture

```
src/mcp/server.ts     MCP server + tools
src/db.ts             SQLite (agents, sessions, learnings)
src/vector-db.ts      ChromaDB semantic search
agents.db             SQLite database
/tmp/agent_inbox/     Task queue (by agent id)
/tmp/agent_outbox/    Results (by agent id)
```
