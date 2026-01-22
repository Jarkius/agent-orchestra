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
# Terminal 1: Start hub (displays PIN on startup)
bun run src/matrix-hub.ts

# Terminal 2: Start daemon with PIN
bun run src/matrix-daemon.ts start --pin <PIN>
```

## Hub PIN Authentication

The hub displays a PIN on startup. Matrices must provide this PIN to connect (like WiFi password).

### Hub Operator
```bash
# Auto-generated PIN (displayed on startup)
bun run src/matrix-hub.ts
# Output: 🔐 Hub PIN: A1B2C3

# Custom PIN
MATRIX_HUB_PIN=mysecret bun run src/matrix-hub.ts

# Disable PIN (open hub - not recommended for LAN/internet)
MATRIX_HUB_PIN=disabled bun run src/matrix-hub.ts
```

### Connecting with PIN
```bash
# Via CLI flag
bun run src/matrix-daemon.ts start --pin A1B2C3

# Via environment variable
MATRIX_HUB_PIN=A1B2C3 bun run src/matrix-daemon.ts start

# Via .matrix.json config
{
  "matrix_id": "my-project",
  "hub_url": "ws://localhost:8081",
  "hub_pin": "A1B2C3"
}
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

# Start daemon with PIN from hub console
bun run src/matrix-daemon.ts start --pin A1B2C3

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
| `MATRIX_HUB_PIN` | (auto-generated) | Hub PIN, or `disabled` to turn off |
| `MATRIX_DAEMON_PORT` | `37888` | Daemon HTTP API port |

## Daemon Management

```bash
bun run src/matrix-daemon.ts start   # Start daemon
bun run src/matrix-daemon.ts stop    # Stop daemon
bun run src/matrix-daemon.ts status  # Check status
```

## Troubleshooting

**"Invalid or missing PIN"**
- Check hub console for the PIN (displayed on startup)
- Set PIN via `--pin`, `MATRIX_HUB_PIN`, or `.matrix.json`
- PIN is session-only - changes when hub restarts

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
