---
description: "Get relevant background for a new session. Includes recent work, related sessions, and key learnings."
---

# Memory Context

Get a context bundle for starting a new session with relevant background.

## Usage

```
/memory-context [search query]
```

## Examples

```bash
# General context (recent sessions + learnings)
/memory-context

# Context for specific topic
/memory-context "authentication"
/memory-context "database optimization"
/memory-context "API design patterns"
```

## What It Returns

### Quick Stats
- Total sessions and commits
- Top tags used

### Recent Sessions
- Last 3 sessions with summaries
- Git context captured

### Relevant Context (if query provided)
- Related sessions by semantic similarity
- Related learnings with scores

### Key Learnings
- High-confidence learnings
- Validated insights

## When to Use

- Starting work on a topic you've worked on before
- Resuming after a break
- Getting oriented in a new session
- Finding relevant past decisions

## Instructions

Run the context command:
```bash
bun memory context "$ARGUMENTS"
```

If arguments provided, they're used as a search query to find relevant context.
Present the context to help the user get oriented.
