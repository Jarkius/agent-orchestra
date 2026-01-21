---
description: "Save session context, git state, tasks, and learnings for later recall. Use before reset or ending work."
---

# Memory Save

Save the current session to SQLite and ChromaDB for later recall.

## Usage

```
/memory-save [summary]
```

## What Gets Auto-Captured

With `--auto` mode (default when Claude runs this):
- **User messages**: From Claude Code's history.jsonl
- **Tasks**: From your todo list (done/pending/in_progress)
- **Plan file**: Recent plan if exists
- **Git context**: Branch, commits, files changed
- **Duration**: Calculated from session timestamps

## What YOU (Claude) Provide

- **Summary**: 1-2 sentence description of what was accomplished
- **Learnings**: Any insights worth remembering (via `bun memory learn`)

## Instructions

**IMPORTANT**: Always use `--auto` mode with a summary you generate.

1. Review what was accomplished in this session
2. Write a concise summary (1-2 sentences)
3. Run the save command:

```bash
bun memory save --auto "Your summary of what was accomplished in this session"
```

The script will auto-capture from Claude Code files:
- User messages from `~/.claude/history.jsonl`
- Tasks from `~/.claude/todos/`
- Recent plan files from `~/.claude/plans/`
- Git context (branch, commits, files)

4. After saving, optionally add learnings with structured fields:

```bash
bun memory learn insight "What you learned" --lesson "Key insight" --prevention "How to apply"
```

Or use interactive mode for detailed context:
```bash
bun memory learn -i
```

## Examples

```bash
# Good: Specific summary
bun memory save --auto "Implemented auto-capture from Claude Code files for memory save"

# Good: Bug fix summary
bun memory save --auto "Fixed timezone display in recall output - was showing UTC instead of local"

# Good: Feature work
bun memory save --auto "Added YAML frontmatter to slash commands for better descriptions"
```

## After Saving

Confirm to the user:
- Session ID created
- Number of tasks captured
- Any auto-linked sessions
