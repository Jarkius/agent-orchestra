# Memory Issue

Report issues for awareness and tracking across the shared memory system.

## Usage

```
/memory-issue "Title" [--severity level] [--component name]
```

## Examples

```bash
# Critical ChromaDB corruption
/memory-issue "Database disk image malformed" -s critical -c chromadb

# High severity with repro steps
/memory-issue "Save hangs on slow connection" -s high -c memory --repro "1. Slow network 2. Run save"

# Medium with known fix
/memory-issue "Search misses recent items" -s medium -c vector --fix "Run reindex"
```

## Severity Levels

- `critical` - System broken, data loss risk
- `high` - Major functionality impacted
- `medium` - Annoying but workarounds exist
- `low` - Minor issue, nice to fix

## Components

`chromadb`, `sqlite`, `memory`, `mcp`, `agent`, `cli`, `vector`, `other`

## Instructions

Run the issue command:
```bash
bun memory issue "$ARGUMENTS"
```

If no arguments provided, show help:
```bash
bun memory issue --help
```

After reporting, confirm the issue ID and suggest how to query issues later.
