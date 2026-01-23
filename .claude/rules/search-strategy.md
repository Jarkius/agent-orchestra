# Search Strategy

When searching for code, prefer semantic search over text-based tools.

## Semantic Code Search First

For code-related queries, use the `search_code` MCP tool or `bun memory index search`:

| Task | Tool | Why |
|------|------|-----|
| Find implementations | `search_code` | Understands code meaning |
| Locate similar code | `search_code` | Vector similarity |
| Find patterns/concepts | `search_code` | Semantic matching |
| Architecture exploration | `search_code` | Cross-file understanding |
| Config/exact strings | `grep` | Literal text matching |
| File discovery | `glob` | Pattern matching |

## Usage

```bash
# Via CLI
bun memory index search "authentication middleware"
bun memory index search "database connection" --lang ts
bun memory index search "error handling" --limit 20

# Via MCP tool
search_code("authentication middleware", { limit: 10 })
search_code("api endpoints", { language: "typescript" })
```

## When to Use grep/glob Instead

- **Exact string matches**: Looking for specific function name `handleAuth`
- **Non-code files**: Searching markdown, config, JSON
- **Regex patterns**: Complex text patterns
- **Quick filename lookup**: When you know the file pattern

## Search Flow

1. **Code question?** → Try `search_code` first
2. **No results?** → Check if index exists (`bun memory index status`)
3. **Need exact match?** → Fall back to `grep`
4. **Finding files?** → Use `glob`

## Index Maintenance

```bash
# Index codebase (run once or after major changes)
bun memory index once

# Check index status
bun memory index status

# Auto-update daemon (keeps index fresh)
bun memory indexer start
```

## Why Semantic Search

- Finds conceptually related code, not just keyword matches
- Understands function purpose, not just names
- Works across languages (TypeScript, Python, Go, etc.)
- Handles synonyms and variations naturally
