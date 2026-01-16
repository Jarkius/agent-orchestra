# Memory Save

Save the current session to SQLite and ChromaDB for later recall.

## Instructions

If arguments provided, run quick save:
```bash
bun memory save "$ARGUMENTS"
```

If no arguments, run interactive mode:
```bash
bun memory save
```

The save will:
1. Store session in SQLite (source of truth)
2. Index in ChromaDB (semantic search)
3. Auto-link to similar sessions
4. Optionally capture learnings

After saving, confirm the session ID and any auto-links created.
