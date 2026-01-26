---
description: "Ralph Loop"
---

# Ralph Loop

Start an iterative development loop using the Ralph Wiggum technique.

## Arguments

- `--max-iterations N`: Maximum iterations (default: unlimited)
- `--completion-promise 'TEXT'`: Promise phrase to output when done
- `PROMPT`: The task to work on

## Instructions

Execute the Ralph setup script from the installed plugin:

```bash
/Users/jarkius/.claude/plugins/cache/ralph-wiggum/ralph-wiggum/1.0.0/scripts/setup-ralph-loop.sh $ARGUMENTS
```

After the loop is initialized, display the completion promise if set:

```bash
if [ -f .claude/ralph-loop.local.md ]; then
  PROMISE=$(grep '^completion_promise:' .claude/ralph-loop.local.md | sed 's/completion_promise: *//' | sed 's/^"\(.*\)"$/\1/')
  if [ -n "$PROMISE" ] && [ "$PROMISE" != "null" ]; then
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "CRITICAL - Ralph Loop Completion Promise"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "To complete this loop, output this EXACT text:"
    echo "  <promise>$PROMISE</promise>"
    echo ""
    echo "STRICT REQUIREMENTS:"
    echo "  ✓ The statement MUST be completely and unequivocally TRUE"
    echo "  ✓ Do NOT output false statements to exit the loop"
    echo "═══════════════════════════════════════════════════════════"
  fi
fi
```

Work on the task. When you try to exit, the Ralph stop hook will feed the SAME PROMPT back for the next iteration. Your work persists in files and git history, allowing iterative improvement.

**CRITICAL**: Only output `<promise>TEXT</promise>` when the promise statement is genuinely TRUE.
