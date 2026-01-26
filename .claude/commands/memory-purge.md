---
description: "Delete old sessions/learnings. Use --keep N to retain recent"
---

# Memory Purge

Selectively delete old sessions or learnings.

## Usage

```
/memory-purge sessions            Purge sessions (prompts first)
/memory-purge learnings           Purge learnings
/memory-purge sessions --keep 10  Keep last 10, purge rest
/memory-purge sessions --before 2024-01-01
```

## Actions

| Action | Description |
|--------|-------------|
| `sessions` | Purge sessions and related data |
| `learnings` | Purge learnings |

## Flags

| Flag | Description |
|------|-------------|
| `--keep N` | Keep last N items, purge rest |
| `--before DATE` | Purge items before date (ISO format) |
| `--duplicates` | Remove duplicate learnings |
| `--yes, -y` | Skip confirmation prompt |

## Safety

- Always prompts for confirmation (unless `--yes`)
- Shows stats before purging
- Cannot be undone

## Examples

```bash
# Preview what would be deleted
/memory-purge sessions

# Keep only last 20 sessions
/memory-purge sessions --keep 20 --yes

# Delete old data
/memory-purge sessions --before 2024-06-01 --yes

# Remove duplicate learnings
/memory-purge learnings --duplicates
```

## Instructions

Run the purge command:
```bash
bun memory purge $ARGUMENTS
```
