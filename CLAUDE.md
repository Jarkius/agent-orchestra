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

## Memory Commands (Slash-style)

Use these to manage session context and learnings:

```bash
# PRIMARY: End session, save context + learnings (prompts for learnings with categories)
bun memory save                    # Interactive mode
bun memory save "quick summary"    # Quick mode (still prompts for learnings)

# SECONDARY: Quick learning capture (no session context)
bun memory learn <category> "title" ["context"]
bun memory learn insight "Tests document behavior" "Not just for catching bugs"
bun memory learn philosophy "Simplicity over cleverness"

# TERTIARY: Extract learnings from past sessions
bun memory distill                 # From last session
bun memory distill session_123     # From specific session
bun memory distill --last 5 --yes  # From last 5, auto-accept

# Recall and search
bun memory recall                  # Resume last session
bun memory recall "query"          # Semantic search
bun memory recall "#5"             # Specific learning by ID
bun memory recall "session_123"    # Specific session by ID

# Other utilities
bun memory export [path]           # Export learnings to markdown
bun memory stats                   # View statistics
bun memory list sessions           # List recent sessions (table view)
bun memory list learnings          # List learnings by category
bun memory list -i                 # Interactive browser with clipboard copy
bun memory context ["query"]       # Context bundle for new session

# Cleanup
bun memory purge sessions           # Purge all sessions
bun memory purge learnings          # Purge all learnings
bun memory purge sessions --keep 10 # Keep last 10, purge rest
bun memory purge --before "2025-01-01"  # Purge old data
bun memory reset                    # Nuclear option - wipe ALL memory
```

### Learning Categories
- **Technical**: performance, architecture, tooling, process, debugging, security, testing
- **Wisdom**: philosophy, principle, insight, pattern, retrospective

### Confidence Model
- `save` (user confirmed): starts at `medium`
- `learn` (quick capture): starts at `low`
- `distill` (extracted): starts at `low`
- Use `validate_learning` MCP tool to increase: low → medium → high → proven

## Memory Recall Features

### Resume Mode (No Args)
When running `bun memory recall` without arguments, it shows:
- **Recent plan files** from `.claude/plans/` (modified in last 24h)
- **Current git status** (uncommitted files, branch)
- **Changes since last session** (new commits, files changed)
- Pending/blocked tasks to continue working on
- Next steps defined in the session
- Full session context (wins, challenges, etc.)
- Related sessions and key learnings

### Exact ID Lookup
Recall supports direct lookup by session or learning ID:
```bash
bun memory recall "session_1768559153258"  # Exact session lookup
bun memory recall "#10"                     # Learning by ID
bun memory recall "learning_10"             # Alternative learning ID format
```

### Semantic Search
For non-ID queries, uses vector similarity search across sessions, learnings, and tasks:
```bash
bun memory recall "embedding performance"
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
| `src/db.ts` | SQLite schema for agents, sessions, learnings |
| `src/vector-db.ts` | ChromaDB integration with auto-linking |
| `src/services/recall-service.ts` | Unified recall logic (ID detection + semantic search) |
| `src/utils/formatters.ts` | Shared formatting (icons, badges, full_context) |
| `src/mcp/tools/handlers/session.ts` | Session persistence tools |
| `src/mcp/tools/handlers/learning.ts` | Learning management tools |
| `src/mcp/tools/handlers/analytics.ts` | Stats and export tools |
| `spawn_claude_agents.sh` | Launches real Claude agents in tmux |
| `LEARNINGS.md` | Auto-generated learnings documentation |

## MCP Tools Available

### Agent Orchestration
| Tool | Arguments | Description |
|------|-----------|-------------|
| `assign_task` | agent_id, task, context? | Send task to specific agent |
| `broadcast_task` | task, context? | Send to all agents |
| `get_task_result` | task_id, agent_id | Get completed result |
| `get_agents` | none | List agents with status |
| `update_shared_context` | content | Update shared context |
| `get_all_results` | agent_id | Get all results from agent |

### Session Memory
| Tool | Arguments | Description |
|------|-----------|-------------|
| `save_session` | summary, full_context?, tags?, duration_mins?, commits_count? | Save session with auto-linking |
| `recall_session` | query, limit? | Semantic search past sessions |
| `get_session` | session_id | Get full session details + links |
| `list_sessions` | tag?, since?, limit? | List sessions with filters |
| `link_sessions` | from_id, to_id, link_type | Create session relationship |

### Learnings
| Tool | Arguments | Description |
|------|-----------|-------------|
| `add_learning` | category, title, description?, context? | Add learning with auto-linking |
| `recall_learnings` | query, category?, limit? | Semantic search learnings |
| `get_learning` | learning_id | Get learning details + links |
| `list_learnings` | category?, confidence?, limit? | List learnings with filters |
| `validate_learning` | learning_id | Increase confidence level |
| `link_learnings` | from_id, to_id, link_type | Create learning relationship |

### Analytics
| Tool | Arguments | Description |
|------|-----------|-------------|
| `get_session_stats` | none | Session statistics |
| `get_improvement_report` | none | Learning confidence distribution |
| `get_context_bundle` | query?, include_learnings?, include_recent_sessions? | Context bundle for new session |
| `export_learnings` | output_path?, format? | Export to LEARNINGS.md or JSON |

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

## Memory System

The enhanced session memory system captures context across sessions:

```
┌──────────────────────────────────────────────────────────┐
│                    MCP Tools Layer                       │
│  save_session | recall_session | add_learning | export   │
└────────────────────────┬─────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   ┌──────────┐   ┌──────────────┐  ┌─────────────┐
   │ SQLite   │   │   ChromaDB   │  │ LEARNINGS.md│
   │ (Truth)  │◄──│   (Search)   │  │   (Human)   │
   └──────────┘   └──────────────┘  └─────────────┘
```

**SQLite Tables:**
- `sessions` - Full session context (wins, issues, git context, etc.)
- `learnings` - Accumulated knowledge with confidence levels
- `session_links` - Relationships between sessions
- `learning_links` - Relationships between learnings

**Auto-Linking:**
- Similarity > 0.85 = automatic link
- Similarity 0.70-0.85 = suggested link

**Confidence Progression:**
```
low → medium → high → proven
```
Use `validate_learning` to increase confidence based on validation count.

**Workflow:**
```bash
# Before /clear - save context
bun memory save

# In new session - get context
bun memory context "what you're working on"

# Search for relevant past work
bun memory recall "embeddings"

# Export learnings periodically
bun memory export
```
