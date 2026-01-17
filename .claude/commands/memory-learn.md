---
description: "Capture a learning with structured fields (what happened, lesson, prevention). Quick knowledge capture."
---

# Memory Learn

Capture a learning or insight with optional structured fields.

## Usage

```
/memory-learn <category> "title" [--lesson "..."] [--prevention "..."]
```

## Examples

```bash
# Simple learning
/memory-learn insight "Tests document behavior"

# With structured fields
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
