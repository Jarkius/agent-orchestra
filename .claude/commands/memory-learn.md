---
description: "Capture learnings with smart auto-detect (file, URL, YouTube, git) or structured fields. Quick knowledge capture."
---

# Memory Learn

Smart learning capture with auto-detection or manual structured fields.

## Usage

```
# Smart Mode (auto-detects input type)
/memory-learn ./docs/file.md              # Learn from file
/memory-learn https://example.com/article # Learn from URL
/memory-learn https://youtube.com/watch?v=x # Learn from YouTube
/memory-learn HEAD~3                       # Learn from git commits

# Traditional Mode
/memory-learn <category> "title" [--lesson "..."] [--prevention "..."]
```

## Examples

```bash
# Smart auto-detect
/memory-learn ./README.md                  # Extract key points from file
/memory-learn HEAD~5                       # Learn from last 5 commits
/memory-learn https://blog.example.com/post # Fetch and extract from URL

# Traditional with structured fields
/memory-learn architecture "Dual-storage pattern" --lesson "SQLite for truth, ChromaDB for search" --prevention "Design dual-storage from start"

# Interactive mode (prompts for all fields)
/memory-learn -i
/memory-learn --interactive
```

## Categories

**Technical** (7):
- `performance` - Speed, memory, optimization
- `architecture` - System design, patterns
- `tooling` - Tools, configs, CLI
- `process` - Workflow, methodology
- `debugging` - Problem diagnosis, errors
- `security` - Auth, vulnerabilities
- `testing` - Test strategies, coverage

**Wisdom** (5):
- `philosophy` - Core beliefs, approaches
- `principle` - Guiding rules, values
- `insight` - Deep realizations, "aha" moments
- `pattern` - Recurring observations
- `retrospective` - Lessons from experience

## Structured Fields

Each learning can have three structured fields:
- **what_happened**: The situation/context (use positional arg or interactive)
- **lesson**: What you learned (`--lesson "..."`)
- **prevention**: How to prevent/apply (`--prevention "..."`)

## Instructions

Run the learn command:
```bash
bun memory learn $ARGUMENTS
```

For detailed context capture, use interactive mode:
```bash
bun memory learn -i
```

Confirm the learning ID and any auto-linked learnings.
