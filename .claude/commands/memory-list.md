---
description: "Browse recent sessions or learnings. Shows summaries, tags, task counts, and confidence levels."
---

# Memory List

List recent sessions or learnings with details.

## Usage

```
/memory-list [sessions|learnings] [-i|--interactive]
```

## Examples

```bash
# List recent sessions (default)
/memory-list
/memory-list sessions
/memory-list s

# List recent learnings grouped by category
/memory-list learnings
/memory-list l

# Interactive session browser
/memory-list -i
/memory-list sessions -i
```

## Session List Shows

- Session ID
- Summary (truncated)
- Tags
- Task counts (done/pending/blocked)
- Duration and commit count
- Created timestamp (local time)

## Learning List Shows

Grouped by category:
- Learning ID with confidence badge
- Title
- Validation count

Confidence badges:
- `○` low
- `✓` high
- `⭐` proven

## Instructions

Run the list command:
```bash
bun memory list $ARGUMENTS
```

Arguments:
- `sessions` or `s` - List recent sessions
- `learnings` or `l` - List recent learnings
- `-i` or `--interactive` - Interactive session browser

If no argument, default to sessions.

## Interactive Mode

Use `-i` flag for interactive browsing:
- Arrow keys to navigate sessions
- Enter to view full session details (summary, tasks, git context)
- Back to return to list
- Quit to exit
