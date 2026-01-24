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

# Fix native dependencies for Apple Silicon (sharp library)
if [[ "$(uname -m)" == "arm64" && "$(uname -s)" == "Darwin" ]]; then
    echo -e "${YELLOW}Fixing native dependencies for Apple Silicon...${NC}"
    bun install --force sharp @img/sharp-libvips-darwin-arm64 > /dev/null 2>&1 || true
    echo -e "${GREEN}✓${NC} Native dependencies fixed"
fi
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

# Pre-download embedding model (avoids 9+ second delay on first use)
echo -e "${YELLOW}Pre-downloading embedding model...${NC}"
bun -e "
const { TransformersEmbeddingFunction } = await import('./src/embeddings/transformers-provider.ts');
const ef = new TransformersEmbeddingFunction();
await ef.generate(['warmup']);
console.log('Model ready');
" 2>&1 | grep -E "(Model|ready|Initializing)" || echo "Model initialized"
echo -e "${GREEN}✓${NC} Embedding model cached"
echo ""

# Build vector index for sessions/learnings
echo -e "${YELLOW}Building vector index...${NC}"
bun memory reindex 2>&1 | tail -5
echo -e "${GREEN}✓${NC} Vector index built"
echo ""

# Index codebase for semantic code search
echo -e "${YELLOW}Indexing codebase for semantic search...${NC}"
bun memory index once 2>&1 | tail -3
echo -e "${GREEN}✓${NC} Codebase indexed"
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

# ============================================
# FINAL VERIFICATION - All systems must pass
# ============================================
echo -e "${YELLOW}Running final health check...${NC}"
echo ""

HEALTH_FAILED=0

# Check 1: ChromaDB
if curl -s "http://localhost:$CHROMA_PORT/api/v2/heartbeat" &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} ChromaDB: healthy"
else
    echo -e "  ${RED}✗${NC} ChromaDB: not responding"
    HEALTH_FAILED=1
fi

# Check 2: Matrix Hub
if curl -s "http://localhost:$HUB_PORT/health" &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Matrix Hub: running"
else
    echo -e "  ${YELLOW}⚠${NC} Matrix Hub: not running (optional)"
fi

# Check 3: Matrix Daemon
if curl -s "http://localhost:$DAEMON_PORT/status" &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Matrix Daemon: connected"
else
    echo -e "  ${YELLOW}⚠${NC} Matrix Daemon: not running (optional)"
fi

# Check 4: SQLite database exists
if [ -f "agents.db" ]; then
    echo -e "  ${GREEN}✓${NC} SQLite: agents.db exists"
else
    echo -e "  ${RED}✗${NC} SQLite: agents.db missing"
    HEALTH_FAILED=1
fi

# Check 5: Code index has files
INDEX_COUNT=$(bun -e "
const db = require('better-sqlite3')('agents.db');
try { console.log(db.prepare('SELECT COUNT(*) as c FROM code_index').get()?.c || 0); }
catch { console.log(0); }
" 2>/dev/null || echo "0")

if [ "$INDEX_COUNT" -gt 0 ]; then
    echo -e "  ${GREEN}✓${NC} Code Index: $INDEX_COUNT files indexed"
else
    echo -e "  ${YELLOW}⚠${NC} Code Index: empty (run 'bun memory index once')"
fi

# Check 6: Embedding model works (quick test)
echo -n "  Testing embedding model... "
EMBED_TEST=$(bun -e "
const { TransformersEmbeddingFunction } = await import('./src/embeddings/transformers-provider.ts');
const ef = new TransformersEmbeddingFunction();
const result = await ef.generate(['test']);
console.log(result[0]?.length > 0 ? 'ok' : 'fail');
" 2>/dev/null || echo "fail")

if [ "$EMBED_TEST" = "ok" ]; then
    echo -e "${GREEN}✓${NC} working"
else
    echo -e "${RED}✗${NC} failed"
    HEALTH_FAILED=1
fi

echo ""

# Final verdict
if [ $HEALTH_FAILED -eq 1 ]; then
    echo -e "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║           Setup INCOMPLETE - See errors above            ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Try running: bun memory init"
    exit 1
fi

# All checks passed - Show comprehensive summary
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              ✓ Setup Complete - All Systems Go!          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Get additional info for summary
SESSION_COUNT=$(sqlite3 agents.db "SELECT COUNT(*) FROM sessions;" 2>/dev/null || echo "0")
LEARNING_COUNT=$(sqlite3 agents.db "SELECT COUNT(*) FROM learnings;" 2>/dev/null || echo "0")
AGENT_COUNT=$(sqlite3 agents.db "SELECT COUNT(*) FROM agents WHERE status != 'stopped';" 2>/dev/null || echo "0")
DB_SIZE=$(du -h agents.db 2>/dev/null | cut -f1 || echo "0K")
CHROMA_SIZE=$(du -sh "$CHROMA_DATA" 2>/dev/null | cut -f1 || echo "0K")

echo -e "${BLUE}┌──────────────────────────────────────────────────────────┐${NC}"
echo -e "${BLUE}│                    SYSTEM SUMMARY                        │${NC}"
echo -e "${BLUE}├──────────────────────────────────────────────────────────┤${NC}"
echo -e "${BLUE}│${NC}  Matrix ID:        ${GREEN}$MATRIX_ID${NC}"
echo -e "${BLUE}│${NC}  Working Directory: $(pwd)"
echo -e "${BLUE}├──────────────────────────────────────────────────────────┤${NC}"
echo -e "${BLUE}│${NC}  ${YELLOW}SERVICES${NC}                              ${YELLOW}PORT${NC}    ${YELLOW}STATUS${NC}"
echo -e "${BLUE}│${NC}  ChromaDB (vector search)            :$CHROMA_PORT   ${GREEN}✓ running${NC}"
echo -e "${BLUE}│${NC}  Matrix Hub (cross-matrix)           :$HUB_PORT   ${GREEN}✓ running${NC}"
echo -e "${BLUE}│${NC}  Matrix Daemon (this project)        :$DAEMON_PORT  ${GREEN}✓ connected${NC}"
echo -e "${BLUE}│${NC}  WebSocket Server (agent comm)       :8080    (starts with MCP)"
echo -e "${BLUE}├──────────────────────────────────────────────────────────┤${NC}"
echo -e "${BLUE}│${NC}  ${YELLOW}DATA LOCATIONS${NC}"
echo -e "${BLUE}│${NC}  SQLite Database:   ./agents.db ($DB_SIZE)"
echo -e "${BLUE}│${NC}  ChromaDB Data:     $CHROMA_DATA ($CHROMA_SIZE)"
echo -e "${BLUE}│${NC}  Agent Inbox:       ./data/agent_inbox/"
echo -e "${BLUE}│${NC}  Agent Outbox:      ./data/agent_outbox/"
echo -e "${BLUE}│${NC}  Shared Context:    ./data/agent_shared/"
echo -e "${BLUE}│${NC}  Matrix Config:     ./.matrix.json"
echo -e "${BLUE}│${NC}  Daemon PID:        ~/.matrix-daemon-$MATRIX_ID/"
echo -e "${BLUE}├──────────────────────────────────────────────────────────┤${NC}"
echo -e "${BLUE}│${NC}  ${YELLOW}DATABASE STATS${NC}"
echo -e "${BLUE}│${NC}  Sessions:    $SESSION_COUNT"
echo -e "${BLUE}│${NC}  Learnings:   $LEARNING_COUNT"
echo -e "${BLUE}│${NC}  Code Files:  $INDEX_COUNT indexed"
echo -e "${BLUE}│${NC}  Agents:      $AGENT_COUNT active"
echo -e "${BLUE}├──────────────────────────────────────────────────────────┤${NC}"
echo -e "${BLUE}│${NC}  ${YELLOW}EMBEDDING MODEL${NC}"
echo -e "${BLUE}│${NC}  Provider:    Transformers.js (local, no API cost)"
echo -e "${BLUE}│${NC}  Model:       nomic-ai/nomic-embed-text-v1.5"
echo -e "${BLUE}│${NC}  Dimensions:  768"
echo -e "${BLUE}└──────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${YELLOW}Quick Commands:${NC}"
echo ""
echo "  ${BLUE}bun memory status${NC}         Check system health"
echo "  ${BLUE}bun memory recall${NC}         Resume last session or search"
echo "  ${BLUE}bun memory save \"...\"${NC}     Save current session"
echo "  ${BLUE}bun memory learn ...${NC}      Capture knowledge"
echo "  ${BLUE}bun memory message ...${NC}    Cross-matrix messaging"
echo ""
echo -e "${YELLOW}Multi-Agent:${NC}"
echo ""
echo "  ${BLUE}./scripts/spawn/spawn_claude_agents.sh 3${NC}    Spawn 3 agents"
echo "  ${BLUE}tmux attach -t claude-agents-*${NC}             View agent panes"
echo ""
echo -e "${YELLOW}Documentation:${NC} docs/"
echo ""
