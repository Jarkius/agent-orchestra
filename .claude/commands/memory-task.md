---
description: "List and update pending tasks across sessions. Track work items with status transitions."
---

# Memory Task

Manage session tasks - list pending work and update task status.

## Usage

```
/memory-task [list|<id> <status>]
```

## Examples

```bash
# List pending tasks
/memory-task list

# List all tasks (including completed)
/memory-task list --all

# Update task status
/memory-task 5 done
/memory-task 5 in_progress
/memory-task 5 blocked

# Add notes to a task
/memory-task 5 --notes "Waiting on API review"

# View task details
/memory-task 5
```

## Task Statuses

| Status | Icon | Description |
|--------|------|-------------|
| `done` | `✓` | Completed |
| `pending` | `○` | Not started |
| `in_progress` | `▶` | Currently working |
| `blocked` | `✗` | Blocked by something |

## Auto-Tracking

- `started_at` is auto-set when status changes to `in_progress`
- `completed_at` is auto-set when status changes to `done`

## Instructions

Run the task command:
```bash
bun memory task $ARGUMENTS
```

If no arguments, default to `list` which shows pending tasks grouped by session.
