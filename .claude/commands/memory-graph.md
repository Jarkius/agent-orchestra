---
description: "Explore knowledge graph: list entities, find related concepts, discover paths between entities."
---

# Memory Graph

Explore the knowledge graph built from learnings. Shows entity relationships, co-occurrence, and paths.

## Usage

```
/memory-graph [entity1] [entity2] [--mermaid]
```

## Modes

### List Entities (no args)
```
/memory-graph
```
Shows top entities ranked by learning count. Good starting point to explore the graph.

### Related Entities (one arg)
```
/memory-graph "memory"
/memory-graph "typescript"
```
Shows:
- Learnings containing this entity
- Related entities (co-occur in learnings)
- Relationship strength (shared learning count)

### Find Path (two args)
```
/memory-graph "memory" "chromadb"
/memory-graph "testing" "architecture"
```
Finds shortest path between two entities through shared learnings. Useful for discovering connections.

### Mermaid Diagrams
```
/memory-graph "memory" --mermaid
/memory-graph "A" "B" --mermaid
```
Adds a mermaid diagram to the output for visualization.

## Example Output

```
════════════════════════════════════════════════════════════
  ENTITY: MEMORY
════════════════════════════════════════════════════════════

────────────────────────────────────────
  LEARNINGS
────────────────────────────────────────
  #251 Statusline threshold compensation [proven]
  #260 Spawn script path fix [high]

────────────────────────────────────────
  RELATED ENTITIES
────────────────────────────────────────
  chromadb        ████ 4 shared
  vector          ███ 3 shared
  embedding       ██ 2 shared
```

## Instructions

Run the graph command:
```bash
bun memory graph $ARGUMENTS
```

Summarize the graph structure and any interesting relationships found.
