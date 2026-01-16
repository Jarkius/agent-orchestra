#!/bin/bash

# Ghostty Native Split-Pane Sub-Agent Spawn Test
# Uses Ghostty's built-in splits via keybindings
# Run this from within Ghostty terminal

NUM_AGENTS=${1:-3}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors
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

# Create individual agent scripts
create_agent() {
    local id=$1
    local color="${COLORS[$(( (id-1) % ${#COLORS[@]} ))]}"
    local script="$SCRIPT_DIR/.agent_$id.sh"

    cat > "$script" << AGENT
#!/bin/bash
COLOR='$color'
RESET='$RESET'
BOLD='$BOLD'

clear
echo ""
echo -e "\${COLOR}\${BOLD}╔══════════════════════════════════════╗\${RESET}"
echo -e "\${COLOR}\${BOLD}║          SUB-AGENT $id                 ║\${RESET}"
echo -e "\${COLOR}\${BOLD}╚══════════════════════════════════════╝\${RESET}"
echo ""

echo -e "\${COLOR}[Agent-$id]\${RESET} 🚀 Spawned (PID: \$\$)"
sleep 1

echo -e "\${COLOR}[Agent-$id]\${RESET} 📋 Initializing..."
sleep 1

STEPS=\$((RANDOM % 4 + 2))
for s in \$(seq 1 \$STEPS); do
    echo -e "\${COLOR}[Agent-$id]\${RESET} ⚙️  Processing task \$s/\$STEPS..."
    sleep 1
done

echo -e "\${COLOR}[Agent-$id]\${RESET} ✅ COMPLETED!"
echo ""
read -p "Press Enter to close..."
AGENT
    chmod +x "$script"
    echo "$script"
}

# Check if running in Ghostty
if [ "$TERM_PROGRAM" != "ghostty" ]; then
    echo -e "${BOLD}Note: This script works best when run inside Ghostty terminal${RESET}"
    echo ""
fi

echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║     Ghostty Sub-Agent Spawn Test - $NUM_AGENTS Agents            ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "This will create splits using Ghostty keybindings."
echo -e "Default Ghostty split keys:"
echo -e "  ${BOLD}Cmd+D${RESET}        - Split right"
echo -e "  ${BOLD}Cmd+Shift+D${RESET}  - Split down"
echo ""
echo -e "${BOLD}Creating agent scripts...${RESET}"

# Create all agent scripts
for i in $(seq 1 $NUM_AGENTS); do
    script=$(create_agent $i)
    echo -e "  Agent $i: $script"
done

echo ""
echo -e "${BOLD}To run manually:${RESET}"
echo -e "1. Create splits with Cmd+D or Cmd+Shift+D"
echo -e "2. In each pane, run:"
for i in $(seq 1 $NUM_AGENTS); do
    echo -e "   ${COLORS[$(( (i-1) % ${#COLORS[@]} ))]}$SCRIPT_DIR/.agent_$i.sh${RESET}"
done

echo ""
echo -e "${BOLD}Or press Enter to auto-launch with AppleScript...${RESET}"
read

# Auto-launch using AppleScript
echo -e "Launching agents in Ghostty splits..."

# First agent runs in current pane
"$SCRIPT_DIR/.agent_1.sh" &
FIRST_PID=$!

sleep 0.5

# Create splits and launch remaining agents
for i in $(seq 2 $NUM_AGENTS); do
    # Alternate between horizontal and vertical splits
    if [ $((i % 2)) -eq 0 ]; then
        # Horizontal split (Cmd+D)
        osascript -e 'tell application "System Events" to keystroke "d" using command down' 2>/dev/null
    else
        # Vertical split (Cmd+Shift+D)
        osascript -e 'tell application "System Events" to keystroke "D" using {command down, shift down}' 2>/dev/null
    fi

    sleep 0.5

    # Type command in new pane
    osascript -e "tell application \"System Events\" to keystroke \"$SCRIPT_DIR/.agent_$i.sh\"" 2>/dev/null
    osascript -e 'tell application "System Events" to key code 36' 2>/dev/null

    sleep 0.3
done

wait $FIRST_PID 2>/dev/null
