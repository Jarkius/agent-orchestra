#!/bin/bash
#
# Agent Orchestra - One-Command Setup
#
# This script:
# 1. Checks prerequisites (bun, docker, tmux)
# 2. Installs dependencies
# 3. Starts ChromaDB container
# 4. Initializes SQLite database
# 5. Builds initial vector index
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

# Start ChromaDB
echo -e "${YELLOW}Setting up ChromaDB...${NC}"

if docker ps -a --format '{{.Names}}' | grep -q "^chromadb$"; then
    # Container exists
    if docker ps --format '{{.Names}}' | grep -q "^chromadb$"; then
        echo -e "${GREEN}✓${NC} ChromaDB already running"
    else
        echo "Starting existing ChromaDB container..."
        docker start chromadb
        echo -e "${GREEN}✓${NC} ChromaDB started"
    fi
else
    # Create new container
    echo "Creating ChromaDB container..."
    docker run -d --name chromadb --restart unless-stopped \
        -p 8100:8000 \
        -v "$(pwd)/chroma_data:/data" \
        chromadb/chroma
    echo -e "${GREEN}✓${NC} ChromaDB container created"
fi

# Wait for ChromaDB to be healthy
echo "Waiting for ChromaDB to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:8100/api/v2/heartbeat &> /dev/null; then
        echo -e "${GREEN}✓${NC} ChromaDB is healthy"
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
echo "  4. Spawn agents (optional):"
echo "     ${BLUE}./scripts/spawn/spawn_claude_agents.sh 3${NC}"
echo ""
echo "  5. Use slash commands in Claude Code:"
echo "     ${BLUE}/memory-save, /memory-recall, /memory-learn, /memory-distill${NC}"
echo ""
echo "For documentation, see: ${BLUE}docs/${NC}"
echo ""
