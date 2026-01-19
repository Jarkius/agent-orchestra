#!/bin/bash

# Tmux Split-Pane Sub-Agent Spawn Test
# Each agent runs in its own tmux pane for visual parallel execution

NUM_AGENTS=${1:-3}
SESSION="agents-$$"

# Colors for each agent
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

# Check for tmux
if ! command -v tmux &> /dev/null; then
    echo "tmux not found. Install with: brew install tmux"
    exit 1
fi

# Create inline agent function as a here-doc script
run_agent() {
    local id=$1
    local color=$2

    clear
    echo ""
    echo -e "${color}${BOLD}╔══════════════════════════════════════╗${RESET}"
    echo -e "${color}${BOLD}║          SUB-AGENT $id                 ║${RESET}"
    echo -e "${color}${BOLD}╚══════════════════════════════════════╝${RESET}"
    echo ""

    echo -e "${color}[Agent-$id]${RESET} 🚀 Spawned (PID: $$)"
    sleep 1

    echo -e "${color}[Agent-$id]${RESET} 📋 Initializing..."
    sleep 1

    local steps=$((RANDOM % 4 + 2))
    for s in $(seq 1 $steps); do
        echo -e "${color}[Agent-$id]${RESET} ⚙️  Processing task $s/$steps..."
        sleep 1
    done

    echo -e "${color}[Agent-$id]${RESET} ✅ COMPLETED!"
    echo ""
    echo -e "${color}[Done - press Enter to close]${RESET}"
    read
}
export -f run_agent
export RESET BOLD

# Kill existing session if exists
tmux kill-session -t "$SESSION" 2>/dev/null

# Create new tmux session
tmux new-session -d -s "$SESSION" -x "$(tput cols)" -y "$(tput lines)"

# Create panes based on agent count
case $NUM_AGENTS in
    1)
        # Single pane, no splits needed
        ;;
    2)
        tmux split-window -h -t "$SESSION"
        ;;
    3)
        tmux split-window -h -t "$SESSION"
        tmux split-window -v -t "$SESSION:0.0"
        ;;
    4)
        tmux split-window -h -t "$SESSION"
        tmux split-window -v -t "$SESSION:0.0"
        tmux split-window -v -t "$SESSION:0.1"
        ;;
    5)
        tmux split-window -h -t "$SESSION"
        tmux split-window -v -t "$SESSION:0.0"
        tmux split-window -v -t "$SESSION:0.1"
        tmux split-window -v -t "$SESSION:0.2"
        ;;
    *)
        tmux split-window -h -t "$SESSION"
        tmux split-window -v -t "$SESSION:0.0"
        tmux split-window -v -t "$SESSION:0.1"
        tmux split-window -v -t "$SESSION:0.2"
        tmux split-window -v -t "$SESSION:0.3"
        ;;
esac

# Balance the layout
tmux select-layout -t "$SESSION" tiled

# Enable mouse mode for easier pane navigation
tmux set-option -t "$SESSION" -g mouse on

# Send agent command to each pane
for i in $(seq 1 $NUM_AGENTS); do
    pane=$((i - 1))
    color="${COLORS[$(( (i-1) % ${#COLORS[@]} ))]}"

    # Create a temp script for this agent
    agent_script=$(mktemp)
    cat > "$agent_script" << AGENT
#!/bin/bash
RESET='$RESET'
BOLD='$BOLD'
COLOR='$color'
ID=$i

clear
echo ""
echo -e "\${COLOR}\${BOLD}╔══════════════════════════════════════╗\${RESET}"
echo -e "\${COLOR}\${BOLD}║          SUB-AGENT \$ID                 ║\${RESET}"
echo -e "\${COLOR}\${BOLD}╚══════════════════════════════════════╝\${RESET}"
echo ""

echo -e "\${COLOR}[Agent-\$ID]\${RESET} 🚀 Spawned (PID: \$\$)"
sleep 1

echo -e "\${COLOR}[Agent-\$ID]\${RESET} 📋 Initializing..."
sleep 1

STEPS=\$((RANDOM % 4 + 2))
for s in \$(seq 1 \$STEPS); do
    echo -e "\${COLOR}[Agent-\$ID]\${RESET} ⚙️  Processing task \$s/\$STEPS..."
    sleep 1
done

echo -e "\${COLOR}[Agent-\$ID]\${RESET} ✅ COMPLETED!"
echo ""
echo -e "\${COLOR}[Done - press Enter to close]\${RESET}"
read
rm -f "$agent_script"
AGENT
    chmod +x "$agent_script"

    tmux send-keys -t "$SESSION:0.$pane" "$agent_script" Enter
done

# Attach to session or show instructions
echo "Launching tmux session with $NUM_AGENTS agents..."
sleep 0.5

if [ -t 0 ]; then
    # Running in a real terminal, attach directly
    tmux attach-session -t "$SESSION"
else
    # Not a TTY, provide instructions
    echo ""
    echo "tmux session '$SESSION' created with $NUM_AGENTS agents running!"
    echo ""
    echo "To view the session, run in Ghostty:"
    echo "  tmux attach -t $SESSION"
    echo ""
    echo "Or list sessions:"
    echo "  tmux ls"
fi
