# Agent Orchestra

Multi-agent orchestration with persistent memory and intelligent task routing.

## Quick Start

```bash
bun memory status     # Check health (run FIRST in new sessions)
bun memory init       # Fix issues
./scripts/setup.sh    # Fresh clone setup
```

## Core Concepts

| Component | Purpose |
|-----------|---------|
| **MCP Tools** | Control local agents (assign_task, get_result) |
| **Matrix Hub** | Cross-project messaging (:8081) |
| **Oracle** | Intelligent task routing & spawning |
| **SQLite** | Source of truth (agents.db) |
| **ChromaDB** | Semantic search (:8100) |

## Agent Commands

```bash
./scripts/spawn/spawn_claude_agents.sh 3   # Spawn agents
bun memory task                            # List tasks
bun memory recall "query"                  # Search sessions
bun memory learn ./file.md                 # Capture knowledge
bun memory message "Hello"                 # Cross-matrix message
bun memory quality --smart                 # LLM-enhanced scoring
bun memory analyze                         # Cross-session patterns
bun memory correlate                       # Link learnings to code
```

## Oracle Intelligence

Routes tasks to optimal agents automatically:
- **Complexity Analysis**: haiku (simple) → sonnet (standard) → opus (complex)
- **Proactive Spawning**: Spawns before queue backs up
- **Task Decomposition**: Breaks complex tasks into subtasks

```bash
bun test scripts/tests/oracle-spawning.test.ts   # 17 tests
bun test scripts/tests/task-routing.test.ts      # 27 tests
bun test scripts/tests/simulation.test.ts        # 17 tests
bun test scripts/tests/chaos.test.ts             # 13 tests
```

## Code Search

```bash
bun memory index find "filename"     # Fast file lookup (<2ms)
bun memory index grep "pattern"      # Smart grep (26ms)
bun memory index search "concept"    # Semantic search (~400ms)
```

## Key Files

| Path | Purpose |
|------|---------|
| `src/oracle/` | Task routing, decomposition, orchestration |
| `src/pty/` | Agent spawning, mission queue |
| `src/mcp/` | MCP server and tools |
| `src/learning/` | Knowledge extraction, quality scoring |
| `src/db/` | SQLite operations (modular, shim at src/db.ts) |
| `scripts/memory/` | CLI commands |

## Rules

@.claude/rules/startup.md
@.claude/rules/architecture.md
@.claude/rules/memory-first.md
@.claude/rules/agent-patterns.md
@.claude/rules/matrix-comms.md
@.claude/rules/search-strategy.md

## Docs

- [Oracle Intelligence](docs/oracle-intelligence.md) - Task routing & spawning
- [Memory System](docs/memory-system.md) - Sessions & learnings
- [PTY Orchestration](docs/pty-orchestration.md) - Agent management
