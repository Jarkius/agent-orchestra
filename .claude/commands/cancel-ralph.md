# Cancel Ralph

Terminate an active Ralph loop.

## Instructions

Remove the state file to stop the loop:

```bash
if [ -f .claude/ralph-loop.local.md ]; then
  rm -f .claude/ralph-loop.local.md
  echo "Ralph loop canceled"
else
  echo "No active Ralph loop"
fi
```
