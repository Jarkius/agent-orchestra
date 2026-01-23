# Memory Task

Unified task management with two domains, multi-repo GitHub sync, and git commit analysis.

## Usage

```
/task                           # List pending tasks
/task list [--system|--project] # List by domain
/task "Title" --system          # Create system task (→ system GitHub)
/task "Title" --project         # Create project task (local only)
/task "Title" --project --github # Create project task (→ project's GitHub)
/task <id> done                 # Complete task (closes GitHub if synced)
/task <id> --promote            # Promote project -> system
/task sync                      # Sync with GitHub + analyze commits
/task sync --auto               # Sync + auto-close high-confidence matches
/task analyze                   # Analyze commits without syncing
/task analyze 7 --auto          # Analyze last 7 days, auto-close matches
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

# Sync with GitHub (import new issues, update status, analyze commits)
/task sync

# Sync and auto-close tasks with high-confidence commit matches
/task sync --auto

# Just analyze commits (no GitHub sync)
/task analyze

# Analyze last 7 days and auto-close matches
/task analyze 7 --auto
```

## Gap Analysis

The sync and analyze commands check git commits to identify completed tasks:

- **Auto-closed via refs**: Commits with "fixes #N", "closes #N", "resolves #N"
- **High confidence**: Fuzzy matching finds commits that match task keywords
- **Possibly completed**: Medium-confidence matches (review manually)
- **Still pending**: No matching commits found

Use `--auto` to automatically close high-confidence matches.

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
