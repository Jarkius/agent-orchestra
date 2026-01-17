# Claude Sub-Agent Orchestration System

A complete system for spawning and orchestrating **real Claude CLI sub-agents** in tmux panes. Each agent is a real AI that can think, code, and collaborate - all using your Claude Max plan.

## Quick Start - Real Claude Agents

```bash
# Install dependencies
bun install

# Start 3 real Claude sub-agents
./spawn_claude_agents.sh 3

# Attach to view
tmux attach -t claude-agents-<pid>

# Assign a task to Agent 1
echo '{"id":"test","prompt":"Write a Python hello world"}' > /tmp/agent_inbox/1/test.json

# Check result
cat /tmp/agent_outbox/1/*.json
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    YOU (Orchestrator)                        │
│                    Claude Code (Max plan)                    │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Tools
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               MCP Server (src/mcp-server.ts)                 │
│  Agent Tools | Memory Tools | Vector Tools | Analytics       │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────────┐
    │ ChromaDB │   │ SQLite   │   │ Agent Pool   │
    │ :8100    │   │ agents.db│   │ tmux panes   │
    └──────────┘   └──────────┘   └──────────────┘
```

## Memory System

Persistent knowledge capture across Claude Code sessions. See [docs/memory-system.md](docs/memory-system.md) for full architecture.

### Quick Reference

```bash
# Save session (prompts for learnings with categories)
bun memory save

# Quick learning capture (12 categories)
bun memory learn insight "Tests document behavior"
bun memory learn philosophy "Simplicity over cleverness"

# Extract learnings from past sessions
bun memory distill --last 5 --yes

# Search and recall
bun memory recall "query"          # Semantic search
bun memory recall                  # Resume last session

# Utilities
bun memory stats                   # Statistics
bun memory list learnings          # List learnings
bun memory export                  # Export to markdown
```

### Categories

| Technical | Wisdom |
|-----------|--------|
| performance, architecture, tooling | philosophy, principle, insight |
| process, debugging, security, testing | pattern, retrospective |

### Confidence Model

| Source | Confidence |
|--------|------------|
| `save` (user confirmed) | medium |
| `learn` / `distill` | low |

Validate learnings over time: low → medium → high → proven

### Performance

| Operation | Latency |
|-----------|---------|
| Embedding | ~3ms |
| ChromaDB query | ~6ms |
| SQLite query | ~0.04ms |

## Scripts Overview

| Script | Description | Recommended |
|--------|-------------|-------------|
| `spawn_claude_agents.sh` | **Real Claude CLI agents** | ⭐⭐ Best |
| `spawn_mcp.sh` | MCP-enabled agents (file watcher) | ⭐ Good |
| `spawn_orchestrated.sh` | Orchestrator + agents with SQLite | Good |
| `spawn_tmux.sh` | Simple tmux split panes | Basic |
| `spawn_test.sh` | Background execution | For CI/CD |

## MCP Integration

When the MCP server is configured, you can use these tools from Claude Code:

| Tool | Description |
|------|-------------|
| `assign_task(agent_id, task, context?)` | Send task to specific agent |
| `broadcast_task(task, context?)` | Send task to all agents |
| `get_task_result(task_id, agent_id)` | Get completed task result |
| `get_agents()` | List all agents with status |
| `update_shared_context(content)` | Update shared context for all agents |
| `get_shared_context()` | Read current shared context |

### Configure MCP Server

The `.mcp.json` file is already configured. Enable it in Claude Code:

```bash
# Add to ~/.claude/settings.json
{
  "enableAllProjectMcpServers": true
}
```

Then restart Claude Code in this directory.

## Semantic Search & Embeddings

The system includes a vector database (ChromaDB) for semantic search across tasks, results, and messages. Two embedding providers are available:

### Embedding Provider

The system uses **Transformers.js** exclusively (FastEmbed was removed for better performance):

| Provider | Model | Init Time | Query Time |
|----------|-------|-----------|------------|
| **transformers** | bge-small-en-v1.5 | ~200ms* | ~3ms |

*First run downloads model (~50MB), subsequent runs use cache.

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Choose provider: "transformers" (default) or "fastembed"
EMBEDDING_PROVIDER=transformers

# Model (both providers support the same models)
EMBEDDING_MODEL=bge-small-en-v1.5

# ChromaDB server URL
CHROMA_URL=http://localhost:8000
```

### Available Models

| Model | Provider | Dimensions | Notes |
|-------|----------|------------|-------|
| `bge-small-en-v1.5` | Both | 384 | Default, fast, good quality |
| `bge-base-en-v1.5` | Both | 768 | Higher quality, slower |
| `all-minilm-l6-v2` | Both | 384 | Classic, well-tested |
| `nomic-embed-text-v1` | transformers | 768 | Higher quality |
| `nomic-embed-text-v1.5` | transformers | 768 | Matryoshka support |

### Testing Embeddings

```bash
# Test default provider (fastembed)
bun run test:fastembed

# Test Transformers.js provider
bun run test:transformers

# Compare both providers
bun run test:compare

# Test semantic search with ChromaDB
bun run test:semantic
```

### Pre-download Models

```bash
# Download fastembed model (~33MB, first run)
bun run download-model

# Transformers.js models download automatically on first use
```

## File Structure

```
test-spawns/
├── src/
│   ├── embeddings/           # Embedding providers
│   │   ├── index.ts          # Factory & config
│   │   ├── fastembed-provider.ts   # FastEmbed (ONNX)
│   │   └── transformers-provider.ts # Transformers.js
│   ├── vector-db.ts          # ChromaDB integration
│   ├── claude-agent.ts       # Claude CLI wrapper
│   ├── agent-watcher.ts      # Inbox watcher for agents
│   ├── db.ts                 # SQLite helpers
│   └── mcp/                  # MCP server & tools
├── scripts/
│   ├── test-embeddings.ts    # Provider comparison tests
│   ├── test-semantic-search.ts # ChromaDB integration test
│   └── download-embedding-model.ts # Pre-download model
├── spawn_claude_agents.sh    # Launch real Claude agents
├── spawn_mcp.sh              # Launch MCP-enabled agents
├── .env.example              # Environment configuration
├── .mcp.json                 # MCP server config
├── LEARNING.md               # Evolution journey documentation
└── CLAUDE.md                 # Claude Code guidance
```

---

# Legacy: Simulated Agents

The sections below document the original simulated agent system for reference.

## Legacy Scripts

| Script | Description | Recommended |
|--------|-------------|-------------|
| `spawn_tmux.sh` | tmux split panes (persistent, feature-rich) | ⭐ Yes |
| `spawn_test.sh` | Background execution with interleaved output | For CI/CD |
| `spawn_ghostty.sh` | Ghostty native split panes | Optional |
| `spawn_visual.sh` | Auto-detect mode | Optional |

## Quick Start

```bash
# Make scripts executable
chmod +x *.sh

# Install tmux (recommended)
brew install tmux

# Run tmux mode with 3 agents
./spawn_tmux.sh 3

# Attach to view (run in any terminal)
tmux attach -t agents-<pid>
```

## Why tmux? (Recommended)

tmux is a terminal multiplexer that works inside **any terminal emulator** - Ghostty, iTerm2, Terminal.app, or even over SSH.

### tmux vs Native Terminal Splits

| Feature | tmux | Ghostty/iTerm2 Splits |
|---------|------|----------------------|
| Works in any terminal | ✅ Ghostty, iTerm2, Terminal.app | ❌ App-specific |
| Persistent sessions | ✅ Survives terminal close | ❌ Lost on close |
| Detach/reattach | ✅ `Ctrl+B, D` to detach | ❌ Not possible |
| Remote access (SSH) | ✅ SSH + tmux attach | ❌ Local only |
| Scriptable layouts | ✅ Fully automated | ⚠️ Needs AppleScript |
| Background execution | ✅ Runs without window | ❌ Needs visible window |
| Session sharing | ✅ Multiple users can attach | ❌ Single user |
| Scrollback/copy mode | ✅ Built-in | ✅ Native |
| Mouse support | ✅ Optional | ✅ Native |

### Key Benefits

1. **Persistent Sessions**: Close your terminal, reopen later, reattach - your agents are still running
2. **Remote Development**: Start agents on a server, SSH in from anywhere to monitor
3. **Scriptable**: Perfect for CI/CD and automated workflows
4. **Universal**: Same workflow in Ghostty, iTerm2, or any terminal

### tmux vs Ghostty Panes - Detailed Comparison

**Where tmux wins:**

| Feature | tmux | Ghostty Panes |
|---------|------|---------------|
| Persistent sessions | ✅ Survives close/crash | ❌ Gone forever |
| Remote/SSH | ✅ Works anywhere | ❌ Local only |
| Scriptable | ✅ Fully automated | ⚠️ Needs AppleScript |
| Terminal agnostic | ✅ Any terminal | ❌ Ghostty only |
| Background running | ✅ No window needed | ❌ Must be visible |
| Session sharing | ✅ Multiple users | ❌ Single user |

**Where Ghostty panes win:**

| Feature | tmux | Ghostty Panes |
|---------|------|---------------|
| Zero setup | ❌ Need to install | ✅ Built-in |
| Native feel | ⚠️ Different keybindings | ✅ macOS native |
| GPU rendering | ⚠️ Terminal dependent | ✅ Native Ghostty |
| Mouse/trackpad | ⚠️ Needs config | ✅ Just works |
| Learning curve | ⚠️ New keybindings | ✅ Familiar Cmd+D |

**Which to use:**

| Use Case | Winner | Why |
|----------|--------|-----|
| Quick one-off test | Ghostty | Faster, no setup |
| Development workflow | tmux | Persistent, scriptable |
| CI/CD pipelines | tmux | Background execution |
| Remote servers | tmux | Only option via SSH |
| Long-running tasks | tmux | Survives disconnects |
| Showing a demo | Either | Both work well |
| Pair programming | tmux | Session sharing |

**Bottom line:** Learn tmux - it's a transferable skill that works everywhere (Linux servers, Docker, SSH, any terminal). Ghostty panes are convenient for quick local splits when you don't need persistence.

### Install tmux

```bash
# macOS
brew install tmux

# Verify installation
tmux -V
```

## Background Mode

Best for: CI/CD, logging, non-interactive testing.

```bash
./spawn_test.sh [num_agents]
```

Features:
- Color-coded output per agent
- Timestamps with millisecond precision
- Interleaved logs showing concurrent execution
- Completion status verification

Example output:
```
[10:34:03] [Main Agent] Spawning sub-agents...
[10:34:03] [Sub-Agent-1] Spawned (PID: 50358)
[10:34:03] [Sub-Agent-2] Spawned (PID: 50359)
[10:34:04] [Sub-Agent-1] Working... (step 1/2)
[10:34:04] [Sub-Agent-2] COMPLETED task
[10:34:05] [Sub-Agent-1] COMPLETED task
```

## Ghostty Split Panes

Best for: Visual debugging, demos, monitoring parallel tasks.

### Automatic Launch

```bash
./spawn_ghostty.sh 3
```

This creates agent scripts and attempts to auto-launch using AppleScript.

### Manual Setup (Recommended)

1. **Open Ghostty**

2. **Create splits:**
   - `Cmd+D` - Split right (horizontal)
   - `Cmd+Shift+D` - Split down (vertical)

3. **Navigate between panes:**
   - `Cmd+]` - Next pane
   - `Cmd+[` - Previous pane

4. **Run agents in each pane:**
   ```bash
   # Pane 1
   ./.agent_1.sh

   # Pane 2
   ./.agent_2.sh

   # Pane 3
   ./.agent_3.sh
   ```

### Layout Examples

**2 Agents (side by side):**
```
┌─────────────┬─────────────┐
│   Agent 1   │   Agent 2   │
└─────────────┴─────────────┘
```
Setup: `Cmd+D`

**3 Agents:**
```
┌─────────────┬─────────────┐
│   Agent 1   │   Agent 2   │
├─────────────┼─────────────┤
│   Agent 3   │             │
└─────────────┴─────────────┘
```
Setup: `Cmd+D`, then `Cmd+Shift+D`

**4 Agents (grid):**
```
┌─────────────┬─────────────┐
│   Agent 1   │   Agent 2   │
├─────────────┼─────────────┤
│   Agent 3   │   Agent 4   │
└─────────────┴─────────────┘
```
Setup: `Cmd+D`, `Cmd+Shift+D`, `Cmd+]`, `Cmd+Shift+D`

## tmux Mode (Recommended)

### Basic Usage

```bash
# Launch 3 agents in tmux
./spawn_tmux.sh 3

# Attach to the session (from any terminal)
tmux attach -t agents-<pid>

# Or list all sessions first
tmux ls
```

### tmux Key Bindings

All tmux commands start with the prefix `Ctrl+B`:

| Action | Keys |
|--------|------|
| Detach (keep running) | `Ctrl+B`, then `D` |
| Navigate panes | `Ctrl+B`, then Arrow keys |
| Zoom pane (fullscreen) | `Ctrl+B`, then `Z` |
| Close pane | `Ctrl+B`, then `X` |
| New window | `Ctrl+B`, then `C` |
| Next window | `Ctrl+B`, then `N` |
| Split horizontal | `Ctrl+B`, then `%` |
| Split vertical | `Ctrl+B`, then `"` |
| Scroll mode | `Ctrl+B`, then `[` |
| Kill session | `Ctrl+B`, then `:kill-session` |

### Mouse Mode (Recommended for Beginners)

Enable mouse support to click on panes instead of using keyboard shortcuts:

```bash
# Enable mouse mode (current session)
tmux set -g mouse on

# Make it permanent (add to config)
echo "set -g mouse on" >> ~/.tmux.conf
```

With mouse mode enabled:
- **Click** on any pane to focus it
- **Scroll** with mouse wheel to view history
- **Drag** pane borders to resize

### Session Management

```bash
# List all sessions
tmux ls

# Attach to specific session
tmux attach -t agents-12345

# Attach to most recent session
tmux attach

# Kill a session
tmux kill-session -t agents-12345

# Kill all sessions
tmux kill-server
```

### Using tmux in Different Terminals

tmux works the same way in any terminal:

**Ghostty:**
```bash
# Just run tmux normally
./spawn_tmux.sh 3
tmux attach
```

**iTerm2:**
```bash
# Same commands work
./spawn_tmux.sh 3
tmux attach
```

**Terminal.app:**
```bash
# Same commands work
./spawn_tmux.sh 3
tmux attach
```

**SSH (Remote):**
```bash
# On remote server
ssh user@server
./spawn_tmux.sh 3

# Disconnect, reconnect later
ssh user@server
tmux attach  # Agents still running!
```

## Customization

### Modify Agent Behavior

Edit the agent work simulation in `spawn_test.sh`:

```bash
# Change work duration (default: random 1-3 seconds per step)
local work_time=$((RANDOM % 3 + 1))

# Change number of steps
for step in $(seq 1 $work_time); do
    sleep 1  # Adjust sleep time
    log_agent $id "Working... (step $step/$work_time)"
done
```

### Add Custom Tasks

Replace the work simulation with real tasks:

```bash
run_sub_agent() {
    local id=$1

    log_agent $id "Starting task..."

    # Your custom task here
    case $id in
        1) npm run build ;;
        2) npm run test ;;
        3) npm run lint ;;
    esac

    log_agent $id "Done!"
}
```

### Change Colors

Modify the `AGENT_COLORS` array:

```bash
AGENT_COLORS=(
    '\033[0;31m'  # Red
    '\033[0;32m'  # Green
    '\033[0;33m'  # Yellow
    '\033[0;34m'  # Blue
    '\033[0;35m'  # Magenta
    '\033[0;36m'  # Cyan
)
```

## Ghostty Keybindings Reference

| Action | Keybinding |
|--------|------------|
| Split right | `Cmd+D` |
| Split down | `Cmd+Shift+D` |
| Next pane | `Cmd+]` |
| Previous pane | `Cmd+[` |
| Close pane | `Cmd+W` |
| New window | `Cmd+N` |
| New tab | `Cmd+T` |

## Recommended Workflow

### For Development (Visual Monitoring)

```bash
# Start agents in tmux
./spawn_tmux.sh 3

# Open Ghostty/iTerm2 and attach
tmux attach

# Detach when done watching (Ctrl+B, D)
# Agents keep running in background
```

### For CI/CD (Automated)

```bash
# Run in background mode
./spawn_test.sh 5

# Or start tmux detached
./spawn_tmux.sh 5
# (don't attach, just let it run)
```

### For Remote Servers

```bash
# SSH to server
ssh user@server

# Start agents
./spawn_tmux.sh 3

# Detach and disconnect
# Ctrl+B, D
exit

# Later, reconnect and check
ssh user@server
tmux attach  # Still running!
```

## Troubleshooting

**tmux: "no sessions" error:**
```bash
# Session may have ended, start a new one
./spawn_tmux.sh 3
```

**tmux: "open terminal failed":**
- Run from a real terminal (Ghostty/iTerm2), not from IDE terminal
- Or use the script's background mode (it will provide attach instructions)

**AppleScript not working (Ghostty native splits):**
- Ensure Ghostty has accessibility permissions
- System Preferences > Privacy & Security > Accessibility > Enable Ghostty
- Consider using tmux instead (more reliable)

**Colors not showing:**
- Ensure terminal supports ANSI colors
- Check `TERM` environment variable: `echo $TERM`
- For tmux, ensure `TERM=xterm-256color`

**Agents not visible in tmux:**
```bash
# Check if session exists
tmux ls

# If exists, attach
tmux attach -t <session-name>

# Navigate panes with Ctrl+B, Arrow keys
```

## Files Generated

Running `spawn_ghostty.sh` creates temporary agent scripts:
```
.agent_1.sh
.agent_2.sh
.agent_3.sh
...
```

Running `spawn_tmux.sh` creates temporary scripts in `/tmp/`.

These are auto-cleaned after agents complete.

## Summary

| Use Case | Recommended Tool |
|----------|------------------|
| Visual debugging | tmux (`spawn_tmux.sh`) |
| CI/CD pipelines | Background (`spawn_test.sh`) |
| Remote servers | tmux (persistent) |
| Quick local test | tmux or Ghostty splits |
| Pair programming | tmux (session sharing) |
