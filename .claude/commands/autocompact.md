---
description: "Autocompact Settings"
---

# Autocompact Settings

Configure `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` for context window management.

## Usage

```
/autocompact [value]
```

## Examples

```bash
# Show current setting and recommendation
/autocompact

# Set to 75% (recommended for this project)
/autocompact 75

# Set to different value
/autocompact 80
```

## Value Guide

| Value | Behavior | Best For |
|-------|----------|----------|
| 95 (default) | Maximum context, compacts late | Short sessions |
| 80-85 | Good balance, ~15-20% headroom | Most dev work |
| 70-75 | Earlier compaction, safer buffer | Long sessions, orchestration |
| 50-60 | Very aggressive | Memory-constrained |

**Recommended for this project: 75%** (agent orchestration, matrix messaging, long sessions)

## Instructions

1. Check if `.envrc` exists and read current value:
```bash
cat .envrc 2>/dev/null || echo "(no .envrc)"
```

2. If no argument provided (`$ARGUMENTS` is empty):
   - Show current setting from .envrc (if any)
   - Show recommended value (75 for this project)
   - Show the value guide table above
   - Remind user: "Run `/autocompact 75` to apply recommended setting"

3. If argument provided (e.g., `$ARGUMENTS` = "75"):
   - Validate it's a number between 1-100
   - If `.envrc` exists and has `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`:
     - Update the existing line
   - Else:
     - Append `export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=<value>` to `.envrc`
   - Run `direnv allow` if direnv is available, otherwise remind user to source it
   - Confirm: "Set autocompact to X%. Restart Claude or run `source .envrc` to apply."

4. If invalid argument:
   - Show error and valid range (1-100)
