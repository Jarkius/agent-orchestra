---
description: "Check system health: hub, daemon, indexer status"
---

# Memory Status

Quick system health check - run this first in every new session.

## Usage

```
/memory-status
```

## What It Shows

```
Hub:     Running/Stopped (localhost:8081)
Daemon:  Connected/Disconnected
Indexer: Watching/Stopped (doc count)
Matrix:  Your matrix name
Inbox:   Unread message count
```

## Healthy Output

```
Hub:     ✅ Running (localhost:8081)
Daemon:  ✅ Connected
Indexer: ✅ Watching (13689 docs)
Matrix:  memory-matrix
Inbox:   0 unread (last hour)
```

## If Unhealthy

Run `bun memory init` to fix most issues.

## Instructions

Run the status command:
```bash
bun memory status
```

If any component shows ❌, suggest running `bun memory init`.
