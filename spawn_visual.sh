#!/bin/bash

# Visual Sub-Agent Spawn Test with panes (tmux or Ghostty)
# Usage: ./spawn_visual.sh [num_agents] [mode]
# Modes: tmux, ghostty, auto (default)

NUM_AGENTS=${1:-3}
MODE=${2:-auto}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_SCRIPT="$SCRIPT_DIR/agent_worker.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

detect_mode() {
    if [ "$MODE" != "auto" ]; then
        echo "$MODE"
        return
    fi

    if [ -n "$TMUX" ]; then
        echo "tmux"
    elif [ "$TERM_PROGRAM" = "ghostty" ]; then
        echo "ghostty"
    elif command -v tmux &> /dev/null; then
        echo "tmux"
    else
        echo "fallback"
    fi
}

create_agent_script() {
    cat > "$AGENT_SCRIPT" << 'WORKER'
#!/bin/bash
AGENT_ID=$1
AGENT_COLOR=$2
RESET='\033[0m'
BOLD='\033[1m'

log() {
    echo -e "${AGENT_COLOR}${BOLD}[Sub-Agent-$AGENT_ID]${RESET} $1"
}

clear
echo ""
echo -e "${AGENT_COLOR}${BOLD}╔════════════════════════════════════╗${RESET}"
echo -e "${AGENT_COLOR}${BOLD}║        SUB-AGENT $AGENT_ID              ║${RESET}"
echo -e "${AGENT_COLOR}${BOLD}╚════════════════════════════════════╝${RESET}"
echo ""

log "🚀 Spawned (PID: $$)"
sleep 1

log "📋 Initializing..."
sleep 1

STEPS=$((RANDOM % 4 + 2))
for i in $(seq 1 $STEPS); do
    log "⚙️  Working... step $i/$STEPS"
    sleep 1
done

log "✅ COMPLETED!"
echo ""
echo -e "${AGENT_COLOR}Press any key to close...${RESET}"
read -n 1
WORKER
    chmod +x "$AGENT_SCRIPT"
}

COLORS=(
    '\033[0;31m'  # Red
    '\033[0;32m'  # Green
    '\033[0;33m'  # Yellow
    '\033[0;34m'  # Blue
    '\033[0;35m'  # Magenta
    '\033[0;36m'  # Cyan
)

run_tmux() {
    SESSION="spawn-test-$$"

    # Create new session with first agent
    tmux new-session -d -s "$SESSION" -x 120 -y 40

    # Create layout based on agent count
    if [ "$NUM_AGENTS" -ge 2 ]; then
        tmux split-window -h -t "$SESSION"
    fi
    if [ "$NUM_AGENTS" -ge 3 ]; then
        tmux split-window -v -t "$SESSION:0.0"
    fi
    if [ "$NUM_AGENTS" -ge 4 ]; then
        tmux split-window -v -t "$SESSION:0.1"
    fi
    if [ "$NUM_AGENTS" -ge 5 ]; then
        tmux split-window -v -t "$SESSION:0.2" 2>/dev/null || true
    fi
    if [ "$NUM_AGENTS" -ge 6 ]; then
        tmux split-window -v -t "$SESSION:0.3" 2>/dev/null || true
    fi

    # Send commands to each pane
    for i in $(seq 1 $NUM_AGENTS); do
        pane_idx=$((i - 1))
        color="${COLORS[$((i % ${#COLORS[@]}))]}"
        tmux send-keys -t "$SESSION:0.$pane_idx" "$AGENT_SCRIPT $i '$color'" Enter 2>/dev/null || true
    done

    # Attach to session
    tmux select-layout -t "$SESSION" tiled
    tmux attach-session -t "$SESSION"
}

run_ghostty() {
    echo -e "${CYAN}${BOLD}Launching $NUM_AGENTS agents in Ghostty windows...${RESET}"

    for i in $(seq 1 $NUM_AGENTS); do
        color="${COLORS[$((i % ${#COLORS[@]}))]}"
        # Open new Ghostty window for each agent
        osascript -e "
            tell application \"Ghostty\"
                activate
                delay 0.3
                tell application \"System Events\"
                    keystroke \"n\" using command down
                end tell
            end tell
        " 2>/dev/null &

        sleep 0.5
        # Run command in new window
        osascript -e "
            tell application \"System Events\"
                tell process \"Ghostty\"
                    keystroke \"$AGENT_SCRIPT $i '$color'\"
                    key code 36
                end tell
            end tell
        " 2>/dev/null &
    done

    echo -e "${GREEN}Agents launched in separate windows${RESET}"
}

run_ghostty_tabs() {
    echo -e "${CYAN}${BOLD}Launching $NUM_AGENTS agents in Ghostty tabs...${RESET}"

    # Use Ghostty's keybinding for new tabs
    for i in $(seq 1 $NUM_AGENTS); do
        color="${COLORS[$((i % ${#COLORS[@]}))]}"

        if [ $i -eq 1 ]; then
            # First agent runs in current tab
            "$AGENT_SCRIPT" "$i" "$color" &
        else
            # Subsequent agents in new tabs via keybinding
            osascript -e '
                tell application "System Events"
                    tell process "Ghostty"
                        keystroke "t" using command down
                    end tell
                end tell
            ' 2>/dev/null
            sleep 0.3
            osascript -e "
                tell application \"System Events\"
                    tell process \"Ghostty\"
                        keystroke \"$AGENT_SCRIPT $i '$color'\"
                        key code 36
                    end tell
                end tell
            " 2>/dev/null
        fi
        sleep 0.3
    done
}

run_fallback() {
    echo -e "${CYAN}${BOLD}Running agents in background (no tmux/Ghostty detected)${RESET}"
    echo -e "Install tmux for split-pane view: ${GREEN}brew install tmux${RESET}"
    echo ""

    # Fall back to original behavior
    "$SCRIPT_DIR/spawn_test.sh" "$NUM_AGENTS"
}

# Main
create_agent_script

DETECTED_MODE=$(detect_mode)
echo -e "${BOLD}Mode: $DETECTED_MODE${RESET}"

case "$DETECTED_MODE" in
    tmux)
        run_tmux
        ;;
    ghostty)
        run_ghostty_tabs
        ;;
    *)
        run_fallback
        ;;
esac
