# Search Strategy

Use hybrid search - it auto-routes to the fastest method for each query type.

## Quick Reference

| Need | Command | Speed |
|------|---------|-------|
| Find file by name | `bun memory index find "daemon"` | <2ms |
| Find function/class | `bun memory index find "connectToHub"` | <2ms |
| Exact string in code | `bun memory index grep "pattern"` | ~26ms |
| Conceptual search | `bun memory index search "how auth works"` | ~400ms |
| Auto-route (best) | `bun memory index hybrid "query"` | varies |

## Hybrid Search (Recommended)

The `search_code` MCP tool and `hybrid` CLI command auto-route:

```bash
# These auto-pick the best method:
bun memory index hybrid "connectToHub"       # → SQLite (exact match)
bun memory index hybrid "authentication"     # → Semantic (conceptual)
```

## Smart Grep (12x Faster Than Regular Grep)

SQLite narrows files first, then grep searches only those:

```bash
# Search all indexed files (no node_modules noise!)
bun memory index grep "WebSocket"

# Filter by file name/path
bun memory index grep "TODO" --in matrix

# Filter by language
bun memory index grep "import" --lang typescript
```

**Performance:** 26ms vs 300ms for regular grep (12x faster)

## Fast File Lookup (400x Faster Than Glob)

SQLite-indexed file and symbol search:

```bash
bun memory index find "daemon"           # Files with 'daemon' in path
bun memory index find "connectToHub"     # Files containing this function
bun memory index files --lang typescript # List all TS files
```

**Performance:** <2ms vs 800ms for glob (400x faster)

## Semantic Search (Conceptual)

For "how does X work" type questions:

```bash
bun memory index search "authentication middleware"
bun memory index search "error handling patterns"
```

## Decision Flow

```
┌─────────────────────────────────────────────────────┐
│  What are you looking for?                          │
└─────────────────────┬───────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   File/Symbol    Exact String   Concept
        │             │             │
        ▼             ▼             ▼
   index find    index grep    index search
     (<2ms)        (~26ms)       (~400ms)
```

## When to Still Use Regular Grep

- Searching non-indexed files (node_modules, generated)
- Complex regex patterns
- Files not yet indexed

## Index Maintenance

```bash
bun memory index once              # Full index (first time)
bun memory index once --force      # Re-index all files
bun memory index health            # Check SQLite ↔ ChromaDB sync
bun memory indexer start           # Auto-update on file changes
```
