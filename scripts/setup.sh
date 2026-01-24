#!/bin/bash
#
# Agent Orchestra - One-Command Setup
#
# This script:
# 1. Checks prerequisites (bun, docker, tmux)
# 2. Installs dependencies
# 3. Starts shared ChromaDB container (port 8100, collections prefixed by project)
# 4. Initializes SQLite database
# 5. Builds initial vector index
# 6. Starts Matrix Hub (port 8081, shared across projects)
# 7. Starts Matrix Daemon (port auto-assigned per project)
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           Agent Orchestra - Setup Script                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check for required commands
check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 found"
        return 0
    else
        echo -e "${RED}✗${NC} $1 not found"
        return 1
    fi
}

echo -e "${YELLOW}Checking prerequisites...${NC}"
echo ""

MISSING=0

check_command "bun" || {
    echo "  Install with: curl -fsSL https://bun.sh/install | bash"
    MISSING=1
}

check_command "docker" || {
    echo "  Install Docker Desktop from: https://docker.com"
    MISSING=1
}

check_command "tmux" || {
    echo -e "${YELLOW}  (Optional) Install with: brew install tmux${NC}"
    echo "  tmux is only needed for multi-agent orchestration"
}

if [ $MISSING -eq 1 ]; then
    echo ""
    echo -e "${RED}Please install missing prerequisites and run again.${NC}"
    exit 1
fi

# Check if docker is running
if ! docker info &> /dev/null; then
    echo ""
    echo -e "${RED}Docker is installed but not running.${NC}"
    echo "Please start Docker Desktop and run this script again."
    exit 1
fi

echo ""
echo -e "${GREEN}All prerequisites met!${NC}"
echo ""

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
bun install
echo -e "${GREEN}✓${NC} Dependencies installed"
echo ""

# Start ChromaDB - shared container, project isolation via collection prefixes
echo -e "${YELLOW}Setting up ChromaDB...${NC}"

CHROMA_PORT="${CHROMADB_PORT:-8100}"
CHROMA_DATA="$HOME/.chromadb_data"

# Check if any chromadb container is already running
if docker ps --format '{{.Names}}' | grep -q "^chromadb$"; then
    echo -e "${GREEN}✓${NC} ChromaDB already running (shared container on port $CHROMA_PORT)"
elif docker ps -a --format '{{.Names}}' | grep -q "^chromadb$"; then
    # Container exists but stopped
    echo "Starting existing ChromaDB container..."
    docker start chromadb
    echo -e "${GREEN}✓${NC} ChromaDB started"
else
    # Create shared data directory
    mkdir -p "$CHROMA_DATA"

    # Create new shared container with local directory
    echo "Creating ChromaDB container..."
    docker run -d --name chromadb --restart unless-stopped \
        -p "$CHROMA_PORT:8000" \
        -v "$CHROMA_DATA:/chroma/chroma" \
        chromadb/chroma
    echo -e "${GREEN}✓${NC} ChromaDB container created (data: $CHROMA_DATA)"
fi

# Wait for ChromaDB to be healthy
echo "Waiting for ChromaDB to be ready..."
for i in {1..30}; do
    if curl -s "http://localhost:$CHROMA_PORT/api/v2/heartbeat" &> /dev/null; then
        echo -e "${GREEN}✓${NC} ChromaDB is healthy on port $CHROMA_PORT"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}ChromaDB failed to start. Check docker logs chromadb${NC}"
        exit 1
    fi
    sleep 1
done
echo ""

# Initialize database
echo -e "${YELLOW}Initializing database...${NC}"

# Create SQLite tables if they don't exist (bun memory stats will do this)
bun memory stats > /dev/null 2>&1 || true
echo -e "${GREEN}✓${NC} SQLite database initialized"
echo ""

# Build vector index
echo -e "${YELLOW}Building vector index...${NC}"
bun memory reindex 2>&1 | tail -5
echo -e "${GREEN}✓${NC} Vector index built"
echo ""

# Initialize Matrix Communication System
echo -e "${YELLOW}Setting up Matrix communication...${NC}"

# Start Matrix Hub if not running
HUB_PORT="${MATRIX_HUB_PORT:-8081}"
if curl -s "http://localhost:$HUB_PORT/health" &> /dev/null; then
    echo -e "${GREEN}✓${NC} Matrix Hub already running on port $HUB_PORT"
else
    echo "Starting Matrix Hub..."
    mkdir -p "$HOME/.matrix-logs"
    nohup bun run src/matrix-hub.ts > "$HOME/.matrix-logs/hub.log" 2>&1 &
    for i in {1..10}; do
        if curl -s "http://localhost:$HUB_PORT/health" &> /dev/null; then
            echo -e "${GREEN}✓${NC} Matrix Hub started on port $HUB_PORT"
            break
        fi
        if [ $i -eq 10 ]; then
            echo -e "${YELLOW}⚠${NC} Matrix Hub failed to start (non-critical)"
        fi
        sleep 0.5
    done
fi

# Start Matrix Daemon - each project needs its own
DAEMON_PORT="${MATRIX_DAEMON_PORT:-37888}"
MATRIX_ID="$(basename "$(pwd)")"
CONFIG_FILE=".matrix.json"
HUB_PIN="${MATRIX_HUB_PIN:-}"

# Check if we already have a config with a daemon running
if [ -f "$CONFIG_FILE" ]; then
    EXISTING_PORT=$(grep -o '"daemon_port"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" 2>/dev/null | grep -o '[0-9]*' || echo "")
    if [ -n "$EXISTING_PORT" ]; then
        DAEMON_PORT="$EXISTING_PORT"
    fi
fi

# Check if this project's daemon is already running
if curl -s "http://localhost:$DAEMON_PORT/status" 2>/dev/null | grep -q "$MATRIX_ID"; then
    echo -e "${GREEN}✓${NC} Matrix Daemon already running on port $DAEMON_PORT"
else
    # Find available port if default is in use by another project
    while curl -s "http://localhost:$DAEMON_PORT/status" &> /dev/null; do
        echo "Port $DAEMON_PORT in use by another project, trying next..."
        DAEMON_PORT=$((DAEMON_PORT + 1))
    done

    # Create/update .matrix.json with our settings
    if [ -n "$HUB_PIN" ]; then
        cat > "$CONFIG_FILE" << EOF
{
  "matrix_id": "$MATRIX_ID",
  "daemon_port": $DAEMON_PORT,
  "daemon_dir": "~/.matrix-daemon-$MATRIX_ID",
  "database": "./agents.db",
  "hub_url": "ws://localhost:$HUB_PORT",
  "hub_pin": "$HUB_PIN"
}
EOF
    else
        cat > "$CONFIG_FILE" << EOF
{
  "matrix_id": "$MATRIX_ID",
  "daemon_port": $DAEMON_PORT,
  "daemon_dir": "~/.matrix-daemon-$MATRIX_ID",
  "database": "./agents.db",
  "hub_url": "ws://localhost:$HUB_PORT"
}
EOF
    fi
    echo "Created $CONFIG_FILE (daemon port: $DAEMON_PORT)"

    echo "Starting Matrix Daemon..."
    bun run src/matrix-daemon.ts start > /dev/null 2>&1 &
    for i in {1..10}; do
        if curl -s "http://localhost:$DAEMON_PORT/status" &> /dev/null; then
            echo -e "${GREEN}✓${NC} Matrix Daemon started on port $DAEMON_PORT"
            break
        fi
        if [ $i -eq 10 ]; then
            echo -e "${YELLOW}⚠${NC} Matrix Daemon failed to start (non-critical)"
        fi
        sleep 0.5
    done
fi
echo ""

# Verify installation
echo -e "${YELLOW}Verifying installation...${NC}"
echo ""

# Check stats
echo "System Statistics:"
bun memory stats 2>/dev/null | head -20
echo ""

# Success message
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                  Setup Complete!                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Next steps:"
echo ""
echo "  1. Save a session:"
echo "     ${BLUE}bun memory save \"Description of your work\"${NC}"
echo ""
echo "  2. Search past sessions:"
echo "     ${BLUE}bun memory recall \"search query\"${NC}"
echo ""
echo "  3. Capture learnings (smart auto-detect):"
echo "     ${BLUE}bun memory learn ./docs/file.md${NC}      # From file"
echo "     ${BLUE}bun memory learn HEAD~3${NC}              # From git"
echo "     ${BLUE}bun memory learn tooling \"title\"${NC}     # Manual"
echo ""
echo "  4. Cross-matrix messaging:"
echo "     ${BLUE}bun memory message \"Hello!\"${NC}         # Broadcast"
echo "     ${BLUE}bun memory message --inbox${NC}          # Check inbox"
echo "     ${BLUE}bun memory status${NC}                   # View status"
echo ""
echo "  5. Spawn agents (optional):"
echo "     ${BLUE}./scripts/spawn/spawn_claude_agents.sh 3${NC}"
echo ""
echo "  6. Use slash commands in Claude Code:"
echo "     ${BLUE}/memory-save, /memory-recall, /memory-learn, /matrix-connect${NC}"
echo ""
echo "For documentation, see: ${BLUE}docs/${NC}"
echo ""
