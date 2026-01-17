---
description: "Resume work or search past sessions. No args = resume context. Query = semantic search across sessions/learnings."
---

# Memory Recall

Search and resume past sessions using semantic search or exact ID lookup.

## Usage

```
/memory-recall [query|session_id|#learning_id]
```

## Examples

```bash
# Resume last session (shows plan files, git status, pending tasks)
/memory-recall

# Semantic search
/memory-recall "authentication implementation"
/memory-recall "performance optimization"

# Exact session lookup
/memory-recall session_1768632008430

# Learning by ID
/memory-recall #5
/memory-recall learning_10
```

## Resume Mode (No Args)

Shows comprehensive context to continue work:
- **Recent plan files**: From `.claude/plans/` (last 24h)
- **Current git status**: Uncommitted files, branch
- **Changes since last session**: New commits, diff stats
- **Pending tasks**: Work items to continue
- **Session context**: Wins, challenges, next steps
- **Related sessions**: Auto-linked similar work
- **Key learnings**: High-confidence insights

## Search Mode

Searches across:
- Sessions (summary, tags, context)
- Learnings (title, description, category)
- Tasks (description, notes)

Results ranked by semantic similarity.

## Instructions

Run the memory recall command:
```bash
bun memory recall "$ARGUMENTS"
```

If no arguments, shows resume context for last session.
After running, summarize the key findings.
