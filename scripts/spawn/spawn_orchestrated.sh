#!/bin/bash

# Orchestrated Tmux Sub-Agent Spawn Test
# Features:
# - Central orchestrator pane (top)
# - Agent panes below with real-time status reporting
# - SQLite-based communication

NUM_AGENTS=${1:-3}
SESSION="orchestrated-$$"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors for agents
COLORS=(
    '\033[0;31m'  # Red
    '\033[0;32m'  # Green
    '\033[0;33m'  # Yellow
    '\033[0;34m'  # Blue
    '\033[0;35m'  # Magenta
    '\033[0;36m'  # Cyan
)
RESET='\033[0m'
BOLD='\033[1m'

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

# Kill existing session if exists
tmux kill-session -t "$SESSION" 2>/dev/null

echo "Creating orchestrated session with $NUM_AGENTS agents..."

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

# Create and run agent scripts
for i in $(seq 1 $NUM_AGENTS); do
    pane=$i  # Pane 0 is orchestrator, agents start at pane 1
    color="${COLORS[$(( (i-1) % ${#COLORS[@]} ))]}"

    agent_script=$(mktemp)
    cat > "$agent_script" << AGENT
#!/bin/bash
cd "$SCRIPT_DIR"

COLOR='$color'
RESET='$RESET'
BOLD='$BOLD'
ID=$i
PANE="$SESSION:0.$pane"

report() {
    bun run src/agent-report.ts "\$@" 2>/dev/null
}

clear
echo ""
echo -e "\${COLOR}\${BOLD}╔══════════════════════════════════════╗\${RESET}"
echo -e "\${COLOR}\${BOLD}║          SUB-AGENT \$ID                 ║\${RESET}"
echo -e "\${COLOR}\${BOLD}╚══════════════════════════════════════╝\${RESET}"
echo ""

# Register with orchestrator
report register \$ID "\$PANE" \$\$
report msg \$ID "Spawned (PID: \$\$)"

echo -e "\${COLOR}[Agent-\$ID]\${RESET} Registered with orchestrator"
sleep 1

report status \$ID "working" "Initializing"
echo -e "\${COLOR}[Agent-\$ID]\${RESET} Initializing..."
sleep 1

STEPS=\$((RANDOM % 3 + 2))
for s in \$(seq 1 \$STEPS); do
    report status \$ID "working" "Task \$s/\$STEPS"
    report msg \$ID "Processing task \$s/\$STEPS"
    echo -e "\${COLOR}[Agent-\$ID]\${RESET} Processing task \$s/\$STEPS..."
    sleep 1
done

report status \$ID "waiting" "Ready for input"
report msg \$ID "Ready for commands"
echo -e "\${COLOR}[Agent-\$ID]\${RESET} ✅ Initial tasks done!"
echo ""
echo -e "\${COLOR}[Agent-\$ID]\${RESET} 💬 Waiting for commands (type and press Enter)..."
echo ""

# Interactive loop - wait for commands from orchestrator
while true; do
    echo -ne "\${COLOR}agent-\$ID>\${RESET} "
    read -e cmd

    if [ -z "\$cmd" ]; then
        continue
    fi

    if [ "\$cmd" = "exit" ] || [ "\$cmd" = "quit" ]; then
        report status \$ID "completed" "Exited"
        report msg \$ID "Agent exited"
        echo -e "\${COLOR}[Agent-\$ID]\${RESET} Goodbye!"
        break
    fi

    # Detect source: [ORCH] prefix means from orchestrator
    if [[ "\$cmd" == "[ORCH]"* ]]; then
        cmd="\${cmd#[ORCH]}"  # Strip prefix
        SOURCE="orchestrator"
    else
        SOURCE="direct"
    fi

    # Echo back what we received with source
    report msg \$ID "[\$SOURCE] Received: \$cmd"
    echo -e "\${COLOR}[Agent-\$ID]\${RESET} [\$SOURCE] Received: \$cmd"

    # Simulate processing
    report status \$ID "working" "Processing command"
    sleep 1
    echo -e "\${COLOR}[Agent-\$ID]\${RESET} Processed: \$cmd"
    report status \$ID "waiting" "Ready for input"
done

rm -f "$agent_script"
AGENT
    chmod +x "$agent_script"

    tmux send-keys -t "$SESSION:0.$pane" "$agent_script" Enter
done

# Balance the agent panes layout (not including orchestrator)
sleep 0.5

echo ""
echo "Orchestrated session '$SESSION' created!"
echo ""
echo "Layout:"
echo "  ┌────────────────────────────────────┐"
echo "  │         ORCHESTRATOR               │"
echo "  ├──────────┬──────────┬──────────────┤"
echo "  │ Agent 1  │ Agent 2  │ Agent 3 ...  │"
echo "  └──────────┴──────────┴──────────────┘"
echo ""

# Attach to session
if [ -t 0 ]; then
    tmux attach-session -t "$SESSION"
else
    echo "To view the session, run:"
    echo "  tmux attach -t $SESSION"
fi
