#!/bin/bash
# Claude Code hook: Check for new matrix messages
# Runs on user-prompt-submit - fast, non-blocking

cd "$(dirname "$0")/../.." || exit 0
exec bun run scripts/hooks/check-inbox.ts 2>/dev/null
