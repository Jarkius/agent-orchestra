#!/bin/bash
# voice-bridge.sh - Bridge Agent Orchestra output to Matrix voice system
#
# Usage: ./voice-bridge.sh "message" [agent]
#
# Agents: Oracle, Neo, Tank, Smith, Scribe, Mainframe, Trinity, Morpheus, Architect
#
# Examples:
#   ./voice-bridge.sh "Learning captured with high confidence" "Scribe"
#   ./voice-bridge.sh "Task completed successfully" "Neo"
#   ./voice-bridge.sh "System health check passed" "Tank"

MESSAGE="${1:-}"
AGENT="${2:-Oracle}"

# Find The Matrix voice system
MATRIX_PATHS=(
    "/Users/jarkius/workspace/The-matrix/psi/matrix/voice.sh"
    "$HOME/workspace/The-matrix/psi/matrix/voice.sh"
    "$(dirname "$0")/../../../The-matrix/psi/matrix/voice.sh"
)

VOICE_SCRIPT=""
for path in "${MATRIX_PATHS[@]}"; do
    if [[ -f "$path" ]]; then
        VOICE_SCRIPT="$path"
        break
    fi
done

if [[ -z "$VOICE_SCRIPT" ]]; then
    # Fallback: just echo the message
    echo "[$AGENT] $MESSAGE"
    exit 0
fi

if [[ -z "$MESSAGE" ]]; then
    echo "Usage: voice-bridge.sh \"message\" [agent]"
    echo "Agents: Oracle, Neo, Tank, Smith, Scribe, Mainframe, Trinity, Morpheus, Architect"
    exit 1
fi

# Speak via Matrix voice system
sh "$VOICE_SCRIPT" "$MESSAGE" "$AGENT"
