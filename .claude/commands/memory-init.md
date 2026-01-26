# Memory Init

Initialize all memory system components - hub, daemon, indexer.

## Usage

```
/memory-init
```

## What It Does

1. Starts Matrix Hub (if not running)
2. Connects Matrix Daemon to hub
3. Starts Indexer Daemon (file watcher)
4. Verifies all components healthy

## When to Use

- First time setup
- After reboot
- When `/memory-status` shows errors
- Fresh clone of repository

## Instructions

Run the init command:
```bash
bun memory init
```

Wait for all components to start, then show status to confirm health.
