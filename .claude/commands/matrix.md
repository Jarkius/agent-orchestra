# Matrix

Cross-project messaging via Matrix Hub.

## Usage

```
/matrix                           Show connection status
/matrix connect                   Connect to Matrix Hub
/matrix watch                     Live message feed
/matrix send "message"            Broadcast to all matrices
/matrix send "message" --to name  Direct message to specific matrix
```

## Actions

| Action | Description |
|--------|-------------|
| (none) | Show connection status |
| `connect` | Connect daemon to Matrix Hub |
| `watch` | Start live message feed |
| `send` | Send message to other matrices |

## Flags

| Flag | Description |
|------|-------------|
| `--to NAME` | Direct message to specific matrix |
| `--inbox` | Check received messages |

## Setup

Matrix Hub must be running for cross-project messaging:
```bash
bun memory init   # Starts hub + daemon
```

## Examples

```bash
# Check connection
/matrix

# Connect to hub
/matrix connect

# Watch incoming messages
/matrix watch

# Broadcast to everyone
/matrix send "Build complete!"

# Direct message
/matrix send "Need review" --to other-project
```

## Instructions

For status:
```bash
bun memory status
```

For connect:
```bash
bun memory init
```

For watch:
```bash
bun memory watch
```

For send:
```bash
bun memory message $ARGUMENTS
```
