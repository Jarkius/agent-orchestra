# Phase 1: Event Stream Foundation — Agent Tasks

**Phase**: 1 (Tier 0 — Foundation)
**Priority**: P0
**Why first**: Phases 3, 7, 9 all emit and consume typed events. Without a unified event stream, each phase invents its own event mechanism.

---

## Cause & Effect Chain

```
Phase 1 (Event Stream)
  ├─► Phase 3 (Security) — Security decisions are events (ActionRiskAssessed)
  ├─► Phase 7 (Stuck Detection) — Stuck signals are events (AgentStuck)
  ├─► Phase 9 (Critic) — Evaluations are events (TaskEvaluated)
  ├─► Phase 10 (LLM Router) — Model selections are events (ModelRouted)
  ├─► Phase 4 (Dashboard) — Real-time UI subscribes to event stream
  └─► Phase 11 (Resolver) — Issue→PR pipeline emits events at each stage

If skipped:
  - Each phase creates its own logging/notification mechanism
  - No unified timeline of what happened and why
  - Dashboard has no single source to subscribe to
  - Debugging requires checking 5 different log sources
  - No causality chain (which event caused which)
```

---

## Task 1.1: Define Event Type Hierarchy

**Assignable to**: `architect` role, `sonnet` model
**Complexity**: medium
**Depends on**: Phase 6 Task 6.6 (clean directory structure)
**Blocks**: Tasks 1.2, 1.3, 1.4 (all consume these types)

### What to do

Create the typed event hierarchy inspired by OpenHands `events/`.

**New files:**
- `src/events/event.ts` — Base `Event` class
- `src/events/action.ts` — Action event types (things agents DO)
- `src/events/observation.ts` — Observation event types (things agents OBSERVE)
- `src/events/types.ts` — Shared enums and type unions
- `src/events/index.ts` — Barrel export

### Event base:
```typescript
interface Event {
  id: string;              // UUID
  timestamp: Date;
  type: EventType;         // Discriminated union tag
  source: string;          // Agent ID, "oracle", "system", "user"
  cause_id?: string;       // Parent event that triggered this one
  payload: Record<string, unknown>;
}
```

### Action types to define:
| Action | Source | Description |
|--------|--------|-------------|
| `CmdRunAction` | agent | Agent executes a shell command |
| `FileEditAction` | agent | Agent modifies a file |
| `TaskAssignAction` | oracle | Oracle assigns task to agent |
| `TaskDecomposeAction` | oracle | Oracle breaks task into subtasks |
| `AgentSpawnAction` | oracle | Oracle spawns new agent |
| `MessageSendAction` | agent/system | Matrix message sent |
| `SearchAction` | agent | Code/memory search initiated |

### Observation types to define:
| Observation | Source | Description |
|-------------|--------|-------------|
| `CmdOutputObservation` | runtime | Command execution result |
| `FileReadObservation` | runtime | File content read |
| `TaskResultObservation` | agent | Task completion result |
| `ErrorObservation` | system | Error occurred |
| `StuckObservation` | system | Agent stuck detected (Phase 7) |
| `CriticObservation` | critic | Quality evaluation result (Phase 9) |
| `SecurityObservation` | security | Risk assessment result (Phase 3) |

### COMPLETE criteria
- [ ] `src/events/` directory with all type files
- [ ] Every event type has TypeScript interface with required fields
- [ ] Discriminated union `EventType` covers all types
- [ ] Type guards: `isAction(event)`, `isObservation(event)`, `isType<T>(event, type)`
- [ ] Cause chain is typed (`cause_id` links to parent event)

### VALIDATION criteria
- [ ] `bun run --eval "import { CmdRunAction, TaskResultObservation } from './src/events'"` — compiles
- [ ] TypeScript strict mode: no `any` types, all fields typed
- [ ] `tsc --noEmit src/events/index.ts` — zero type errors
- [ ] At least 3 unit tests in `tests/unit/events/types.test.ts`:
  - Create each event type, verify required fields
  - Type guard correctly identifies action vs observation
  - Cause chain: create parent event, child references parent.id

---

## Task 1.2: EventStream Pub/Sub Engine

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Task 1.1 (needs event types)
**Blocks**: Tasks 1.3, 1.4

### Cause & effect

```
The EventStream is the central nervous system.
All other phases subscribe to it:
  - Dashboard subscribes for real-time UI updates
  - Stuck Detector subscribes for agent action patterns
  - Critic subscribes for task completion events
  - Security subscribes for pre-execution events

Without pub/sub → each consumer polls or uses callbacks → spaghetti
```

### What to do

Create `src/events/stream.ts` — the core EventStream class.

### Interface:
```typescript
class EventStream {
  // Publish
  emit(event: Event): void;

  // Subscribe
  subscribe(subscriberId: string, callback: (event: Event) => void): void;
  subscribeToType(subscriberId: string, type: EventType, callback: (event: Event) => void): void;
  unsubscribe(subscriberId: string): void;

  // Query
  getEvents(filter?: EventFilter): Event[];
  getEventById(id: string): Event | null;
  getEventChain(eventId: string): Event[];  // Follow cause chain up

  // Persistence
  persist(event: Event): void;  // Write to SQLite
  replay(filter?: EventFilter): Event[];  // Read from SQLite
}
```

### Requirements:
- Thread-safe (multiple agents emit concurrently)
- Subscribers notified synchronously in emit order
- Events persisted to SQLite immediately on emit
- `getEventChain()` follows `cause_id` links to reconstruct full causality

### COMPLETE criteria
- [ ] `EventStream` class with emit, subscribe, query, persist methods
- [ ] Subscribers receive events in order
- [ ] Concurrent emit from multiple sources doesn't lose events
- [ ] SQLite persistence on every emit
- [ ] Causality chain queryable via `getEventChain()`

### VALIDATION criteria
- [ ] Unit test: emit 100 events, subscriber receives all 100 in order
- [ ] Unit test: subscribe to specific type, only receive matching events
- [ ] Unit test: emit parent + child with cause_id, `getEventChain(child.id)` returns [parent, child]
- [ ] Unit test: persist event, restart stream, `replay()` returns persisted events
- [ ] Integration test: 3 concurrent emitters, all events captured without data loss
- [ ] `bun test tests/unit/events/stream.test.ts` — all pass

---

## Task 1.3: Wire EventStream into Mission Queue

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Task 1.2 (needs working EventStream)
**Blocks**: Phase 7 (Stuck Detection subscribes to mission events)

### Cause & effect

```
Mission Queue is where all agent work flows through.
Wiring events here means:
  - Every task assignment becomes a TaskAssignAction event
  - Every task completion becomes a TaskResultObservation event
  - Every failure becomes an ErrorObservation event
  - Stuck Detector (Phase 7) can subscribe to see patterns
  - Critic (Phase 9) can subscribe to evaluate completions
  - Dashboard (Phase 4) gets real-time task status updates
```

### What to do

Modify `src/pty/mission-queue.ts` to emit events at key state transitions.

### Events to emit:
| Trigger | Event |
|---------|-------|
| Task assigned to agent | `TaskAssignAction` with agent_id, task details |
| Task started by agent | `TaskStartedObservation` |
| Task completed | `TaskResultObservation` with result, duration |
| Task failed | `ErrorObservation` with error details |
| Task reassigned | `TaskAssignAction` with new agent, cause_id = original assign |
| Mission created | `MissionCreatedAction` |
| Mission decomposed | `TaskDecomposeAction` with subtask list |

### Steps:
1. Import EventStream singleton into mission-queue.ts
2. At each state transition, emit the appropriate event
3. Ensure cause_id chains are correct (subtask events link to parent mission)
4. Don't break existing behavior — events are additive

### COMPLETE criteria
- [ ] All mission state transitions emit events
- [ ] Cause chains link subtasks to parent missions
- [ ] No change to existing mission queue behavior (events are side effects)
- [ ] EventStream receives all mission lifecycle events

### VALIDATION criteria
- [ ] `bun test scripts/tests/simulation.test.ts` — existing 17 tests still pass
- [ ] New test: assign task, verify TaskAssignAction event emitted with correct fields
- [ ] New test: complete task, verify TaskResultObservation includes duration
- [ ] New test: decompose mission, verify all subtasks link via cause_id to parent
- [ ] Manual: assign real task, query `eventStream.getEvents({ type: 'TaskAssign' })` — returns it

---

## Task 1.4: Wire EventStream into MCP Handlers + Add CLI

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Task 1.2 (needs working EventStream)
**Blocks**: Phase 4 (Dashboard subscribes to MCP events)

### What to do

1. Emit events from MCP tool handlers (`src/mcp/tools/handlers/`)
2. Add `bun memory events` CLI command for querying event timeline

### MCP events to emit:
| Handler | Event |
|---------|-------|
| `task.ts` — assign_task | `TaskAssignAction` |
| `task.ts` — get_task_result | `TaskResultObservation` (on retrieval) |
| `pty.ts` — agent_spawn | `AgentSpawnAction` |
| `learning.ts` — learn | `LearningCreatedObservation` |
| `oracle-consult.ts` — consult | `OracleConsultAction` |

### CLI command:
```bash
bun memory events                      # Last 50 events
bun memory events --type TaskAssign    # Filter by type
bun memory events --source agent-1     # Filter by source
bun memory events --chain <event-id>   # Show causality chain
bun memory events --since 1h           # Last hour
bun memory events --live               # Stream events in real-time
```

### COMPLETE criteria
- [ ] MCP handlers emit events at key operations
- [ ] `bun memory events` CLI works with all filter options
- [ ] `--live` mode streams events as they happen
- [ ] `--chain` follows cause_id links

### VALIDATION criteria
- [ ] Assign a task via MCP, `bun memory events --type TaskAssign` shows it
- [ ] `bun memory events --chain <id>` shows parent→child chain
- [ ] `bun memory events --since 5m` shows only recent events
- [ ] `bun memory events --live` streams in real-time (emit event in another terminal, see it appear)
- [ ] All existing MCP tests still pass

---

## Task 1.5: Add Events SQLite Table + Migration

**Assignable to**: `coder` role, `haiku` model
**Complexity**: low
**Depends on**: Task 1.1 (event types define schema), Phase 6 Task 6.2 (db split)
**Blocks**: Task 1.2 (persistence layer)

### What to do

Add `events` table to SQLite schema.

```sql
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  cause_id TEXT,
  payload TEXT NOT NULL,  -- JSON
  timestamp TEXT NOT NULL,
  session_id TEXT,
  FOREIGN KEY (cause_id) REFERENCES events(id)
);

CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_source ON events(source);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_cause ON events(cause_id);
CREATE INDEX idx_events_session ON events(session_id);
```

### Steps:
1. Add migration to `src/db/migrations.ts` (or `src/db/schema.ts` after Phase 6 split)
2. Add event CRUD functions: `insertEvent()`, `queryEvents()`, `getEventChain()`
3. Add cleanup: events older than 30 days auto-pruned (configurable)

### COMPLETE criteria
- [ ] `events` table created on DB init
- [ ] Migration runs cleanly on existing databases
- [ ] CRUD functions work: insert, query by type/source/time, chain query
- [ ] Auto-prune for old events

### VALIDATION criteria
- [ ] `bun memory status` — DB health shows events table exists
- [ ] Insert 1000 events, query by type — returns correct subset in <50ms
- [ ] Insert parent + child, `getEventChain(child.id)` returns both
- [ ] Existing DB data untouched after migration (no data loss)
- [ ] `bun test tests/unit/db/events.test.ts` — all pass

---

## Dependency Graph

```
Task 1.5 (Events table) ──► Task 1.1 (Event types) ──► Task 1.2 (EventStream engine)
                                                              │
                                                    ┌────────┴────────┐
                                                    ▼                 ▼
                                          Task 1.3 (Wire to    Task 1.4 (Wire to
                                           Mission Queue)       MCP + CLI)
```

**Execution order**: 1.5 → 1.1 → 1.2 → (1.3 + 1.4 in parallel)

---

## Phase 1 → Phase 3/7/9 Handoff

When Phase 1 is complete, downstream phases get:
- **Phase 3 (Security)**: Subscribe to action events, emit `SecurityObservation` before execution
- **Phase 7 (Stuck Detection)**: Subscribe to agent action events, detect repetition patterns
- **Phase 9 (Critic)**: Subscribe to `TaskResultObservation`, emit `CriticObservation` with scores
- **Phase 4 (Dashboard)**: Subscribe to all events for real-time UI
- **Phase 10 (Router)**: Emit `ModelRouted` events for cost tracking
