# Phase 7: Stuck Detection & Self-Healing — Agent Tasks

**Phase**: 7 (Tier 1)
**Priority**: P1
**Depends on**: Phase 1 (EventStream for pattern monitoring)

---

## Cause & Effect Chain

```
Phase 1 (Events) ──► Phase 7 (Stuck Detection)
                         │
                         ├─► Phase 9 (Critic) — Stuck history informs quality assessment
                         ├─► Phase 10 (Router) — Stuck patterns influence model selection
                         └─► Phase 11 (Resolver) — Auto-retry with different approach

If skipped:
  - Agents loop forever on impossible tasks → wasted tokens ($$$)
  - Oracle assigns tasks but never knows they're stuck
  - No learning from failure patterns → same mistakes repeat
  - Token exhaustion kills agents with no graceful recovery
```

---

## Task 7.1: Stuck Detector Engine

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Phase 1 Task 1.2 (EventStream to subscribe to)
**Blocks**: Tasks 7.2, 7.3

### What to do

Create `src/agents/stuck-detector.ts` — subscribes to EventStream, monitors agent action patterns, detects 5 stuck heuristics.

### Interface:
```typescript
interface StuckDetector {
  monitor(agentId: string): void;      // Start monitoring agent
  stopMonitoring(agentId: string): void;
  isStuck(agentId: string): StuckStatus;
  onStuck(callback: (agentId: string, heuristic: StuckHeuristic, context: StuckContext) => void): void;
}

interface StuckStatus {
  stuck: boolean;
  heuristic?: StuckHeuristic;
  confidence: number;     // 0.0 - 1.0
  evidence: string[];     // What triggered detection
  suggestion: string;     // Recommended recovery action
}

enum StuckHeuristic {
  REPEATING_ACTION = 'repeating_action',
  MONOLOGUE = 'monologue',
  ACTION_ERROR_ALTERNATION = 'action_error_alternation',
  CONDENSATION_LOOP = 'condensation_loop',
  TOKEN_EXHAUSTION = 'token_exhaustion',
}
```

### Heuristic implementations:

| # | Heuristic | Detection Logic | Window |
|---|-----------|-----------------|--------|
| 1 | Repeating action | Same `CmdRunAction.command` emitted 3+ times consecutively | Last 10 events |
| 2 | Monologue | 4+ consecutive events with no tool/command execution | Last 8 events |
| 3 | Action-error alternation | Pattern: `Action→Error→Action→Error` with same action+error | Last 12 events |
| 4 | Condensation loop | Context condensed but agent immediately retries same failing path | Last 20 events |
| 5 | Token exhaustion | Token usage >80% of limit with no progress markers | Cumulative |

### Steps:
1. Create `src/agents/stuck-detector.ts`
2. Subscribe to EventStream for all agent events
3. Maintain sliding window of recent events per agent
4. Run all 5 heuristics on each new event
5. Emit `StuckObservation` event when stuck detected
6. Include evidence and suggested recovery in the event

### COMPLETE criteria
- [ ] StuckDetector class with all 5 heuristics implemented
- [ ] Subscribes to EventStream automatically
- [ ] Emits `StuckObservation` event with heuristic type, confidence, evidence
- [ ] Per-agent monitoring (doesn't mix events between agents)
- [ ] Configurable thresholds (repeat count, window size)

### VALIDATION criteria
- [ ] Unit test: Emit 3 identical `CmdRunAction` events → detects `REPEATING_ACTION`
- [ ] Unit test: Emit 5 message-only events → detects `MONOLOGUE`
- [ ] Unit test: Emit action→error→action→error pattern → detects `ACTION_ERROR_ALTERNATION`
- [ ] Unit test: Normal varied events → NOT stuck (no false positives)
- [ ] Unit test: Events from different agents → only the stuck agent flagged
- [ ] `bun test tests/unit/agents/stuck-detector.test.ts` — all pass

---

## Task 7.2: Recovery Actions

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Task 7.1 (detection triggers recovery)
**Blocks**: Task 7.3

### Cause & effect

```
Detection without recovery is just logging.
Our multi-agent advantage over OpenHands:
  OpenHands: Can only reset or abort a stuck agent
  We can: Reassign to different agent, decompose, escalate to human

Recovery options per heuristic:
  REPEATING_ACTION → Force different approach or reassign to different agent
  MONOLOGUE → Inject action nudge into agent context
  ACTION_ERROR_ALTERNATION → Switch strategy or assign to different model
  CONDENSATION_LOOP → Checkpoint, summarize, restart fresh agent
  TOKEN_EXHAUSTION → Spawn fresh agent with summary of progress so far
```

### What to do

Create `src/agents/recovery.ts` — maps stuck heuristics to recovery strategies.

### Interface:
```typescript
interface RecoveryStrategy {
  heuristic: StuckHeuristic;
  execute(agentId: string, context: StuckContext): Promise<RecoveryResult>;
}

interface RecoveryResult {
  action: 'reassigned' | 'decomposed' | 'restarted' | 'escalated' | 'nudged';
  newAgentId?: string;
  summary: string;
}
```

### Recovery strategies:
| Heuristic | Strategy | Implementation |
|-----------|----------|----------------|
| REPEATING_ACTION | Reassign | Kill stuck agent, create new task for different agent with "avoid approach X" context |
| MONOLOGUE | Nudge | Write "Take a concrete action" to agent inbox file |
| ACTION_ERROR_ALTERNATION | Escalate model | Reassign to higher-capability model (haiku→sonnet→opus) |
| CONDENSATION_LOOP | Fresh start | Summarize progress, spawn new agent with summary as context |
| TOKEN_EXHAUSTION | Checkpoint + respawn | Save work-in-progress, spawn fresh agent with checkpoint |

### Steps:
1. Create `src/agents/recovery.ts`
2. Implement one strategy per heuristic
3. Wire into Oracle: on `StuckObservation` event, Oracle selects and executes recovery
4. Log recovery actions as events (for Phase 9 critic to evaluate recovery effectiveness)

### COMPLETE criteria
- [ ] Recovery strategy for each of 5 heuristics
- [ ] Oracle receives stuck signal and triggers appropriate recovery
- [ ] Recovery actions emit their own events (for traceability)
- [ ] Max 2 recovery attempts before escalating to human

### VALIDATION criteria
- [ ] Integration test: Simulate stuck agent (repeating action) → verify reassignment happens
- [ ] Integration test: Simulate monologue → verify nudge delivered to agent inbox
- [ ] Integration test: After 2 failed recoveries → verify escalation (no infinite recovery loops)
- [ ] Verify recovery events appear in `bun memory events --type Recovery`
- [ ] Oracle tests still pass: `bun test scripts/tests/oracle-spawning.test.ts`

---

## Task 7.3: Stuck Pattern Learning

**Assignable to**: `coder` role, `haiku` model
**Complexity**: low
**Depends on**: Tasks 7.1, 7.2
**Blocks**: nothing (enrichment)

### Cause & effect

```
Every stuck incident is a learning opportunity.
If we capture WHY agents get stuck:
  - Oracle can avoid assigning similar tasks to same agent type
  - Microagents (Phase 8) can include "avoid this pattern" knowledge
  - Critic (Phase 9) can flag tasks likely to cause stuckness
  - Over time, stuck incidents should decrease

Without learning:
  - Same stuck patterns repeat forever
  - No improvement in task routing
```

### What to do

After each stuck detection + recovery, capture a learning:

```typescript
{
  category: 'debugging',
  title: 'Agent stuck: [heuristic] on [task type]',
  content: 'Agent [id] got stuck due to [heuristic] while working on [task]. Recovery: [action]. Root cause: [analysis].',
  confidence: 'medium',
  source_task_id: taskId,
  tags: ['stuck', heuristicType, agentRole, modelType]
}
```

### COMPLETE criteria
- [ ] Every stuck+recovery cycle creates a learning entry
- [ ] Learnings tagged with heuristic type, agent role, model
- [ ] `bun memory recall "stuck patterns"` returns relevant incidents

### VALIDATION criteria
- [ ] Trigger a stuck detection → verify learning created in SQLite
- [ ] `bun memory recall "stuck repeating"` → returns the learning
- [ ] Learning includes task context, heuristic, recovery action taken

---

## Dependency Graph

```
Phase 1 (EventStream)
    │
    ▼
Task 7.1 (Stuck Detector engine)
    │
    ▼
Task 7.2 (Recovery actions) ──► Task 7.3 (Pattern learning)
```

**Execution order**: 7.1 → 7.2 → 7.3 (strictly sequential — each builds on prior)

---

## Phase 7 → Phase 9/10/11 Handoff

When Phase 7 is complete, downstream phases get:
- **Phase 9 (Critic)**: Can check if task was completed after stuck recovery (quality impact)
- **Phase 10 (Router)**: Historical stuck data by model type informs routing (e.g., haiku gets stuck on complex tasks → route to sonnet)
- **Phase 11 (Resolver)**: Issue resolver auto-retries with different approach when agent gets stuck
