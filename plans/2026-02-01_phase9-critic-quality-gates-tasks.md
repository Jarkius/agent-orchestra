# Phase 9: Critic & Quality Gates — Agent Tasks

**Phase**: 9 (Tier 1)
**Priority**: P1
**Depends on**: Phase 1 (EventStream for task completion events)

---

## Cause & Effect Chain

```
Phase 1 (Events) ──► Phase 9 (Critic)
Phase 7 (Stuck) ───►    │
Phase 8 (Microagents) ─►│
                         │
                         ├─► Phase 10 (Router) — Critic scores feed model selection
                         ├─► Phase 11 (Resolver) — Quality gate before PR submission
                         └─► Oracle — Agent performance tracking for smarter routing

If skipped:
  - Agent output accepted unconditionally → bad PRs, broken code
  - No feedback loop → agents don't improve from mistakes
  - Oracle has no quality signal → routes blindly
  - Issue Resolver submits low-quality PRs → trust eroded
  - No retry mechanism → first attempt is final answer
```

---

## Task 9.1: Critic Interface & Rule-Based Critic

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Phase 1 Task 1.2 (subscribes to TaskResultObservation events)
**Blocks**: Tasks 9.2, 9.3

### What to do

Create the critic framework and a baseline rule-based critic.

**New files:**
- `src/critic/base.ts` — `BaseCritic` interface
- `src/critic/rule-based.ts` — Pattern-matching critic
- `src/critic/types.ts` — Shared types

### Interface:
```typescript
interface BaseCritic {
  name: string;
  evaluate(task: Task, result: TaskResult): Promise<CriticScore>;
}

interface CriticScore {
  critic: string;         // Which critic produced this
  score: number;          // 0.0 - 1.0
  passed: boolean;        // score >= threshold
  feedback: string;       // What went wrong (if failed)
  suggestions: string[];  // How to improve
  metrics: {
    correctness: number;    // Did it do what was asked?
    completeness: number;   // Did it finish everything?
    code_quality: number;   // Linting, patterns, no regressions
    test_coverage: number;  // Tests written/passing?
  };
  evidence: string[];     // Specific checks that passed/failed
}

interface QualityGateConfig {
  threshold: number;          // Minimum score to pass (default: 0.7)
  max_retries: number;        // Retries before escalation (default: 2)
  critics: string[];          // Which critics to run
  required_metrics?: string[];// Metrics that must individually pass
}
```

### Rule-based critic checks:
| Check | How | Weight |
|-------|-----|--------|
| Tests pass | Run `bun test` on modified files | 0.3 |
| No lint errors | Run linter if configured | 0.15 |
| Files exist | All files mentioned in task are present | 0.15 |
| No regressions | Compare test count before/after | 0.2 |
| Task requirements met | Check each requirement in task description | 0.2 |

### COMPLETE criteria
- [ ] `BaseCritic` interface defined
- [ ] `RuleBasedCritic` implements all 5 checks
- [ ] `CriticScore` includes all metric fields
- [ ] `QualityGateConfig` allows threshold customization
- [ ] Critic produces actionable feedback on failure

### VALIDATION criteria
- [ ] Unit test: Pass a task with passing tests → score > 0.7, passed = true
- [ ] Unit test: Pass a task with failing tests → score < 0.5, passed = false, feedback mentions test failures
- [ ] Unit test: Pass a task with missing files → completeness metric low
- [ ] Unit test: Feedback includes specific suggestions (not generic)
- [ ] `bun test tests/unit/critic/rule-based.test.ts` — all pass

---

## Task 9.2: LLM Critic

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Task 9.1 (BaseCritic interface)
**Blocks**: Task 9.3

### Cause & effect

```
Rule-based critic catches mechanical issues (tests fail, files missing).
LLM critic catches semantic issues:
  - "The code works but doesn't handle edge cases"
  - "The implementation is correct but overly complex"
  - "The task asked for X but the code does Y"

Without LLM critic:
  - Code that passes tests but misses the point gets accepted
  - No nuanced quality feedback
  - Agents don't learn from subtle mistakes
```

### What to do

Create `src/critic/llm-critic.ts` — uses Haiku for fast, cheap evaluation.

### LLM prompt structure:
```
You are a code reviewer evaluating agent task output.

## Task
{task.description}

## Requirements
{task.requirements}

## Agent Output
{result.summary}

## Code Changes
{result.diff}

## Evaluate on these dimensions (0.0-1.0):
1. Correctness: Does the code do what the task asked?
2. Completeness: Are all requirements addressed?
3. Code quality: Is it clean, idiomatic, well-structured?
4. Test coverage: Are there adequate tests?

Provide specific feedback and suggestions.
```

### Steps:
1. Create `src/critic/llm-critic.ts` implementing `BaseCritic`
2. Use existing `src/services/external-llm.ts` for LLM calls
3. Parse LLM response into `CriticScore` structure
4. Use Haiku model for speed and cost (critic runs on every task)
5. Cache evaluations for same task+result (avoid re-evaluating)

### COMPLETE criteria
- [ ] `LLMCritic` implements `BaseCritic`
- [ ] Uses Haiku for evaluation (configurable)
- [ ] Parses LLM response into structured `CriticScore`
- [ ] Provides specific, actionable feedback
- [ ] Cached to avoid duplicate evaluations

### VALIDATION criteria
- [ ] Submit good code → LLM critic scores > 0.7
- [ ] Submit code with obvious bug → LLM critic identifies it in feedback
- [ ] Submit incomplete implementation → completeness metric low
- [ ] Evaluation completes in < 5 seconds (Haiku)
- [ ] Same task+result evaluated twice → returns cached result

---

## Task 9.3: Quality Gate Integration & Retry Loop

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Tasks 9.1, 9.2 (needs critics), Phase 1 Task 1.3 (subscribes to events)
**Blocks**: Phase 10 (Router uses critic history), Phase 11 (Resolver requires quality gate)

### Cause & effect

```
Quality gate is WHERE the critic runs in the pipeline:

Without quality gate:
  Task completes → Marked done → Bad output accepted

With quality gate:
  Task completes → Critic evaluates →
    Pass → Mark done, extract learnings
    Fail → Return to agent with feedback (retry 1)
    Fail again → Try different agent (retry 2)
    Still fail → Escalate to human

This is the CRITICAL integration point that makes all critics useful.
```

### What to do

Create `src/critic/quality-gate.ts` and wire into mission queue.

### Interface:
```typescript
class QualityGate {
  constructor(critics: BaseCritic[], config: QualityGateConfig);

  async evaluate(task: Task, result: TaskResult): Promise<GateResult>;
}

interface GateResult {
  passed: boolean;
  scores: CriticScore[];        // From each critic
  combinedScore: number;         // Weighted average
  retryCount: number;
  action: 'accept' | 'retry' | 'reassign' | 'escalate';
  feedbackForAgent?: string;     // If retrying
}
```

### Gate flow:
```
Agent completes → QualityGate.evaluate() →
  combinedScore >= threshold →
    GateResult { action: 'accept' }
    → Mark task done
    → Emit TaskAccepted event
    → Extract learnings from critic feedback

  combinedScore < threshold AND retries < max →
    GateResult { action: 'retry', feedbackForAgent: critic.feedback }
    → Return task to same agent with feedback
    → Emit TaskRetried event

  combinedScore < threshold AND retries >= max →
    GateResult { action: 'reassign' }
    → Assign to different agent (higher model)
    → Emit TaskReassigned event

  Still failing after reassignment →
    GateResult { action: 'escalate' }
    → Mark as needs-human-review
    → Emit TaskEscalated event
```

### Modify:
- `src/pty/mission-queue.ts` — Add quality gate to task completion handler
- Store critic scores in `agent_tasks` table (new column: `critic_score REAL`, `critic_feedback TEXT`)
- Emit critic events through EventStream

### COMPLETE criteria
- [ ] QualityGate class runs all configured critics
- [ ] Retry loop: fail → feedback → retry → reassign → escalate
- [ ] Critic scores stored in `agent_tasks` for history
- [ ] Events emitted at each gate decision
- [ ] Max 2 retries before reassignment (configurable)

### VALIDATION criteria
- [ ] Integration test: Good result → passes gate, task marked done
- [ ] Integration test: Bad result → returns to agent with feedback
- [ ] Integration test: 2 bad results → reassigned to different agent
- [ ] Integration test: Still bad after reassignment → escalated
- [ ] `bun memory events --type TaskRetried` — shows retry events
- [ ] `agent_tasks` table has critic_score populated after evaluation
- [ ] `bun memory quality-report` — shows pass/fail/retry rates per agent
- [ ] Existing tests: `bun test scripts/tests/simulation.test.ts` — pass

---

## Task 9.4: Agent Performance Dashboard Data

**Assignable to**: `coder` role, `haiku` model
**Complexity**: low
**Depends on**: Task 9.3 (critic scores in DB)
**Blocks**: nothing (data layer for Phase 4 dashboard)

### What to do

Add CLI command and data queries for agent performance tracking.

```bash
bun memory quality-report              # Overall quality stats
bun memory quality-report --agent X    # Per-agent breakdown
bun memory quality-report --model      # Per-model breakdown
bun memory quality-report --trend      # Score trend over time
```

### Queries:
- Average critic score per agent (identify low performers)
- Average critic score per model (haiku vs sonnet vs opus)
- Retry rate per task type
- Escalation rate over time (should decrease)
- Most common critic feedback (what agents struggle with)

### COMPLETE criteria
- [ ] `bun memory quality-report` produces meaningful output
- [ ] Per-agent, per-model, and trend views available
- [ ] Data feeds future Phase 4 dashboard

### VALIDATION criteria
- [ ] After running several tasks through quality gate, `quality-report` shows data
- [ ] Per-agent breakdown shows different scores for different agents
- [ ] `--trend` shows score changes over time

---

## Dependency Graph

```
Phase 1 (Events) ─────────────────────────────┐
                                               ▼
                                    Task 9.1 (Critic interface + Rule-based)
                                               │
                                               ▼
                                    Task 9.2 (LLM Critic)
                                               │
                                               ▼
                                    Task 9.3 (Quality Gate integration)
                                               │
                                               ▼
                                    Task 9.4 (Performance dashboard data)
```

**Execution order**: 9.1 → 9.2 → 9.3 → 9.4 (sequential)

---

## Phase 9 → Phase 10/11 Handoff

- **Phase 10 (Router)**: Uses critic score history per model to make smarter routing decisions. If haiku consistently scores <0.5 on complex tasks, router avoids haiku for those.
- **Phase 11 (Resolver)**: Quality gate is REQUIRED before submitting a PR. Issue resolver won't create PRs that fail critic evaluation.
- **Oracle**: Agent performance data informs task assignment. Low-scoring agents get simpler tasks or retraining.
