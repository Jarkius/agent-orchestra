#!/bin/bash

# Colors for Ghostty terminal visualization
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

AGENT_COLORS=("$RED" "$GREEN" "$YELLOW" "$BLUE" "$MAGENTA" "$CYAN")
NUM_AGENTS=${1:-3}
TEMP_DIR=$(mktemp -d)

timestamp() {
    date "+%H:%M:%S.%3N"
}

log_main() {
    echo -e "${BOLD}${CYAN}[$(timestamp)] [Main Agent]${RESET} $1"
}

log_agent() {
    local id=$1
    local msg=$2
    local color=${AGENT_COLORS[$((id % ${#AGENT_COLORS[@]}))]}
    echo -e "${color}[$(timestamp)] [Sub-Agent-$id]${RESET} $msg"
}

run_sub_agent() {
    local id=$1
    local status_file="$TEMP_DIR/agent_$id"

    log_agent $id "🚀 Spawned (PID: $$)"

    # Simulate initialization
    sleep 0.5
    log_agent $id "📋 Initializing task..."

    # Simulate work with progress
    local work_time=$((RANDOM % 3 + 1))
    for step in $(seq 1 $work_time); do
        sleep 1
        log_agent $id "⚙️  Working... (step $step/$work_time)"
    done

    # Simulate completion
    log_agent $id "✅ COMPLETED task"
    echo "done" > "$status_file"
}

# Main workflow
clear
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}       Sub-Agent Spawn Test for Ghostty (macOS)${RESET}"
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo ""

log_main "🎬 Initializing workflow with $NUM_AGENTS agents..."
sleep 0.5

log_main "📡 Spawning sub-agents..."
echo ""

for i in $(seq 1 $NUM_AGENTS); do
    run_sub_agent $i &
    sleep 0.2  # Stagger spawns for clearer visualization
done

echo ""
log_main "⏳ Waiting for sub-agents to report back..."

wait

echo ""
log_main "📊 Checking results..."
completed=$(ls "$TEMP_DIR" 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
if [ "$completed" -eq "$NUM_AGENTS" ]; then
    echo -e "${GREEN}${BOLD}✅ All $NUM_AGENTS sub-agents finished successfully!${RESET}"
else
    echo -e "${RED}${BOLD}⚠️  Only $completed/$NUM_AGENTS agents completed${RESET}"
fi
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"

# Cleanup
rm -rf "$TEMP_DIR"

