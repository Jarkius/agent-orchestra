# PTY Orchestration

Platform-aware pseudo-terminal management for spawning and coordinating Claude CLI agents.

## Overview

The PTY system manages agent lifecycle through tmux, providing:
- Agent spawning in isolated panes
- Health monitoring with auto-restart
- Role-based task distribution
- Mission queue with priorities and dependencies

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AgentSpawner                            │
│  - Role assignment (coder, tester, oracle, etc.)            │
│  - Model tier selection (haiku, sonnet, opus)               │
│  - Task distribution to available agents                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      PTYManager                              │
│  - tmux session management                                   │
│  - Pane creation and lifecycle                              │
│  - Health checks and auto-restart                           │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  Pane 1  │    │  Pane 2  │    │  Pane 3  │
    │ Agent 1  │    │ Agent 2  │    │ Agent 3  │
    └──────────┘    └──────────┘    └──────────┘
```

## Components

### PTYManager

Handles low-level tmux operations.

```typescript
import { getPTYManager } from './pty/manager';

const manager = getPTYManager('my-session');

// Spawn agent in new pane
const handle = await manager.spawn(1, {
  cwd: '/path/to/project',
  shell: '/bin/zsh',
  healthCheckIntervalMs: 5000,
  autoRestart: true,
});

// Health check
const health = await manager.healthCheck(1);
// { alive: true, responsive: true, memoryUsage: 1234567, cpuUsage: 2.5 }

// Kill agent
await manager.kill(1, 'SIGTERM');

// Watch all events
for await (const event of manager.watchAll()) {
  console.log(event.type, event.agentId);
  // spawn, crash, restart, health, task_start, task_complete, etc.
}
```

### AgentSpawner

Role-based agent management with task distribution.

```typescript
import { getAgentSpawner } from './pty/spawner';

const spawner = getAgentSpawner();

// Spawn single agent
const agent = await spawner.spawnAgent({
  role: 'coder',
  model: 'sonnet',
  systemPrompt: 'Custom prompt...',
  isolationMode: 'worktree',
});

// Spawn pool of agents
const agents = await spawner.spawnPool(3, {
  role: 'tester',
  model: 'haiku',
});

// Get specialists
const coders = spawner.getSpecialists('coder');
const opusAgents = spawner.getAgentsByModel('opus');

// Distribute task to best agent
const task = {
  id: 'task-1',
  prompt: 'Implement feature X',
  type: 'coding',
  priority: 'high',
};
const assigned = await spawner.distributeTask(task);
```

### MissionQueue

Priority-based task queue with retry logic.

```typescript
import { getMissionQueue } from './pty/mission-queue';

const queue = getMissionQueue();

// Enqueue mission
const missionId = queue.enqueue({
  prompt: 'Review this PR',
  context: 'PR #123...',
  priority: 'high',
  type: 'review',
  timeoutMs: 120000,
  maxRetries: 3,
  dependsOn: ['mission-1'],  // Wait for dependency
});

// Dequeue for agent
const mission = queue.dequeue(agentId);

// Complete or fail
queue.complete(missionId, {
  output: 'Review complete...',
  durationMs: 5000,
  tokenUsage: { input: 1000, output: 500 },
});

queue.fail(missionId, {
  code: 'timeout',
  message: 'Agent timed out',
  recoverable: true,
});

// Query status
const pending = queue.getPending();
const blocked = queue.getBlocked();
const stats = queue.getStats();
```

## Agent Roles

Each role has a specialized system prompt and default model tier.

| Role | Default Model | System Prompt |
|------|---------------|---------------|
| `oracle` | opus | Orchestrate workflow, ensure mission alignment |
| `architect` | opus | System design, architecture decisions |
| `coder` | sonnet | Implementation, clean code, best practices |
| `analyst` | sonnet | Requirements analysis, problem breakdown |
| `reviewer` | sonnet | Code review, improvements, maintainability |
| `tester` | haiku | Test coverage, edge cases, QA |
| `debugger` | sonnet | Find and fix issues |
| `researcher` | haiku | Gather information, analysis |
| `scribe` | haiku | Documentation, session capture |
| `generalist` | sonnet | Any task |

## Model Tier Selection

Automatic model selection based on task properties:

```typescript
function selectModel(task: Task): ModelTier {
  if (task.priority === 'critical' || task.type === 'synthesis') {
    return 'opus';
  }
  if (task.type === 'analysis' || task.type === 'review') {
    return 'sonnet';
  }
  return 'haiku';
}
```

| Task Type | Priority | Model |
|-----------|----------|-------|
| synthesis | any | opus |
| any | critical | opus |
| analysis | any | sonnet |
| review | any | sonnet |
| extraction | any | haiku |
| general | normal/low | haiku |

## Health Monitoring

The PTYManager continuously monitors agent health:

```typescript
interface HealthStatus {
  alive: boolean;        // Process running
  responsive: boolean;   // Pane responding
  lastHeartbeat: Date;
  memoryUsage?: number;  // Bytes
  cpuUsage?: number;     // Percentage
  idleTimeMs?: number;
}
```

Auto-restart behavior:
1. Health check detects crash (`alive: false`)
2. Status updated to `crashed`
3. `crash` event emitted
4. After 2 second delay, agent is restarted
5. `restart` event emitted

## Agent Events

Subscribe to agent lifecycle events:

```typescript
const manager = getPTYManager();

for await (const event of manager.watchAll()) {
  switch (event.type) {
    case 'spawn':
      console.log(`Agent ${event.agentId} spawned`);
      break;
    case 'crash':
      console.log(`Agent ${event.agentId} crashed`);
      break;
    case 'restart':
      console.log(`Agent ${event.agentId} restarted`);
      break;
    case 'health':
      console.log(`Agent ${event.agentId} health:`, event.data);
      break;
    case 'task_start':
      console.log(`Agent ${event.agentId} started task`);
      break;
    case 'task_complete':
      console.log(`Agent ${event.agentId} completed task`);
      break;
  }
}
```

## MCP Tools

Tools are consolidated with `action` parameters for efficiency.

### agent

Unified agent lifecycle management.

```json
{
  "action": "spawn",
  "role": "coder",
  "model": "sonnet",
  "system_prompt": "Custom prompt...",
  "auto_restart": true
}
```

Actions:
- `spawn` - Spawn single agent
- `spawn_pool` - Spawn multiple agents (requires `count`)
- `kill` - Terminate agent (requires `agent_id`)
- `restart` - Restart agent (requires `agent_id`)
- `health` - Check single agent health (requires `agent_id`)
- `health_all` - Check all agents health
- `status` - List all agents with stats

### mission

Unified mission queue operations.

```json
{
  "action": "distribute",
  "prompt": "Implement feature X",
  "context": "Additional context...",
  "priority": "high",
  "type": "coding",
  "timeout_ms": 120000,
  "max_retries": 3,
  "depends_on": ["mission-1"]
}
```

Actions:
- `distribute` - Assign task to best agent
- `complete` - Mark mission complete (requires `mission_id`, `output`)
- `fail` - Report failure (requires `mission_id`, `error_code`, `message`)
- `status` - Get queue status

### Example: Agent Status Response

```json
{
  "total_agents": 3,
  "active_agents": 1,
  "agents": [
    {
      "id": 1,
      "name": "agent-1",
      "role": "coder",
      "model": "sonnet",
      "status": "busy",
      "current_task": "task-1",
      "tasks_completed": 5,
      "tasks_failed": 0,
      "success_rate": "100.0%"
    }
  ],
  "by_role": { "coder": 1, "tester": 2 },
  "by_model": { "haiku": 2, "sonnet": 1 }
}
```

## Configuration

### PTYConfig

```typescript
interface PTYConfig {
  cwd?: string;                    // Working directory
  env?: Record<string, string>;    // Environment variables
  shell?: string;                  // Shell (default: /bin/zsh)
  cols?: number;                   // Terminal columns (default: 120)
  rows?: number;                   // Terminal rows (default: 30)
  healthCheckIntervalMs?: number;  // Health check interval (default: 5000)
  autoRestart?: boolean;           // Auto-restart on crash (default: true)
  worktree?: WorktreeConfig;       // Git worktree settings
}
```

### AgentConfig

```typescript
interface AgentConfig extends PTYConfig {
  role?: AgentRole;              // Agent specialization
  model?: ModelTier;             // Model tier
  systemPrompt?: string;         // Custom system prompt
  maxConcurrentTasks?: number;   // Task limit per agent
  timeoutMs?: number;            // Default task timeout
  retryBudget?: number;          // Max retries per task
  isolationMode?: 'worktree' | 'shared';  // Git isolation
}
```

## Testing

```bash
# Run all PTY tests
bun test src/pty/tests/

# Run specific test file
bun test src/pty/tests/spawner.test.ts

# 105 tests across 5 files
```

## Best Practices

1. **Use worktree isolation** for parallel work on the same codebase
2. **Match model to task** - haiku for bulk, sonnet for analysis, opus for synthesis
3. **Set appropriate timeouts** - prevent runaway tasks
4. **Monitor health events** - handle crashes gracefully
5. **Use mission dependencies** - ensure proper task ordering
