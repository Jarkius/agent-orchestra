---
description: "Extract learnings from sessions. Use --all --yes for batch"
---

# Memory Distill

Extract learnings from past sessions.

## Usage

```
/memory-distill                   Distill from last session (interactive)
/memory-distill <session_id>      Distill from specific session
/memory-distill --all             Distill from ALL sessions
/memory-distill --yes             Auto-accept all learnings
/memory-distill --all --yes       Batch distill everything
```

## Actions

| Action | Description |
|--------|-------------|
| (none) | Distill from last session |
| `<session_id>` | Distill from specific session |

## Flags

| Flag | Description |
|------|-------------|
| `--all` | Process all sessions |
| `--yes` | Auto-accept learnings (no prompts) |
| `--last N` | Process last N sessions |

## What Gets Extracted

- **Wins** - Successes worth repeating
- **Challenges** - Problems that became lessons
- **Learnings** - Explicit insights from sessions

## Interactive Mode

For each potential learning:
- `Y` (default) - Save with suggested category
- `n` - Skip this learning
- `c` - Change category before saving
- `s` - Skip all remaining

## Examples

```bash
# Interactive distill from last session
/memory-distill

# Batch distill all sessions
/memory-distill --all --yes

# Distill last 5 sessions
/memory-distill --last 5
```

## Instructions

Run the distill command:
```bash
bun memory distill $ARGUMENTS
```
