#!/bin/bash
# Start the Matrix Hub for cross-matrix communication
#
# Usage:
#   ./scripts/start-hub.sh [port]
#
# Environment:
#   MATRIX_HUB_PORT - Port to listen on (default: 8081)
#   MATRIX_HUB_SECRET - Secret for token generation (change in production)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Use command line arg or environment variable or default
PORT="${1:-${MATRIX_HUB_PORT:-8081}}"
export MATRIX_HUB_PORT="$PORT"

echo "Starting Matrix Hub on port $PORT..."
echo ""

exec bun run src/matrix-hub.ts
