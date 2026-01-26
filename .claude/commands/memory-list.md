# Memory List

Browse sessions and learnings.

## Usage

```
/memory-list                      Show recent items
/memory-list sessions             List work sessions
/memory-list learnings            List captured learnings
/memory-list learnings --category architecture
```

## Actions

| Action | Description |
|--------|-------------|
| (none) | Show recent sessions and learnings |
| `sessions` | List work sessions with summaries |
| `learnings` | List captured learnings by category |

## Flags

| Flag | Description |
|------|-------------|
| `--limit N` | Limit results (default: 10) |
| `--category CAT` | Filter learnings by category |
| `--confidence LVL` | Filter by confidence (low/medium/high/proven) |
| `-i, --interactive` | Interactive browser mode |

## Session List Shows

- Session ID and summary
- Tags and task counts
- Duration and commit count
- Created timestamp

## Learning List Shows

Grouped by category with confidence badges:
- `○` low
- `✓` high
- `⭐` proven

## Categories

architecture, debugging, performance, tooling, process, security, testing, philosophy, insight, pattern

## Examples

```bash
# List recent sessions
/memory-list sessions --limit 5

# List architecture learnings
/memory-list learnings --category architecture

# Interactive browser
/memory-list -i
```

## Instructions

Run the list command:
```bash
bun memory list $ARGUMENTS
```
