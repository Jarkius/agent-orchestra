#!/bin/bash

# MCP-Enabled Orchestrated Tmux Sub-Agent Spawn Test
# Features:
# - Central orchestrator pane (top)
# - Agent panes running Bun watcher (MCP-enabled)
# - File-based messaging for reliable code/multi-line input

NUM_AGENTS=${1:-3}
SESSION="mcp-agents-$$"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check dependencies
if ! command -v tmux &> /dev/null; then
    echo "tmux not found. Install with: brew install tmux"
    exit 1
fi

if ! command -v bun &> /dev/null; then
    echo "bun not found. Install from: https://bun.sh"
    exit 1
fi

# Clear previous session data
rm -f "$SCRIPT_DIR/agents.db"
rm -rf /tmp/agent_inbox
rm -rf /tmp/agent_outbox

# Kill existing session if exists
tmux kill-session -t "$SESSION" 2>/dev/null

echo "Creating MCP-enabled session with $NUM_AGENTS agents..."

# Create new tmux session with orchestrator in main pane
tmux new-session -d -s "$SESSION" -x "$(tput cols)" -y "$(tput lines)"

# Split: orchestrator on top (30%), agents below (70%)
tmux split-window -v -t "$SESSION" -p 70

# Create agent panes based on count
case $NUM_AGENTS in
    1)
        # Single agent pane already exists
        ;;
    2)
        tmux split-window -h -t "$SESSION:0.1"
        ;;
    3)
        tmux split-window -h -t "$SESSION:0.1"
        tmux split-window -h -t "$SESSION:0.1"
        ;;
    4)
        tmux split-window -h -t "$SESSION:0.1"
        tmux split-window -v -t "$SESSION:0.1"
        tmux split-window -v -t "$SESSION:0.2"
        ;;
    *)
        # For 5+, create a 3x2 grid
        tmux split-window -h -t "$SESSION:0.1"
        tmux split-window -h -t "$SESSION:0.1"
        tmux split-window -v -t "$SESSION:0.1"
        tmux split-window -v -t "$SESSION:0.2"
        tmux split-window -v -t "$SESSION:0.3"
        ;;
esac

# Enable mouse mode
tmux set-option -t "$SESSION" -g mouse on

# Start orchestrator in pane 0 (pass session name)
tmux send-keys -t "$SESSION:0.0" "cd '$SCRIPT_DIR' && TMUX_SESSION='$SESSION' bun run src/orchestrator.ts" Enter

# Start agent watchers in each pane
for i in $(seq 1 $NUM_AGENTS); do
    pane=$i  # Pane 0 is orchestrator, agents start at pane 1
    tmux send-keys -t "$SESSION:0.$pane" "cd '$SCRIPT_DIR' && bun run src/agent-watcher.ts $i" Enter
done

# Balance the layout
sleep 0.5

echo ""
echo "MCP-enabled session '$SESSION' created!"
echo ""
echo "Layout:"
echo "  ┌────────────────────────────────────┐"
echo "  │         ORCHESTRATOR               │"
echo "  ├──────────┬──────────┬──────────────┤"
echo "  │ Agent 1  │ Agent 2  │ Agent 3 ...  │"
echo "  │ (watcher)│ (watcher)│ (watcher)    │"
echo "  └──────────┴──────────┴──────────────┘"
echo ""
echo "Agents are now watching for messages in /tmp/agent_inbox/{id}/"
echo ""
echo "To send a message to agent 1:"
echo "  echo 'your message' > /tmp/agent_inbox/1/msg_\$(date +%s).txt"
echo ""
echo "Or use MCP tools from Claude Code after adding the server config."
echo ""

# Attach to session
if [ -t 0 ]; then
    tmux attach-session -t "$SESSION"
else
    echo "To view the session, run:"
    echo "  tmux attach -t $SESSION"
fi
