# Semantic Code Search

Vector-based code understanding that finds code by meaning, not just keywords.

## Overview

Traditional grep/grep-based search finds exact text matches. Semantic search understands what code *does*, enabling searches like:

- "authentication middleware" → finds auth-related code even if it doesn't use those exact words
- "database connection pooling" → finds connection management code
- "error handling patterns" → finds try/catch, Result types, error callbacks

## Quick Start

```bash
# 1. Index your codebase (one-time)
bun memory index once

# 2. Search semantically
bun memory index search "authentication"

# 3. (Optional) Start auto-update daemon
bun memory indexer start
```

## Commands

### Indexing

| Command | Description |
|---------|-------------|
| `bun memory index once` | Full codebase index |
| `bun memory index once --force` | Re-index all files |
| `bun memory index status` | Show index statistics |

### Searching

| Command | Description |
|---------|-------------|
| `bun memory index search "query"` | Search by meaning |
| `bun memory index search "q" --lang ts` | Filter by language |
| `bun memory index search "q" --limit 20` | Limit results |

### Daemon (Auto-Update)

| Command | Description |
|---------|-------------|
| `bun memory indexer start` | Start file watcher daemon |
| `bun memory indexer stop` | Stop daemon |
| `bun memory indexer status` | Check daemon status |

### Codebase Map

| Command | Description |
|---------|-------------|
| `bun memory map` | Generate and display map |
| `bun memory map --update` | Update CLAUDE.md |
| `bun memory map --output FILE` | Output to file |

## MCP Tool

The `search_code` MCP tool provides programmatic access:

```typescript
// Search for authentication code
search_code("authentication middleware", { limit: 10 })

// Filter by language
search_code("api endpoints", { language: "typescript" })

// Get more results
search_code("error handling", { limit: 50 })
```

## How It Works

### Indexing Pipeline

1. **File Discovery** - Scans codebase respecting `.gitignore`
2. **Language Detection** - Identifies TypeScript, Python, Go, etc.
3. **Chunking** - Splits files into semantic units (functions, classes)
4. **Embedding** - Converts code to vector representations
5. **Storage** - Stores in ChromaDB for fast similarity search

### Search Process

1. **Query Embedding** - Convert search query to vector
2. **Similarity Search** - Find nearest code vectors
3. **Ranking** - Score by relevance and recency
4. **Results** - Return file paths, snippets, and relevance scores

## Supported Languages

| Language | Extensions | Features Extracted |
|----------|------------|-------------------|
| TypeScript | `.ts`, `.tsx` | Functions, classes, interfaces, exports |
| JavaScript | `.js`, `.jsx` | Functions, classes, exports |
| Python | `.py` | Functions, classes, decorators |
| Go | `.go` | Functions, types, interfaces |
| Rust | `.rs` | Functions, structs, traits, impls |
| Java | `.java` | Methods, classes, interfaces |
| Kotlin | `.kt` | Functions, classes, data classes |
| Swift | `.swift` | Functions, classes, structs |
| Ruby | `.rb` | Methods, classes, modules |
| PHP | `.php` | Functions, classes |
| C/C++ | `.c`, `.cpp`, `.h` | Functions, structs, classes |
| C# | `.cs` | Methods, classes, interfaces |
| Bash | `.sh` | Functions |
| SQL | `.sql` | Statements |
| Markdown | `.md` | Sections, headers |
| JSON/YAML/TOML | Various | Structure |

## When to Use Semantic vs Text Search

| Need | Tool | Example |
|------|------|---------|
| Find by concept | `search_code` | "authentication" |
| Similar implementations | `search_code` | "database pooling" |
| Pattern exploration | `search_code` | "error handling" |
| Exact string match | `grep` | "handleAuth" |
| Regex patterns | `grep` | "function\\s+\\w+" |
| File discovery | `glob` | "*.test.ts" |
| Config values | `grep` | "API_KEY" |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Code Indexer                    │
├─────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐            │
│  │ File Watcher │  │   Chunker    │            │
│  │  (chokidar)  │  │ (by language)│            │
│  └──────┬───────┘  └──────┬───────┘            │
│         │                 │                     │
│         ▼                 ▼                     │
│  ┌──────────────────────────────────┐          │
│  │     Embedding Provider           │          │
│  │  (nomic-embed-text-v1.5)        │          │
│  └──────────────┬───────────────────┘          │
│                 │                               │
│                 ▼                               │
│  ┌──────────────────────────────────┐          │
│  │         ChromaDB                 │          │
│  │    (code_index collection)       │          │
│  └──────────────────────────────────┘          │
└─────────────────────────────────────────────────┘
```

## Indexer Daemon

The indexer daemon is a background process that watches for file changes and updates the index automatically. It follows the same pattern as the matrix-daemon for consistency.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Indexer Daemon                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  HTTP API    │    │ File Watcher │    │  CodeIndexer │  │
│  │  (port 37889)│    │  (chokidar)  │    │   instance   │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         │   /status ────────┼───────────────────┤           │
│         │   /reindex ───────┼───────────────────┤           │
│         │   /search ────────┼───────────────────┤           │
│         │   /stop ──────────┼───────────────────┤           │
│         │                   │                   │           │
│         │                   ▼                   ▼           │
│         │            File Events          ChromaDB          │
│         │            (add/change/         (code_index       │
│         │             unlink)              collection)      │
│         │                   │                   │           │
└─────────┼───────────────────┼───────────────────┼───────────┘
          │                   │                   │
          ▼                   ▼                   ▼
    CLI/Status           Index Updates      Vector Storage
```

### Lifecycle Management

**PID File:** `~/.indexer-daemon/daemon.pid`

Contains three lines:
```
<process_id>
<http_port>
<root_path>
```

**Startup Sequence:**
1. Check if already running (read PID file, verify process exists)
2. Check if port is in use by another daemon
3. Write PID file
4. Start HTTP API server
5. Initialize CodeIndexer
6. Start file watcher (optionally run initial index with `--initial`)
7. Register signal handlers (SIGINT, SIGTERM)

**Shutdown Sequence:**
1. Stop file watcher
2. Close HTTP server
3. Remove PID file
4. Exit process

### HTTP API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Health check with full statistics |
| `/health` | GET | Alias for `/status` |
| `/reindex` | POST | Trigger re-index (use `?force=true` for full) |
| `/search?q=...` | GET | Search indexed code |
| `/stop` | POST | Graceful shutdown |

**Example `/status` Response:**
```json
{
  "status": "running",
  "rootPath": "/path/to/project",
  "watcherActive": true,
  "startTime": "2024-01-23T10:00:00.000Z",
  "uptime": 3600,
  "stats": {
    "totalFiles": 100,
    "indexedFiles": 95,
    "skippedFiles": 5,
    "errors": 0,
    "lastIndexedAt": "2024-01-23T10:30:00.000Z"
  },
  "vectorStats": {
    "totalDocuments": 12375,
    "languages": { "typescript": 608, "markdown": 284 }
  }
}
```

### Starting the Daemon

```bash
# Start watching only (assumes index exists)
bun memory indexer start

# Start with initial full index
bun memory indexer start --initial

# Check status
bun memory indexer status

# Stop daemon
bun memory indexer stop

# Restart (stop + start)
bun memory indexer restart
```

### File Watcher Behavior

The daemon uses [chokidar](https://github.com/paulmillr/chokidar) for file watching:

- **Events monitored:** `add`, `change`, `unlink`
- **Debounce:** 300ms stability threshold before processing
- **Ignored patterns:** `node_modules`, `.git`, `dist`, `build`, etc.
- **Max file size:** 500KB (larger files skipped)

**Supported file types:**
- TypeScript/JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`)
- Python (`.py`)
- Go (`.go`)
- Rust (`.rs`)
- And many more (see Supported Languages section)

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `INDEXER_DAEMON_PORT` | `37889` | HTTP API port |
| `INDEXER_ROOT_PATH` | `process.cwd()` | Root path to watch |
| `INDEXER_DAEMON_DIR` | `~/.indexer-daemon` | PID file directory |

### Integration with Other Daemons

The indexer daemon runs alongside other system daemons:

| Daemon | Port | Purpose |
|--------|------|---------|
| Matrix Hub | 8081 | Cross-matrix messaging |
| Matrix Daemon | 37888 | Hub connection manager |
| **Indexer Daemon** | **37889** | Code index auto-update |

Check all with: `bun memory status`

### Troubleshooting

**Daemon won't start:**
```bash
# Check if already running
bun memory indexer status

# Check port in use
lsof -i :37889

# Remove stale PID file
rm ~/.indexer-daemon/daemon.pid
```

**Watcher not detecting changes:**
```bash
# Restart with fresh state
bun memory indexer stop
bun memory indexer start --initial
```

**High CPU usage:**
- Large codebases may cause high CPU during initial index
- The watcher is lightweight after initial indexing
- Consider excluding more directories via `.gitignore`

## Best Practices

### Index Management

1. **Initial Index** - Run `bun memory index once` after cloning
2. **Daemon for Active Development** - Use `bun memory indexer start`
3. **Periodic Refresh** - Re-index monthly with `--force`

### Search Tips

1. **Be Conceptual** - Describe what the code does, not exact names
2. **Use Domain Terms** - "OAuth flow" not "auth function"
3. **Combine with Traditional** - Use grep for exact matches after semantic discovery

### Performance

- Index operations are CPU-intensive (embedding)
- First index takes longest (all files)
- Incremental updates are fast
- Keep ChromaDB running for best performance

## Troubleshooting

### No Results

```bash
# Check if index exists
bun memory index status

# Re-index if needed
bun memory index once
```

### Slow Indexing

- Embedding model downloads on first use (~500MB)
- Large codebases take longer
- Use `--force` sparingly (re-indexes everything)

### Stale Results

```bash
# Restart daemon
bun memory indexer stop
bun memory indexer start --initial
```

### ChromaDB Issues

```bash
# If ChromaDB is not running
docker start chromadb

# Check health
curl http://localhost:8100/api/v2/heartbeat
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROMA_URL` | `http://localhost:8100` | ChromaDB URL |
| `EMBEDDING_MODEL` | `nomic-embed-text-v1.5` | Embedding model |
| `INDEXER_DAEMON_PORT` | `37889` | Daemon HTTP API port |
