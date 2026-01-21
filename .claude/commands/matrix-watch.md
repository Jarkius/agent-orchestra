---
description: "Open tmux pane with live matrix message feed. Shows real-time cross-matrix communication."
---

# Matrix Watch

Open a tmux pane showing live matrix messages in real-time.

## Usage

```
/matrix-watch
```

## What It Does

1. **Creates tmux session** (if not exists) - Named `matrix-watch`
2. **Starts watch process** - Runs `bun memory watch` for SSE streaming
3. **Attaches or notifies** - Shows how to view the pane

## Instructions

Run the following to start the matrix watch pane:

```bash
# Check if session exists, create if not
if ! tmux has-session -t matrix-watch 2>/dev/null; then
  tmux new-session -d -s matrix-watch -n watch "cd $(pwd) && bun memory watch"
  echo "Created tmux session 'matrix-watch'"
else
  # Session exists, check if watch is running
  tmux send-keys -t matrix-watch:watch "bun memory watch" Enter 2>/dev/null || true
  echo "Session 'matrix-watch' already exists"
fi

echo ""
echo "To view: tmux attach -t matrix-watch"
echo "To detach: Ctrl+B then D"
```

After running, tell the user:
- Session name: `matrix-watch`
- View command: `tmux attach -t matrix-watch`
- Detach with: `Ctrl+B` then `D`
- Messages appear in real-time as they arrive
