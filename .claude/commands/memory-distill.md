---
description: "Extract learnings from past sessions. Distill wins, challenges, and insights into structured knowledge."
---

# Memory Distill

Extract learnings from past sessions and save them as structured knowledge.

## Usage

```
/memory-distill [session_id] [--last N] [--yes]
```

## Examples

```bash
# From last session (interactive)
/memory-distill

# From specific session
/memory-distill session_1768648290468

# From last 5 sessions
/memory-distill --last 5

# Auto-accept all suggestions (batch mode)
/memory-distill --yes
/memory-distill --last 5 --yes
```

## What Gets Extracted

The distill process scans session context for:
- **Learnings**: Explicit insights captured during the session
- **Wins**: Successes that often contain reusable patterns
- **Challenges**: Problems faced that became lessons learned

## Interactive Mode

For each potential learning, you can:
- `Y` (default) - Save with suggested category
- `n` - Skip this learning
- `c` - Change category before saving
- `s` - Skip all remaining learnings

After accepting, you'll be prompted for structured fields:
- **What happened**: The situation/context
- **What did you learn**: The key insight
- **How to prevent/apply**: Future application

## Confidence

Distilled learnings start at `low` confidence. Use `bun memory validate_learning <id>` to increase confidence when a learning proves useful.

## Instructions

Run the distill command:
```bash
bun memory distill $ARGUMENTS
```

Review each extracted learning and add structured context when prompted.
