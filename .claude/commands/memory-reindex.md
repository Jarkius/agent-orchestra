---
description: "Re-index SQLite data into ChromaDB vectors. Use after data changes or to fix vector search."
---

# Memory Reindex

Re-index all SQLite data into ChromaDB for vector search.

## Usage

```
/memory-reindex [type]
```

## Examples

```bash
# Re-index everything
/memory-reindex

# Re-index only sessions
/memory-reindex sessions

# Re-index only learnings
/memory-reindex learnings
```

## When to Use

- After importing/migrating data
- If vector search returns stale results
- After manual database edits
- To rebuild the search index

## Instructions

Run the reindex command:
```bash
bun memory reindex $ARGUMENTS
```

Report the results:
- Number of sessions re-indexed
- Number of learnings re-indexed
- Any errors encountered
