# Memory-First Workflow

Before suggesting workflows, patterns, or tools - search for proven learnings.

## Search First

```bash
bun memory recall "topic keywords"
```

**When to search:**
- Before suggesting any tool or pattern
- Before "how to" approaches
- When unsure about project conventions

Proven learnings (20x+ validated) should inform suggestions.

## Memory Commands

| Command | Purpose |
|---------|---------|
| `recall [query]` | Search or resume sessions |
| `learn <cat> "title"` | Capture knowledge |
| `distill` | Extract from sessions |
| `context "query"` | Get relevant background |
| `stats` | View statistics |
| `export` | Generate LEARNINGS.md |

## Categories

**Technical:** performance, architecture, tooling, process, debugging, security, testing

**Wisdom:** philosophy, principle, insight, pattern, retrospective

## Confidence Levels

```
low → medium → high → proven (20x+ validated)
```

## Quick Patterns

```bash
# Resume last session
bun memory recall

# Search specific topic
bun memory recall "authentication patterns"

# Learn from code/docs
bun memory learn ./path/to/file.md

# Learn from URL
bun memory learn https://example.com/article

# Learn from git repo
bun memory learn https://github.com/user/repo.git

# Capture manual learning
bun memory learn architecture "Title" "Context"
```
