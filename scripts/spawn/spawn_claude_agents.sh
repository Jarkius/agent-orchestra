#!/bin/bash

# Real Claude Sub-Agents Spawner
# Launches tmux session with real Claude CLI agents
# Each agent watches inbox and uses Claude CLI to process tasks

NUM_AGENTS=${1:-3}
SESSION="claude-agents-$$"
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

if ! command -v claude &> /dev/null; then
    echo "claude CLI not found. Make sure Claude Code is installed."
    exit 1
fi

# Clear previous session data
rm -f "$SCRIPT_DIR/agents.db"
rm -rf /tmp/agent_inbox
rm -rf /tmp/agent_outbox
rm -rf /tmp/agent_shared

echo "=============================================="
echo "   REAL CLAUDE SUB-AGENTS LAUNCHER"
echo "=============================================="
echo ""
echo "Starting $NUM_AGENTS Claude sub-agents..."
echo "Each agent will use REAL Claude CLI (your Max plan)"
echo ""

# Kill existing session if exists
tmux kill-session -t "$SESSION" 2>/dev/null

# Create new tmux session
tmux new-session -d -s "$SESSION" -x "$(tput cols)" -y "$(tput lines)"

# Split: info panel on top (20%), agents below (80%)
tmux split-window -v -t "$SESSION" -p 80

# Create agent panes based on count
case $NUM_AGENTS in
    1)
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
        tmux split-window -h -t "$SESSION:0.1"
        tmux split-window -h -t "$SESSION:0.1"
        tmux split-window -v -t "$SESSION:0.1"
        tmux split-window -v -t "$SESSION:0.2"
        tmux split-window -v -t "$SESSION:0.3"
        ;;
esac

# Enable mouse mode
tmux set-option -t "$SESSION" -g mouse on

# Info panel (pane 0) - show usage instructions
tmux send-keys -t "$SESSION:0.0" "clear && cat << 'EOF'

╔══════════════════════════════════════════════════════════════╗
║           CLAUDE SUB-AGENTS CONTROL CENTER                   ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  These are REAL Claude CLI instances!                        ║
║  They use your Max plan and can think, code, and solve.      ║
║                                                              ║
║  ASSIGN TASKS (from main Claude Code session):               ║
║  ─────────────────────────────────────────────               ║
║  Use MCP tools:                                              ║
║    assign_task(1, \"Write a hello world in Python\")           ║
║    broadcast_task(\"Review this code for bugs\")               ║
║    get_task_result(task_id, agent_id)                        ║
║                                                              ║
║  Or manually:                                                ║
║    echo '{\"id\":\"t1\",\"prompt\":\"What is 2+2?\"}' > \\         ║
║      /tmp/agent_inbox/1/task.json                            ║
║                                                              ║
║  MONITOR:                                                    ║
║    cat /tmp/agent_outbox/1/*.json                            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

Session: $SESSION
Agents: $NUM_AGENTS

Press Ctrl+C to exit this info panel.
EOF
" Enter

# Start agent watchers in each pane
for i in $(seq 1 $NUM_AGENTS); do
    pane=$i
    tmux send-keys -t "$SESSION:0.$pane" "cd '$SCRIPT_DIR' && bun run src/agent-watcher.ts $i" Enter
done

echo ""
echo "Session '$SESSION' created with $NUM_AGENTS REAL Claude agents!"
echo ""
echo "Layout:"
echo "  ┌────────────────────────────────────────────┐"
echo "  │           INFO / CONTROL CENTER            │"
echo "  ├──────────────┬──────────────┬──────────────┤"
echo "  │  Claude #1   │  Claude #2   │  Claude #3   │"
echo "  │  (real AI)   │  (real AI)   │  (real AI)   │"
echo "  └──────────────┴──────────────┴──────────────┘"
echo ""
echo "Each agent is a REAL Claude CLI instance using your Max plan!"
echo ""

# Attach to session
if [ -t 0 ]; then
    tmux attach-session -t "$SESSION"
else
    echo "To view the session, run:"
    echo "  tmux attach -t $SESSION"
    echo ""
    echo "To assign a task to Agent 1:"
    echo "  echo '{\"id\":\"test\",\"prompt\":\"What is 2+2?\"}' > /tmp/agent_inbox/1/task.json"
fi
