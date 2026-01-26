---
description: "Save session. Use --full for distillation later"
---

# Memory Save

Save current session for later recall.

## Usage

```
/memory-save                      Quick save with auto-summary
/memory-save "summary"            Save with custom summary
/memory-save --full               Full context save for distillation
```

## Actions

| Action | Description |
|--------|-------------|
| (none) | Quick save with auto-generated summary |
| `"summary"` | Save with custom summary text |

## Flags

| Flag | Description |
|------|-------------|
| `--full` | Include wins, challenges, learnings for distillation |

## What Gets Auto-Captured

- User messages from session
- Tasks (done/pending/in_progress)
- Plan files if exists
- Git context (branch, commits, files)
- Duration from timestamps

## Full Save (--full)

Use before ending a productive session. Captures:
- Wins (what worked well)
- Challenges (what was difficult)
- Learnings (insights worth remembering)
- Next steps (what's left to do)

Then `/memory-distill` can extract learnings later.

## Examples

```bash
# Quick save
/memory-save

# Save with summary
/memory-save "Implemented authentication flow"

# Full save for distillation
/memory-save --full
```

## Instructions

For quick save:
```bash
bun memory save --auto "$ARGUMENTS"
```

For `--full`, analyze the conversation and run:
```bash
bun memory save --auto "SUMMARY" --wins "WIN1" --challenges "CHALLENGE1" --learnings "LEARNING1"
```
