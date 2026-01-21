---
description: "Start matrix daemon and connect to hub for cross-matrix messaging. Auto-starts hub if needed."
---

# Matrix Connect

Start the matrix communication system for cross-project messaging.

## Usage

```
/matrix-connect
```

## What It Does

1. **Starts hub** (if not running) - Central message broker on port 8081
2. **Starts daemon** (if not running) - Local matrix connection manager on port 37888
3. **Verifies connection** - Ensures daemon is connected to hub
4. **Shows status** - Displays matrix ID and connection info

## When to Use

- At the start of a session when you want cross-matrix communication
- After reboot or when matrix messaging isn't working
- To check if the matrix system is running

## After Connection

Once connected, you can:
- `bun memory message "Hello!"` - Broadcast to all matrices
- `bun memory message --to project "msg"` - Direct message
- `bun memory message --inbox` - Check received messages
- `bun memory status` - View connection status

## Instructions

Initialize the matrix communication system:
```bash
bun memory init
```

After running, confirm whether the connection was successful and summarize the status.
