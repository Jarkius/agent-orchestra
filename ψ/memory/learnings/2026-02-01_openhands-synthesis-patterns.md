# Event-Driven Architecture is the Missing Foundation for Multi-Agent Systems

**Date**: 2026-02-01
**Context**: Deep dive comparison of OpenHands vs matrix-memory-agents architecture
**Confidence**: High

## Key Learning

After analyzing OpenHands' architecture against matrix-memory-agents, the single highest-impact pattern to adopt is a **typed event stream**. OpenHands routes ALL agent communication through `Action -> Observation` events with causality tracking (each observation links to the action that caused it). This creates a complete, replayable audit trail of every agent decision.

Matrix-memory-agents currently uses 3 fragmented communication layers (WebSocket, File IPC, Matrix Hub) that work independently. Adding an EventStream layer on top of the existing SQLite infrastructure would unify these into a single source of truth without replacing what works.

The second key insight is that **execution sandboxing and security analysis are not optional for production multi-agent systems**. OpenHands evaluates every action for risk (LOW/MEDIUM/HIGH) before execution and can require human confirmation for destructive operations. An agent system without this is a liability — one `rm -rf /` or `git push --force` away from disaster.

## The Pattern

```
Current:  Agent -> MCP tool -> Direct execution -> Result (no audit, no safety)
Better:   Agent -> Event(Action) -> SecurityCheck -> Runtime.execute() -> Event(Observation) -> Agent
```

Event types form a hierarchy:
- `Event` (base: id, timestamp, source, cause_id)
  - `Action` (agent intent: CmdRun, FileEdit, TaskAssign)
  - `Observation` (execution result: CmdOutput, Error, TaskResult)

## Why This Matters

1. **Debuggability**: Full event log with causality chain — "why did the agent do X?"
2. **Security**: Hook point to evaluate risk before execution
3. **Replay**: Reproduce any session from event log
4. **Metrics**: Accurate cost/time tracking per action
5. **UI foundation**: Event stream feeds real-time dashboard

## Tags

`architecture`, `event-driven`, `security`, `openhands`, `evolution`, `multi-agent`
