---
description: "Validate learnings to increase confidence. Use when a learning proves useful."
---

# Memory Validate

Increase confidence of learnings when they prove useful in practice.

## Usage

```
/memory-validate <learning_id> [learning_id2] [learning_id3]
```

## Examples

```bash
# Validate single learning
/memory-validate 258

# Validate multiple learnings
/memory-validate 258 259 260
```

## Confidence Levels

Learnings progress through confidence levels:
- `low` → Initial state (newly captured)
- `medium` → Validated 2x
- `high` → Validated 4x
- `proven` → Validated 6x+

Higher confidence learnings are prioritized in search results and context injection.

## Instructions

Use the MCP tool to validate each learning ID provided:

```
mcp__agent-orchestrator__validate_learning(learning_id: <id>)
```

For multiple IDs, call the tool for each one in parallel.

After validation, report:
- Learning title
- Previous confidence → New confidence
- Times validated
- Hint for next level

## When to Validate

Validate a learning when:
- You applied it successfully in the current session
- The user confirms it was helpful
- You see it working in practice

Don't validate just because it exists - validation means "this proved useful."
