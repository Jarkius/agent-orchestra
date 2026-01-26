---
description: "Capture knowledge from file, URL, git repo, or manual"
---

# Memory Learn

Capture knowledge from files, URLs, git repos, or manually.

## Usage

```
/memory-learn <source>            Auto-detect and learn from source
/memory-learn ./path/file.md      Learn from local file
/memory-learn https://example.com Learn from URL
/memory-learn https://github.com/user/repo  Learn from git repo
/memory-learn HEAD~5              Learn from git commits
/memory-learn <category> "title"  Manual learning
```

## Actions

| Action | Description |
|--------|-------------|
| `<file>` | Learn from local file |
| `<url>` | Learn from web page |
| `<git-url>` | Clone and analyze repository |
| `HEAD~N` | Learn from last N commits |
| `<category> "title"` | Manual learning capture |

## Auto-Detection

The command auto-detects source type:
- Local paths → File analysis
- `http://` URLs → Web page fetch
- GitHub URLs → Repository analysis
- `HEAD~N` → Git commit analysis

## Categories

**Technical:** performance, architecture, tooling, process, debugging, security, testing

**Wisdom:** philosophy, principle, insight, pattern, retrospective

## Flags

| Flag | Description |
|------|-------------|
| `--lesson "..."` | Add lesson learned |
| `--prevention "..."` | Add prevention/application |
| `-i, --interactive` | Interactive mode with prompts |

## Examples

```bash
# Learn from documentation
/memory-learn ./docs/architecture.md

# Learn from web article
/memory-learn https://bun.sh/docs/api/websocket

# Learn from repository
/memory-learn https://github.com/anthropics/anthropic-sdk-python

# Learn from commits
/memory-learn HEAD~5

# Manual learning
/memory-learn architecture "Singleton pattern" --lesson "Use for global state"
```

## Instructions

Run the learn command:
```bash
bun memory learn $ARGUMENTS
```
