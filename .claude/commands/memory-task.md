# Memory Task

Unified task management with two domains and multi-repo GitHub sync.

## Usage

```
/task                           # List pending tasks
/task list [--system|--project] # List by domain
/task "Title" --system          # Create system task (→ system GitHub)
/task "Title" --project         # Create project task (local only)
/task "Title" --project --github # Create project task (→ project's GitHub)
/task <id> done                 # Complete task (closes GitHub if synced)
/task <id> --promote            # Promote project -> system
/task sync                      # Sync with GitHub
```

## Domains

- **System**: Auto-syncs with system GitHub issues. For bugs, features, test plans.
- **Project**: Local by default. Use `--github` to sync to current project's repo.

## Examples

```bash
# Create system task (auto-creates GitHub issue in system repo)
/task "Fix race condition in save" --system -c sqlite

# Create project task (stays local)
/task "Study RAG patterns" --project

# Create project task with GitHub sync (→ current project's repo)
/task "Add feature X" --project --github

# Complete task (closes GitHub issue if synced)
/task 5 done

# Promote project task to system (creates GitHub issue in system repo)
/task 7 --promote

# Sync with GitHub (import new issues, update status)
/task sync
```

## Options

- `--system, -s` - System domain (auto-syncs to system GitHub repo)
- `--project, -p` - Project domain (local by default)
- `--github, -g` - Sync project task to current project's GitHub repo
- `--component, -c` - Component: chromadb, sqlite, memory, mcp, agent, cli, vector, other
- `--priority` - Priority: critical, high, normal, low
- `--repro` - Steps to reproduce
- `--fix` - Known fix or workaround
- `--all` - Include completed tasks in list

## Instructions

Run the unified task command:
```bash
bun memory utask $ARGUMENTS
```

If no arguments provided:
```bash
bun memory utask
```

This will list all pending tasks. Confirm task creation or status changes to the user.
