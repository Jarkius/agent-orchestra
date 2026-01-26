---
description: "Resume or search sessions. Use --expand for variants"
---

# Memory Recall

Search past sessions and learnings, or resume previous work.

## Usage

```
/memory-recall                    Resume last session context
/memory-recall "query"            Search sessions and learnings
/memory-recall "query" --expand   Search with query expansion
/memory-recall session_123        Lookup specific session
/memory-recall #5                 Lookup learning by ID
```

## Actions

| Action | Description |
|--------|-------------|
| (none) | Resume context from last session |
| `"query"` | Search for matching sessions/learnings |
| `session_ID` | Lookup specific session |
| `#N` | Lookup learning by ID |

## Flags

| Flag | Description |
|------|-------------|
| `--expand` | Generate synonyms and variants for better recall |
| `--limit N` | Limit results |

## Resume Mode (No Args)

Shows comprehensive context:
- Recent plan files
- Current git status
- Pending tasks
- Session context (wins, challenges, next steps)
- Related sessions
- Key learnings

## Query Expansion (--expand)

Generates synonyms and variants:
- "auth flow" → "authentication flow", "login flow"
- "error handling" → "exception handling", "fault tolerance"

## Examples

```bash
# Resume last session
/memory-recall

# Search for topic
/memory-recall "WebSocket reconnection"

# Search with expansion
/memory-recall "error handling" --expand

# Lookup specific session
/memory-recall session_1768632008430
```

## Instructions

Run the recall command:
```bash
bun memory recall $ARGUMENTS
```
