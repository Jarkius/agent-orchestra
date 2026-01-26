# Memory Index

Hybrid code search - SQLite for fast lookups, ChromaDB for semantic search.

## Usage

```
/memory-index                     Show index status
/memory-index once                Full index of codebase
/memory-index once --force        Re-index all files
/memory-index find "name"         Fast file/symbol lookup (SQLite)
/memory-index search "query"      Semantic code search
/memory-index symbol "name"       Find function/class with line numbers
/memory-index pattern "name"      Find design patterns
/memory-index analyze             Run pattern analysis on all files
/memory-index grep "text"         Smart grep (SQLite narrows, then grep)
```

## Actions

| Action | Description |
|--------|-------------|
| (none) | Show index status |
| `once` | Full index of codebase |
| `find` | Fast file/symbol lookup (<2ms) |
| `search` | Semantic code search (~400ms) |
| `symbol` | Find function/class with line numbers |
| `pattern` | Find design patterns (Factory, Retry, etc.) |
| `analyze` | Run pattern analysis on all files |
| `grep` | Smart grep with SQLite pre-filtering |
| `health` | Check SQLite ↔ ChromaDB sync |

## Flags

| Flag | Description |
|------|-------------|
| `--force` | Re-index all files (with `once`) |
| `--lang` | Filter by language (with `grep`) |
| `--in` | Filter by path pattern (with `grep`) |
| `--limit` | Limit results |

## Examples

```bash
# Fast lookups (no model load)
/memory-index find "daemon"
/memory-index symbol "connectToHub"
/memory-index pattern "Retry"

# Semantic search
/memory-index search "authentication flow"

# Smart grep
/memory-index grep "WebSocket" --in matrix
```

## Instructions

Run the index command:
```bash
bun memory index $ARGUMENTS
```
