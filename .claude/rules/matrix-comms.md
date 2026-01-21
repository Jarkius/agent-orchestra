# Cross-Matrix Communication

Like players in an online game - matrices can broadcast and direct message each other.

## Quick Start

```bash
# Single command to set up everything
bun memory init

# Check status at a glance
bun memory status

# Send messages
bun memory message "Hello everyone!"           # Broadcast
bun memory message --to other-proj "Hey!"      # Direct
bun memory message --inbox                     # Check inbox
```

## Manual Setup (if init fails)

```bash
# Terminal 1: Start hub
bun run src/matrix-hub.ts

# Terminal 2: Start daemon
bun run src/matrix-daemon.ts start
```

## Same Network Setup

For two machines on the same WiFi/LAN:

### Machine A (Hub Host)
```bash
# Bind to all interfaces so other machines can connect
export MATRIX_HUB_HOST=0.0.0.0
bun run src/matrix-hub.ts

# Find your IP
ifconfig | grep "inet " | grep -v 127.0.0.1
# Example output: inet 192.168.1.100
```

### Machine B (Client)
```bash
# Point to hub machine's IP
export MATRIX_HUB_URL=ws://192.168.1.100:8081

# Start daemon
bun run src/matrix-daemon.ts start

# Test connection
bun memory message "Hello from Machine B!"
```

### Firewall Note
If connection fails, ensure port 8081 is open:
```bash
# macOS (temporary)
sudo pfctl -d  # Disable firewall briefly for testing

# Or add rule in System Preferences > Security > Firewall > Options
```

## Architecture

```
Matrix A ──► Daemon ──► Hub (8081) ◄── Daemon ◄── Matrix B
              │            │              │
          localhost    192.168.x.x    MATRIX_HUB_URL
```

## Message Types

| Type | Command | Delivery |
|------|---------|----------|
| Broadcast | `bun memory message "text"` | All connected matrices |
| Direct | `bun memory message --to proj "text"` | Specific matrix only |
| Check | `bun memory message --inbox` | View received messages |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MATRIX_HUB_URL` | `ws://localhost:8081` | Hub WebSocket URL |
| `MATRIX_HUB_HOST` | `localhost` | Hub bind address |
| `MATRIX_HUB_PORT` | `8081` | Hub listen port |
| `MATRIX_DAEMON_PORT` | `37888` | Daemon HTTP API port |

## Daemon Management

```bash
bun run src/matrix-daemon.ts start   # Start daemon
bun run src/matrix-daemon.ts stop    # Stop daemon
bun run src/matrix-daemon.ts status  # Check status
```

## Troubleshooting

**"Connection refused"**
- Is hub running? Check with `lsof -i :8081`
- Correct IP? Ping the hub machine first
- Firewall blocking? Try temporarily disabling

**"Token expired"**
- Tokens last 24 hours
- Restart daemon: `stop` then `start`

**Messages not arriving**
- Both daemons connected to same hub?
- Check `--inbox` on receiving matrix
- SQLite fallback stores undelivered messages

## Future: Internet Communication

Deploy hub to cloud for remote access:
```bash
# On cloud server (Fly.io, Railway, VPS)
export MATRIX_HUB_HOST=0.0.0.0
bun run src/matrix-hub.ts

# Clients connect via public URL
export MATRIX_HUB_URL=wss://your-hub.fly.dev
```

TLS recommended for internet traffic.
