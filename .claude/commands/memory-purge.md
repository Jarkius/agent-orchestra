---
description: "Selectively delete sessions or learnings. Supports --keep N, --before DATE for controlled cleanup."
---

# Memory Purge

Selectively purge sessions or learnings from memory.

## Usage

```
/memory-purge <target> [options]
```

## Examples

```bash
# Purge all sessions (prompts for confirmation)
/memory-purge sessions

# Purge all learnings
/memory-purge learnings

# Keep last 10 sessions, purge the rest
/memory-purge sessions --keep 10

# Purge old data before a date
/memory-purge sessions --before 2025-01-01

# Skip confirmation prompt
/memory-purge sessions --yes
/memory-purge learnings -y
```

## Targets

| Target | Alias | What Gets Purged |
|--------|-------|------------------|
| `sessions` | `s` | Sessions, tasks, session links |
| `learnings` | `l` | Learnings, learning links |

## Options

| Option | Description |
|--------|-------------|
| `--keep N` | Keep the last N items, purge the rest |
| `--before DATE` | Purge items before this date (ISO format) |
| `--yes`, `-y` | Skip confirmation prompt |

## Safety

- Always prompts for confirmation (unless `--yes`)
- Shows current stats before purging
- Shows what was purged after completion
- ChromaDB vectors are cleaned alongside SQLite

## Instructions

Run the purge command:
```bash
bun memory purge $ARGUMENTS
```

Show the user what was purged and new stats after completion.
