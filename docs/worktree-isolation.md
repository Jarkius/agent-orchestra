# Git Worktree Isolation

Enable multiple agents to work simultaneously on the same repository without file conflicts.

## Overview

When multiple agents (Neo, Smith, Oracle) work in parallel, they may modify the same files. Git worktrees solve this by giving each agent its own isolated checkout with a unique branch.

```
/workspace/project/              (main repo - base branch)
├── .git/
├── src/
└── .worktrees/                  (agent worktrees)
    ├── agent-1/                 (branch: agent-1/work-1705...)
    │   └── src/                 (isolated copy)
    ├── agent-2/                 (branch: agent-2/work-1705...)
    │   └── src/                 (isolated copy)
    └── agent-3/                 (branch: agent-3/work-1705...)
        └── src/                 (isolated copy)
```

## How It Works

1. **Provision** - Agent gets a new worktree with unique branch
2. **Work** - Agent makes changes in isolation (no conflicts)
3. **Merge** - Work is merged back to base branch
4. **Cleanup** - Worktree and branch are removed

```
Agent spawns
     │
     ▼
┌─────────────┐
│  provision  │ → Creates worktree + branch
└─────────────┘
     │
     ▼
┌─────────────┐
│    work     │ → Agent works in isolation
└─────────────┘
     │
     ▼
┌─────────────┐     ┌─────────────┐
│   merge     │ ──► │  conflict?  │
└─────────────┘     └─────────────┘
     │                    │
     │ success       abort/resolve
     ▼                    │
┌─────────────┐           │
│   cleanup   │ ◄─────────┘
└─────────────┘
```

## Usage

### Basic Usage

```typescript
import { getWorktreeManager } from './pty/worktree-manager';

const manager = getWorktreeManager('/path/to/repo');

// Provision worktree for agent
const info = await manager.provision(agentId);
// {
//   agentId: 1,
//   path: '/path/to/repo/.worktrees/agent-1',
//   branch: 'agent-1/work-1705678901234',
//   baseBranch: 'main',
//   status: 'active'
// }

// Agent works in info.path...

// Merge work back
const result = await manager.merge(agentId);
// { success: true, commitHash: 'abc123' }

// Cleanup
await manager.cleanup(agentId);
```

### With AgentSpawner

```typescript
import { getAgentSpawner } from './pty/spawner';

const spawner = getAgentSpawner();

// Spawn with worktree isolation
const agent = await spawner.spawnAgent({
  role: 'coder',
  model: 'sonnet',
  isolationMode: 'worktree',  // Enable worktree
});

// Agent automatically works in its worktree
console.log(agent.worktreePath);   // /path/.worktrees/agent-1
console.log(agent.worktreeBranch); // agent-1/work-1705...
```

## Configuration

### WorktreeConfig

```typescript
interface WorktreeConfig {
  enabled: boolean;              // Enable worktree isolation
  basePath?: string;             // Worktree directory (default: .worktrees)
  branchStrategy?: BranchStrategy;  // per-agent or per-task
  baseBranch?: string;           // Base branch (default: auto-detect)
  autoMerge?: boolean;           // Auto-merge on completion
  cleanupOnShutdown?: boolean;   // Remove on agent shutdown
  conflictStrategy?: ConflictStrategy;  // How to handle conflicts
}
```

### Branch Strategies

| Strategy | Branch Name | Use Case |
|----------|-------------|----------|
| `per-agent` | `agent-1/work-{timestamp}` | Long-running agents |
| `per-task` | `agent-1/task-{taskId}` | Task-specific branches |

### Conflict Strategies

| Strategy | Behavior |
|----------|----------|
| `abort` | Abort merge, preserve branch for manual resolution |
| `stash` | Stash uncommitted changes, then merge |
| `theirs` | Accept all incoming changes |
| `ours` | Keep all existing changes |

## API Reference

### WorktreeManager

```typescript
class WorktreeManager {
  // Provision new worktree
  provision(agentId: number, taskId?: string): Promise<WorktreeInfo>;

  // Merge work back to base branch
  merge(agentId: number): Promise<MergeResult>;

  // Remove worktree
  cleanup(agentId: number): Promise<void>;

  // Sync with base branch
  syncWithBase(agentId: number, strategy: 'rebase' | 'merge'): Promise<boolean>;

  // Get worktree info
  getWorktree(agentId: number): WorktreeInfo | null;
  getAllWorktrees(): WorktreeInfo[];

  // Get git status
  getWorktreeStatus(agentId: number): Promise<{ clean: boolean; changes: string[] }>;

  // List all git worktrees
  listAllGitWorktrees(): Promise<string[]>;

  // Cleanup all worktrees
  shutdown(): Promise<void>;
}
```

### WorktreeInfo

```typescript
interface WorktreeInfo {
  agentId: number;
  path: string;           // Filesystem path
  branch: string;         // Git branch name
  baseBranch: string;     // Base branch (main/master)
  createdAt: Date;
  status: 'active' | 'merged' | 'conflict' | 'cleaned';
}
```

### MergeResult

```typescript
interface MergeResult {
  success: boolean;
  conflictFiles?: string[];  // Files with conflicts
  commitHash?: string;       // Merge commit hash
  error?: string;            // Error message
}
```

## MCP Tools

All worktree operations are consolidated into a single `worktree` tool with an `action` parameter.

### worktree

Unified worktree management.

```json
{
  "action": "provision",
  "agent_id": 1,
  "task_id": "task-123",
  "base_branch": "develop",
  "conflict_strategy": "abort"
}
```

**Actions:**

| Action | Required Params | Description |
|--------|-----------------|-------------|
| `provision` | `agent_id` | Create worktree for agent |
| `merge` | `agent_id` | Merge work back to base branch |
| `sync` | `agent_id` | Sync with base (optional: `strategy`) |
| `cleanup` | `agent_id` | Remove worktree |
| `status` | `agent_id` | Get worktree status |
| `list` | - | List all worktrees |

### Example Responses

**provision:**
```json
{
  "agent_id": 1,
  "path": "/workspace/.worktrees/agent-1",
  "branch": "agent-1/work-1705678901234",
  "base_branch": "main",
  "status": "active"
}
```

**merge:**
```json
{
  "success": true,
  "agent_id": 1,
  "branch": "agent-1/work-1705678901234",
  "commit_hash": "abc123def456"
}
```

**status:**
```json
{
  "agent_id": 1,
  "has_worktree": true,
  "path": "/workspace/.worktrees/agent-1",
  "branch": "agent-1/work-1705678901234",
  "status": "active",
  "clean": false,
  "changes": ["M src/file.ts", "?? src/new.ts"]
}
```

**list:**
```json
{
  "managed_worktrees": [
    {
      "agent_id": 1,
      "path": "/workspace/.worktrees/agent-1",
      "branch": "agent-1/work-1705678901234",
      "status": "active"
    }
  ],
  "managed_count": 1,
  "git_worktrees": ["/workspace", "/workspace/.worktrees/agent-1"],
  "git_worktree_count": 2
}
```

## Handling Conflicts

When two agents modify the same file:

```
Agent 1: modifies src/shared.ts
Agent 2: modifies src/shared.ts

Agent 1 merges first → Success
Agent 2 tries to merge → Conflict!
```

### Default (abort)

```typescript
const result = await manager.merge(2);
// {
//   success: false,
//   error: 'Merge conflict',
//   conflictFiles: ['src/shared.ts']
// }

// Branch preserved: agent-2/work-xxx
// Manual resolution required
```

### Auto-resolve (theirs)

```typescript
const manager = getWorktreeManager(path, {
  conflictStrategy: 'theirs'  // Accept agent's changes
});

const result = await manager.merge(2);
// { success: true }
// Agent 2's version wins
```

## Workflow Examples

### Parallel Feature Development

```typescript
// Spawn 3 agents for different features
const agents = await Promise.all([
  spawner.spawnAgent({ role: 'coder', isolationMode: 'worktree' }),
  spawner.spawnAgent({ role: 'coder', isolationMode: 'worktree' }),
  spawner.spawnAgent({ role: 'coder', isolationMode: 'worktree' }),
]);

// Assign different tasks
await queue.enqueue({ prompt: 'Implement auth', assignTo: agents[0].id });
await queue.enqueue({ prompt: 'Implement search', assignTo: agents[1].id });
await queue.enqueue({ prompt: 'Implement export', assignTo: agents[2].id });

// All work in parallel without conflicts!
// Each agent has its own branch
```

### Sequential Review

```typescript
// Coder works
const coder = await spawner.spawnAgent({
  role: 'coder',
  isolationMode: 'worktree'
});
// ... coder completes work ...

// Merge coder's work
await manager.merge(coder.id);

// Reviewer checks merged code
const reviewer = await spawner.spawnAgent({
  role: 'reviewer',
  isolationMode: 'worktree'
});
// ... reviewer works on merged code ...
```

## Best Practices

1. **Always use worktree isolation** for parallel agents
2. **Merge frequently** to avoid large conflicts
3. **Use `abort` strategy** for important changes (manual review)
4. **Cleanup after completion** to avoid disk bloat
5. **Sync with base** before long tasks to stay current

## Troubleshooting

### "Worktree already exists"

```bash
# Prune orphaned worktrees
git worktree prune

# Or force remove
git worktree remove --force .worktrees/agent-1
```

### "Branch already exists"

```bash
# Delete the branch
git branch -D agent-1/work-xxx

# Or let WorktreeManager handle it (auto-deletes on provision)
```

### Merge conflicts

```bash
# Check conflict files
git status

# Resolve manually
git checkout --theirs src/file.ts  # or --ours
git add src/file.ts
git commit
```

## Testing

```bash
# Run worktree tests
bun test src/pty/tests/worktree-manager.test.ts

# 27 tests covering:
# - provision/merge/cleanup lifecycle
# - parallel work without conflicts
# - conflict handling
# - branch strategies
# - shutdown cleanup
```
