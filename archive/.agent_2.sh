#!/bin/bash
COLOR='\033[0;32m'
RESET='\033[0m'
BOLD='\033[1m'

clear
echo ""
echo -e "${COLOR}${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${COLOR}${BOLD}║          SUB-AGENT 2                 ║${RESET}"
echo -e "${COLOR}${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""

echo -e "${COLOR}[Agent-2]${RESET} 🚀 Spawned (PID: $$)"
sleep 1

echo -e "${COLOR}[Agent-2]${RESET} 📋 Initializing..."
sleep 1

STEPS=$((RANDOM % 4 + 2))
for s in $(seq 1 $STEPS); do
    echo -e "${COLOR}[Agent-2]${RESET} ⚙️  Processing task $s/$STEPS..."
    sleep 1
done

echo -e "${COLOR}[Agent-2]${RESET} ✅ COMPLETED!"
echo ""
read -p "Press Enter to close..."
