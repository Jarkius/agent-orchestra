# Memory Save

Save the current session to SQLite and ChromaDB for later recall.

## Usage

```
/memory-save [summary]
```

## Examples

```bash
# Interactive mode - prompts for summary, tags, tasks, learnings
/memory-save

# Quick save with summary
/memory-save "Implemented user authentication with JWT"

# Quick save (still prompts for learnings)
/memory-save "Fixed memory leak in worker threads"
```

## What Gets Captured

- **Summary**: Brief description of the session
- **Git context**: Branch, recent commits, files changed (auto-captured)
- **Tags**: Categories for filtering
- **Tasks**: Work items with status (done/pending/blocked)
- **Learnings**: Insights to remember (12 categories)

## Workflow

1. Auto-captures git context (branch, commits, files)
2. Prompts for summary (if not provided)
3. Prompts for tags, duration, key decisions
4. Collects tasks with status
5. Prompts for learnings (always)
6. Saves to SQLite + ChromaDB
7. Auto-links to similar past sessions

## Instructions

If arguments provided, run quick save:
```bash
bun memory save "$ARGUMENTS"
```

If no arguments, run interactive mode:
```bash
bun memory save
```

After saving, confirm the session ID and any auto-links created.
