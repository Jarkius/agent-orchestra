#!/bin/bash

# Real Claude Sub-Agents Spawner
# Launches tmux session with real Claude CLI agents
# Each agent watches inbox and uses Claude CLI to process tasks

NUM_AGENTS=${1:-3}
SESSION="claude-agents-$$"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

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

# ============================================
# ChromaDB Server Management
# ============================================
CHROMA_PORT=${CHROMA_PORT:-8100}
CHROMA_CONTAINER=${CHROMA_CONTAINER:-chromadb}
export CHROMA_URL="http://localhost:$CHROMA_PORT"

echo "Checking ChromaDB server..."

# Check if ChromaDB is already running
if curl -s "http://localhost:$CHROMA_PORT/api/v2/heartbeat" > /dev/null 2>&1; then
    echo "  ✓ ChromaDB already running on port $CHROMA_PORT"
else
    echo "  Starting ChromaDB server..."

    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        echo "  ⚠ Docker not found. ChromaDB server mode requires Docker."
        echo "  Install Docker or run ChromaDB manually: chroma run --path ./chroma_data --port $CHROMA_PORT"
        echo "  Continuing without server mode (embedded mode will be used)..."
        unset CHROMA_URL
    else
        # Try to start existing container first
        if docker start "$CHROMA_CONTAINER" > /dev/null 2>&1; then
            echo "  ✓ Started existing ChromaDB container"
        else
            # Create new container with auto-restart
            echo "  Creating new ChromaDB container..."
            docker run -d \
                --name "$CHROMA_CONTAINER" \
                --restart unless-stopped \
                -p "$CHROMA_PORT:8000" \
                -v "$PROJECT_ROOT/chroma_data:/data" \
                chromadb/chroma > /dev/null 2>&1

            if [ $? -eq 0 ]; then
                echo "  ✓ ChromaDB container created"
            else
                echo "  ⚠ Failed to create ChromaDB container"
                echo "  Continuing without server mode..."
                unset CHROMA_URL
            fi
        fi

        # Wait for ChromaDB to become healthy
        if [ -n "$CHROMA_URL" ]; then
            echo "  Waiting for ChromaDB to be ready..."
            for i in {1..30}; do
                if curl -s "http://localhost:$CHROMA_PORT/api/v2/heartbeat" > /dev/null 2>&1; then
                    echo "  ✓ ChromaDB ready on port $CHROMA_PORT"
                    break
                fi
                sleep 1
            done

            # Final check
            if ! curl -s "http://localhost:$CHROMA_PORT/api/v2/heartbeat" > /dev/null 2>&1; then
                echo "  ⚠ ChromaDB failed to start within timeout"
                unset CHROMA_URL
            fi
        fi
    fi
fi

echo ""

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
ChromaDB: ${CHROMA_URL:-embedded mode}

Press Ctrl+C to exit this info panel.
EOF
" Enter

# Start agent watchers in each pane (with CHROMA_URL if set)
for i in $(seq 1 $NUM_AGENTS); do
    pane=$i
    if [ -n "$CHROMA_URL" ]; then
        tmux send-keys -t "$SESSION:0.$pane" "cd '$PROJECT_ROOT' && CHROMA_URL='$CHROMA_URL' bun run src/agent-watcher.ts $i" Enter
    else
        tmux send-keys -t "$SESSION:0.$pane" "cd '$PROJECT_ROOT' && bun run src/agent-watcher.ts $i" Enter
    fi
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
