# Memory Help

Quick reference for all memory system commands.

## Commands Overview

| Command | Purpose |
|---------|---------|
| `/memory-status` | Check system health |
| `/memory-init` | Initialize all components |
| `/memory-help` | Show this help |

### Session Commands

| Command | Purpose |
|---------|---------|
| `/memory-save` | Save current session |
| `/memory-save --full` | Save with full context for distillation |
| `/memory-recall` | Resume or search sessions |
| `/memory-recall "query" --expand` | Search with query expansion |

### Learning Commands

| Command | Purpose |
|---------|---------|
| `/memory-learn <source>` | Capture knowledge (file/URL/git) |
| `/memory-distill` | Extract learnings from sessions |
| `/memory-distill --all --yes` | Batch distill all sessions |
| `/memory-list sessions` | Browse sessions |
| `/memory-list learnings` | Browse learnings |
| `/memory-validate` | Increase learning confidence |

### Task Commands

| Command | Purpose |
|---------|---------|
| `/memory-task` | List pending tasks |
| `/memory-task sync` | Sync with GitHub + gap analysis |
| `/memory-task sync --auto` | Sync + auto-close completed |
| `/memory-task "title" --system` | Create system task |
| `/memory-task <id> done` | Complete a task |

### Code Index Commands

| Command | Purpose |
|---------|---------|
| `/memory-index` | Show index status |
| `/memory-index once --force` | Re-index all files |
| `/memory-index find "name"` | Fast file/symbol lookup |
| `/memory-index search "query"` | Semantic code search |
| `/memory-index symbol "name"` | Find with line numbers |
| `/memory-index pattern "name"` | Find design patterns |

### Matrix Commands

| Command | Purpose |
|---------|---------|
| `/matrix` | Show connection status |
| `/matrix connect` | Connect to Matrix Hub |
| `/matrix watch` | Live message feed |
| `/matrix send "msg"` | Broadcast message |
| `/matrix send "msg" --to name` | Direct message |

### Maintenance Commands

| Command | Purpose |
|---------|---------|
| `/memory-stats` | View statistics |
| `/memory-export` | Generate LEARNINGS.md |
| `/memory-purge sessions --keep 10` | Clean old sessions |
| `/memory-reindex` | Rebuild vector indexes |
| `/memory-reset` | Delete everything (dangerous!) |

## Convention

- **Actions** (no dashes): `sync`, `find`, `connect`
- **Flags** (with `--`): `--auto`, `--force`, `--expand`

## CLI Equivalents

All slash commands map to `bun memory <cmd>`:

```bash
/memory-status        → bun memory status
/memory-task sync     → bun memory task:sync
/memory-index find x  → bun memory index find x
/matrix send "hi"     → bun memory message "hi"
```

## Instructions

Display this help reference to the user.
