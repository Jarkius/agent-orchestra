# Memory Task

Unified task management with GitHub sync and git commit analysis.

## Usage

```
/memory-task                      List pending tasks
/memory-task sync                 Sync with GitHub + gap analysis
/memory-task sync --auto          Sync + auto-close completed tasks
/memory-task "title" --system     Create system task (syncs to GitHub)
/memory-task "title" --project    Create project task (local only)
/memory-task <id> done            Complete a task
```

## Actions

| Action | Description |
|--------|-------------|
| (none) | List all pending tasks |
| `sync` | Sync with GitHub, analyze commits for completed work |
| `<id> done` | Mark task as completed |

## Flags

| Flag | Description |
|------|-------------|
| `--auto` | Auto-close tasks with 80%+ confidence match |
| `--system, -s` | System domain (syncs to GitHub) |
| `--project, -p` | Project domain (local only) |
| `--github, -g` | Sync project task to GitHub |
| `--component, -c` | Component: sqlite, chromadb, mcp, agent, etc. |

## Examples

```bash
# List tasks
/memory-task

# Sync and auto-close completed
/memory-task sync --auto

# Create system task
/memory-task "Fix race condition" --system -c sqlite

# Complete task
/memory-task 5 done
```

## Instructions

Run the task command:
```bash
bun memory task $ARGUMENTS
```

For sync action:
```bash
bun memory task:sync $ARGUMENTS
```
