# Oracle Intelligence System

The Oracle is the intelligent orchestration layer that makes smart decisions about agent spawning, task routing, and workload management.

## Overview

The Oracle follows Anthropic's proven multi-agent patterns:
- **Orchestrator-Worker Pattern**: Oracle coordinates, agents execute
- **Single-Responsibility Agents**: Each agent has one job
- **Explicit Context Passing**: Every handoff includes all needed context
- **Checkpoint-Based Progress**: Agents report back at milestones

## Features

### 1. Proactive Spawning Intelligence

Instead of waiting for queue backlogs, the Oracle detects conditions that warrant spawning new agents:

| Trigger | Condition | Action |
|---------|-----------|--------|
| Queue Growth | >5 tasks/min AND no idle agents | Spawn generalist |
| Queue Depth | >5 tasks with zero idle for role | Spawn specialist |
| Complexity Mismatch | Opus task queued, only haiku available | Spawn opus agent |
| Idle Minimum | <1 idle agent per active role | Maintain coverage |

```typescript
// Example spawn trigger check
const triggers = oracle.getSpawnTriggers();
// { queueGrowthRate: 7.2, queueDepthThreshold: 6, idleAgentMinimum: 0 }

if (triggers.shouldSpawn) {
  console.log(triggers.reason); // "Queue growing at 7.2 tasks/min with no idle agents"
}
```

### 2. Task Complexity Analysis

Analyzes task prompts to determine required model tier:

| Complexity | Model | Signals |
|------------|-------|---------|
| Simple | haiku | file reads, searches, formatting, list operations |
| Moderate | sonnet | implementation, testing, standard coding tasks |
| Complex | opus | architecture, security analysis, multi-file refactoring |

```typescript
const complexity = oracle.analyzeTaskComplexity(
  "Design the microservices architecture for payment processing"
);
// {
//   tier: 'complex',
//   recommendedModel: 'opus',
//   signals: ['design', 'architecture', 'microservices'],
//   reasoning: 'Architecture decisions require deep reasoning'
// }
```

### 3. LLM-Driven Task Routing

Uses Claude Haiku for intelligent routing decisions:

```typescript
const router = getTaskRouter();
const decision = await router.routeTask(
  "Write unit tests for the payment service"
);
// {
//   recommendedRole: 'tester',
//   recommendedModel: 'sonnet',
//   shouldSpawn: false,
//   shouldDecompose: false,
//   confidence: 0.95,
//   reasoning: 'Test-writing task matches tester role'
// }
```

**Routing Considerations:**
1. Task type → Specialist role matching
2. Complexity → Model tier selection
3. Current load → Spawn vs. queue decision
4. Dependencies → Decomposition recommendation

### 4. Task Decomposition

Breaks complex tasks into subtasks for parallel/sequential execution:

```typescript
const decomposer = getTaskDecomposer();
const plan = await decomposer.decompose(
  "Refactor auth module and write comprehensive tests"
);
// {
//   originalTask: "Refactor auth module and write comprehensive tests",
//   subtasks: [
//     { id: "task_1", prompt: "Analyze current auth implementation", role: "analyst", dependsOn: [] },
//     { id: "task_2", prompt: "Refactor auth module", role: "coder", dependsOn: ["task_1"] },
//     { id: "task_3", prompt: "Write comprehensive tests", role: "tester", dependsOn: ["task_2"] }
//   ],
//   executionOrder: 'sequential',
//   totalEstimatedComplexity: 'moderate'
// }
```

### 5. Checkpoint Protocol

Agents report progress mid-task:

```typescript
// Agent sends checkpoint
{
  type: 'checkpoint',
  taskId: 'task_123',
  step: 2,
  status: 'progressing',  // or 'blocked', 'need_guidance'
  summary: 'Completed initial analysis, starting implementation',
  nextStep: 'Implement core auth logic'
}

// Oracle responds
{
  type: 'checkpoint_response',
  taskId: 'task_123',
  status: 'acknowledged',  // or 'guidance', 'escalate'
  message: 'Continue with implementation',
  extendTimeout: 60000  // Extend timeout by 1 minute
}
```

### 6. Adaptive Timeout

Extends task timeout based on checkpoint activity:

```typescript
// If agent has recent checkpoint activity, don't timeout
if (hasRecentCheckpoint(taskId, 60000)) {
  missionQueue.extendTimeout(taskId, 60000);
}
```

### 7. Pre-Task Briefing

Before dispatching tasks, Oracle provides structured guidance:

```typescript
const briefing = {
  task: "Implement user authentication",
  context: "...",

  // Oracle-generated guidance
  recommendedApproach: "Use JWT with refresh tokens, store in httpOnly cookies",
  relevantPatterns: ["auth-middleware-pattern", "token-refresh-flow"],
  commonPitfalls: ["Don't store tokens in localStorage", "Always fail closed"],
  successCriteria: ["All auth tests pass", "No security warnings"],
  checkpointSuggestions: ["Report after middleware setup", "Report after tests"]
};
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ORACLE (Orchestrator)                    │
│  - Global planning & strategy                               │
│  - Task decomposition                                       │
│  - Agent spawning decisions                                 │
│  - State management (SQLite + shared context)               │
│  - Read and route only (narrow tool permissions)            │
└───────────────┬───────────────────────────────┬─────────────┘
                │                               │
    ┌───────────▼───────────┐       ┌───────────▼───────────┐
    │   Subagent: Coder     │       │   Subagent: Tester    │
    │   Single responsibility│       │   Single responsibility│
    │   Clear objective      │       │   Clear objective      │
    │   Output format spec   │◄─────►│   Output format spec   │
    │   Tool allowlist       │       │   Tool allowlist       │
    └───────────┬───────────┘       └───────────┬───────────┘
                │                               │
                └───────────┬───────────────────┘
                            ▼
                    ┌───────────────┐
                    │  Checkpoint   │
                    │  & Consult    │
                    │  Back to      │
                    │  Oracle       │
                    └───────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `src/oracle/orchestrator.ts` | Main orchestrator with workload analysis |
| `src/oracle/task-router.ts` | LLM-driven task routing |
| `src/oracle/task-decomposer.ts` | Complex task breakdown |
| `src/oracle/index.ts` | Public exports |

## Testing

The Oracle system has comprehensive test coverage:

```bash
# Run all tests (89 tests: 74 Oracle + 15 Phase 5)
bun test scripts/tests/task-routing.test.ts scripts/tests/oracle-spawning.test.ts scripts/tests/simulation.test.ts scripts/tests/chaos.test.ts scripts/tests/sonnet-extraction.test.ts

# Individual test suites
bun test scripts/tests/task-routing.test.ts      # 27 tests - routing & decomposition
bun test scripts/tests/oracle-spawning.test.ts   # 17 tests - spawning & complexity
bun test scripts/tests/simulation.test.ts        # 17 tests - end-to-end workflows
bun test scripts/tests/chaos.test.ts             # 13 tests - failure resilience
```

### Test Coverage

| Suite | Tests | Coverage |
|-------|-------|----------|
| Task Routing | 27 | Role inference, model selection, decomposition detection |
| Oracle Spawning | 17 | Proactive spawning, complexity analysis |
| Simulation | 17 | Multi-agent workflows, token efficiency |
| Chaos | 13 | Agent crashes, timeouts, recovery |
| Sonnet Extraction | 15 | Quality scoring, smart distill, smart dedup |

## Token Efficiency

Multi-agent systems use ~15x more tokens than single chat. Mitigation strategies:

| Strategy | Implementation |
|----------|----------------|
| Haiku for simple | Route grep, file reads, simple queries to haiku |
| Sonnet as default | Most tasks go to balanced sonnet tier |
| Opus for complex only | Architecture, multi-step reasoning, novel problems |
| Context pruning | Pass only relevant learnings, not full history |
| Checkpoint summaries | Agents report summaries, not full transcripts |
| Early termination | Stop agents that are clearly stuck (3 failed attempts) |

## Usage Examples

### Spawn Agents with Intelligence

```bash
# Oracle auto-selects roles and models
./scripts/spawn/spawn_claude_agents.sh 5
```

### Distribute Task with Routing

```typescript
import { getTaskRouter } from './src/oracle/task-router';

const router = getTaskRouter();
const decision = await router.routeTask(task);

if (decision.shouldDecompose) {
  const decomposer = getTaskDecomposer();
  const plan = await decomposer.decompose(task);
  // Execute subtasks according to plan
}
```

### Check Workload Analysis

```typescript
import { getOracleOrchestrator } from './src/oracle/orchestrator';

const oracle = getOracleOrchestrator();
const analysis = oracle.analyzeWorkload();

console.log('Utilization:', analysis.overallUtilization);
console.log('Bottlenecks:', analysis.bottlenecks);
console.log('Recommendations:', analysis.recommendations);
```

## Phase 5: LLM-Enhanced Learning (NEW)

The learning system now supports Claude Sonnet for higher-quality extraction:

### Smart Distill

```bash
# Use Sonnet for extraction (higher quality)
bun memory distill --smart

# Also run smart deduplication
bun memory distill --smart --dedupe

# Auto-accept all (batch mode)
bun memory distill --smart --yes
```

### Quality Scoring

Learnings are scored on four dimensions:
- **Specificity** (0-1): How specific vs generic
- **Actionability** (0-1): Can someone act on this?
- **Evidence** (0-1): Supporting data/metrics
- **Novelty** (0-1): New insight vs common knowledge

### Smart Deduplication

Uses Sonnet to:
1. Verify if candidates are true duplicates
2. Select the best version to keep
3. Merge unique content from all versions

### Files

| File | Purpose |
|------|---------|
| `src/learning/quality-scorer.ts` | Quality scoring for learnings |
| `src/learning/distill-engine.ts` | Enhanced with `smartDistill()` |
| `src/learning/consolidation.ts` | Enhanced with `smartDeduplicate()` |

### Testing

```bash
# Run Phase 5 tests (15 tests)
bun test scripts/tests/sonnet-extraction.test.ts
```

---

## Research Sources

Based on Anthropic's official multi-agent patterns:
- [Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Building Agents with Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
