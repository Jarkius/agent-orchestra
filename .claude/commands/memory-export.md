---
description: "Export learnings to LEARNINGS.md for documentation. Organizes by category with confidence badges."
---

# Memory Export

Export learnings to a markdown file for documentation or sharing.

## Usage

```
/memory-export [output_path]
```

## Examples

```bash
# Export to default LEARNINGS.md
/memory-export

# Export to custom path
/memory-export ./docs/LEARNINGS.md
/memory-export ~/notes/claude-learnings.md
```

## Output Format

The generated markdown includes:

### Header
- Total learnings count
- Export timestamp
- Confidence distribution

### Categories
Organized by category with badges:
- `[PROVEN]` - Validated 3+ times
- `[HIGH]` - Validated 2 times
- `[MEDIUM]` - User confirmed
- `[LOW]` - Quick capture or distilled

### Structured Lesson Format
Each learning is exported with:
- Title and date
- Category and confidence badge
- **What happened**: Situation/context
- **What I learned**: Key insight
- **How to prevent**: Future application

## Example Output

```markdown
# Architecture

## Lesson: Dual-storage pattern
**Date**: 2026-01-17
**Category**: Architecture
**Confidence**: [high] (2x)

### What happened
Building memory systems needing both structured queries and semantic search

### What I learned
SQLite as source of truth, ChromaDB as search index. Sync on write.

### How to prevent
Design dual-storage from the start; avoid migrating later

---

## Lesson: Simplicity over cleverness
**Date**: 2026-01-16
**Category**: Philosophy
**Confidence**: [PROVEN] (5x)

### What happened
Code review revealed over-engineered solution

### What I learned
Readable code beats clever code

### How to prevent
Ask: Would a junior dev understand this in 6 months?
```

## Instructions

Run the export command:
```bash
bun memory export $ARGUMENTS
```

After export, confirm the file path and category breakdown.
