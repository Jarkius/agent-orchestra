# Claude Sub-Agent Orchestration System

Spawns real Claude CLI instances as sub-agents via MCP.

## ⚡ FIRST: Check System Health

**New session? Run this NOW before doing anything else:**

```bash
bun memory status
```

If anything shows ❌ or this is a fresh clone:
```bash
bun memory init          # Quick fix for most issues
./scripts/setup.sh       # Full setup (fresh clone)
```

---

@.claude/rules/startup.md
@.claude/rules/architecture.md
@.claude/rules/memory-first.md
@.claude/rules/agent-patterns.md
@.claude/rules/matrix-comms.md
@.claude/rules/search-strategy.md

## MCP vs Matrix

| Need | Use | Port |
|------|-----|------|
| Control local agents | MCP tools (`assign_task`, `get_task_result`) | stdio |
| Message other projects | Matrix (`matrix_send`, `bun memory message`) | 8081 |

**Data paths:** `./data/agent_inbox/` (tasks) → `./data/agent_outbox/` (results)

## Task Linking (Traceability)

Link agent work to business requirements for cost tracking and learning attribution:

```bash
# Create requirement
bun memory task "Implement feature X" --project

# Assign with link (via MCP)
assign_task(agent_id, task, unified_task_id=5)  # Links to requirement #5

# Query lineage
getTaskLineage(5)  # Returns: requirement, missions, tasks, learnings, stats
```

**Auto-behaviors:**
- `assign_task` with `unified_task_id` → marks requirement "in_progress"
- All linked tasks complete → auto-marks requirement "done"
- `harvestFromMission` → links learnings to source task/mission/requirement

## Quick Start

```bash
./scripts/spawn/spawn_claude_agents.sh [n]   # Start n agents (includes watch pane)
tmux attach -t claude-agents-<pid>           # View agents + matrix watch
bun memory <cmd>                             # Memory system
bun memory message                           # Cross-matrix messaging
bun memory watch                             # Live message feed
bun memory init                              # Start hub + daemon
```

## Task Management

```bash
bun memory task                              # List all pending tasks
bun memory task:list --system                # System tasks only
bun memory task:list --session               # Session tasks only
bun memory task:create "Fix X" --system      # System task → GitHub
bun memory task:create "Study Y" --project   # Local project task
bun memory task:create "Step 1" --session    # Session-scoped task
bun memory task:update 5 done                # Complete task
bun memory task:sync                         # Sync with GitHub + gap analysis
bun memory task:sync --auto                  # Auto-close high-confidence matches
bun memory task:analyze                      # Analyze commits for completions
bun memory task:stats                        # Task statistics
```

Gap analysis detects completed tasks by checking git commits for:
- Explicit refs: `fixes #N`, `closes #N`, `resolves #N`
- Fuzzy matches: commit messages matching task keywords

## Hybrid Code Search (Superpower!)

**SQLite + ChromaDB hybrid search** - auto-routes to fastest method:

| Query Type | Tool | Speed | vs grep |
|------------|------|-------|---------|
| File/function name | `find` | <2ms | 400x faster |
| Exact string in code | `grep` | ~26ms | 12x faster |
| Conceptual "how does X" | `search` | ~400ms | smarter |

```bash
# Setup (run once)
bun memory index once                        # Index codebase

# Fast lookups (SQLite, no model load)
bun memory index find "daemon"               # Find files by name (<2ms)
bun memory index find "connectToHub"         # Find by function name

# Smart grep (SQLite narrows files, then grep)
bun memory index grep "WebSocket"            # Search all files (26ms vs 300ms)
bun memory index grep "TODO" --in matrix     # Search only matrix files
bun memory index grep "import" --lang ts     # Search only TypeScript

# Semantic search (conceptual queries)
bun memory index search "authentication"     # How does auth work?
bun memory index hybrid "error handling"     # Auto-route to best method

# Maintenance
bun memory index health                      # Check SQLite ↔ ChromaDB sync
bun memory index files                       # List indexed files by language
bun memory indexer start                     # Start auto-update daemon
```

**MCP tool `search_code`** also uses hybrid search automatically.

See @.claude/rules/search-strategy.md for when to use each.

## Matrix Setup (Cross-Machine)

```bash
# Hub host (Machine A)
MATRIX_HUB_HOST=0.0.0.0 bun run src/matrix-hub.ts

# Client (Machine B)
MATRIX_HUB_URL=ws://192.168.1.x:8081 bun run src/matrix-daemon.ts start
```

## Codebase Map

> Auto-generated from semantic index. Run `bun memory map --update` to refresh.

### Overview

- **Files indexed**: 114
- **Total chunks**: 11482
- **Top languages**: typescript (608), markdown (284), json (108)

### Directory Structure

```
├── docs/ (10 files)
│   ├── codebase-evolution-plan.md
│   ├── learning-loop.md
│   ├── LEARNING.md
│   ├── LEARNINGS-2026-01-21.md
│   ├── memory-system.md
│   ├── pty-orchestration.md
│   ├── SESSION_SNAPSHOT.md
│   ├── SESSION-2026-01-21-SSE-DUPLEX.md
│   ├── SYSTEM_ASSESSMENT_2026-01.md
│   └── worktree-isolation.md
├── plans/ (2 files)
│   ├── 2026-01-19_knowledge-graph-support.md
│   └── 2026-01-22_test-matrix-mcp-communication.md
├── scripts/ (42 files)
│   ├── memory/ (25 files)
│   │   ├── absorb.ts
│   │   ├── capture-context.ts
│   │   ├── code-index.ts
│   │   ├── consolidate.ts
│   │   ├── context.ts
│   │   ├── distill.ts
│   │   ├── evaluate-search.ts
│   │   ├── export.ts
│   │   ├── graph.ts
│   │   ├── index.ts
│   │   ├── init.ts
│   │   ├── issue.ts
│   │   ├── learn.ts
│   │   ├── list.ts
│   │   ├── message.ts
│   │   ├── migrate-dual-collection.ts
│   │   ├── migrate-issues-to-tasks.ts
│   │   ├── purge.ts
│   │   ├── recall.ts
│   │   ├── reindex.ts
│   │   ├── reset.ts
│   │   ├── stats.ts
│   │   ├── status.ts
│   │   ├── task.ts
│   │   └── validate-search.ts
│   ├── tests/ (9 files)
│   │   ├── agent.test.ts
│   │   ├── db-functions.test.ts
│   │   ├── integration.test.ts
│   │   ├── matrix.test.ts
│   │   ├── memory.test.ts
│   │   ├── task-linking.test.ts
│   │   ├── task-linking-integration.test.ts
│   │   ├── task-linking-flow-stress.test.ts
│   │   └── test-utils.ts
│   ├── download-embedding-model.ts
│   ├── migrate-collections.ts
│   ├── ralph-learning-loop.ts
│   ├── save-session.ts
│   ├── stress-test-with-oracle.ts
│   ├── test-concurrent-init.ts
│   ├── test-consolidation.ts
│   ├── test-embeddings.ts
│   ├── test-integration.ts
│   ├── test-learning-loop.ts
│   ├── test-message-ordering.ts
│   └── test-semantic-search.ts
├── src/ (54 files)
│   ├── embeddings/ (2 files)
│   │   ├── index.ts
│   │   └── transformers-provider.ts
│   ├── indexer/ (1 files)
│   │   └── code-indexer.ts
│   ├── interfaces/ (5 files)
│   │   ├── index.ts
│   │   ├── learning.ts
│   │   ├── mission.ts
│   │   ├── pty.ts
│   │   └── spawner.ts
│   ├── learning/ (8 files)
│   │   ├── tests/ (1 files)
│   │   │   └── integration.test.ts
│   │   ├── code-analyzer.ts
│   │   ├── consolidation.ts
│   │   ├── content-router.ts
│   │   ├── context-router.ts
│   │   ├── distill-engine.ts
│   │   ├── loop.ts
│   │   └── search-validation.ts
│   ├── mcp/ (8 files)
│   │   ├── tools/ (3 files)
│   │   │   ├── handlers/ (2 files)
│   │   │   │   ├── task.ts
│   │   │   │   └── vector.ts
│   │   │   └── index.ts
│   │   ├── utils/ (2 files)
│   │   │   ├── response.ts
│   │   │   └── validation.ts
│   │   ├── config.ts
│   │   ├── server.ts
│   │   └── types.ts
│   ├── oracle/ (3 files)
│   │   ├── tests/ (1 files)
│   │   │   └── orchestrator.test.ts
│   │   ├── index.ts
│   │   └── orchestrator.ts
│   ├── pty/ (11 files)
│   │   ├── tests/ (6 files)
│   │   │   ├── integration.test.ts
│   │   │   ├── mission-persistence.test.ts
│   │   │   ├── mission-queue.test.ts
│   │   │   ├── pty-manager.test.ts
│   │   │   ├── spawner.test.ts
│   │   │   └── worktree-manager.test.ts
│   │   ├── index.ts
│   │   ├── manager.ts
│   │   ├── mission-queue.ts
│   │   ├── spawner.ts
│   │   └── worktree-manager.ts
│   ├── services/ (2 files)
│   │   ├── agent-memory-service.ts
│   │   └── recall-service.ts
│   ├── tests/ (2 files)
│   │   ├── e2e-flow.test.ts
│   │   └── matrix-integration.test.ts
│   ├── utils/ (2 files)
│   │   ├── formatters.ts
│   │   └── git-context.ts
│   ├── agent-report.ts
│   ├── agent-watcher.ts
│   ├── claude-agent.ts
│   ├── db.ts
│   ├── matrix-client.ts
│   ├── matrix-daemon.ts
│   ├── matrix-hub.ts
│   ├── matrix-watch.ts
│   ├── orchestrator.ts
│   └── ws-server.ts
├── tests/ (1 files)
│   └── structured-learnings.test.ts
├── CLAUDE.md
├── package.json
├── PROMPT.md
├── README.md
└── tsconfig.json
```

### Key Files

**Entry Points:**
- `src/mcp/server.ts`
- `src/mcp/tools/index.ts`
- `src/interfaces/index.ts`
- `src/embeddings/index.ts`
- `src/pty/index.ts`

**Core Modules (most exports):**
- `src/db.ts` - db, registerAgent, updateAgentStatus...
- `src/mcp/utils/validation.ts` - AgentIdSchema, TaskIdSchema, LimitSchema...
- `scripts/tests/test-utils.ts` - createTempDb, getTempDb, getTempDbPath...
- `src/services/agent-memory-service.ts` - AgentSessionInput, AgentLearningInput, SessionWithLinks...
- `src/matrix-client.ts` - connectToHub, waitForFlush, disconnect...
- `src/services/recall-service.ts` - clearQueryCache, mmrRerank, QueryType...
- `src/learning/search-validation.ts` - SearchFeedback, SearchMetrics, WeightRecommendation...
- `src/learning/distill-engine.ts` - ParsedItem, ParsedSection, ExtractedMetric...

**Key Classes:**
- `src/indexer/code-indexer.ts`: extraction, CodeIndexer
- `src/learning/loop.ts`: LearningLoop
- `src/learning/code-analyzer.ts`: names
- `src/utils/git-context.ts`: names
- `src/embeddings/transformers-provider.ts`: TransformersEmbeddingFunction
- `src/pty/worktree-manager.ts`: WorktreeManager
- `src/pty/manager.ts`: PTYManager
- `src/pty/spawner.ts`: AgentSpawner
