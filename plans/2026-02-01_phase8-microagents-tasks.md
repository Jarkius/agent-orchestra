# Phase 8: Microagents — Dynamic Agent Customization — Agent Tasks

**Phase**: 8 (Tier 1)
**Priority**: P1
**Depends on**: Phase 6 Task 6.4 (needs `src/agents/` directory)

---

## Cause & Effect Chain

```
Phase 6 (src/agents/) ──► Phase 8 (Microagents)
                              │
                              ├─► Phase 9 (Critic) — Microagent compliance as quality metric
                              ├─► Phase 11 (Resolver) — Repo microagents guide issue resolution
                              └─► All agents — Dynamic knowledge injection without code changes

If skipped:
  - Every project-specific convention must be hardcoded or manually prompted
  - New team members must verbally explain project patterns to agents
  - No reusable knowledge templates across projects
  - Agent behavior can only change via code deployment
```

---

## Task 8.1: Microagent Format & Loader

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Phase 6 Task 6.4 (`src/agents/` exists)
**Blocks**: Tasks 8.2, 8.3

### What to do

Define the microagent markdown format and build the loader.

**New files:**
- `src/agents/microagent.ts` — Loader, parser, registry
- `src/agents/microagent-types.ts` — TypeScript types

### Microagent format:
```markdown
---
name: typescript-conventions
type: knowledge          # knowledge | repo | task
triggers:                # Keywords that activate this microagent
  - typescript
  - ".ts file"
  - "type error"
version: 1
priority: 10             # Higher = injected first when multiple match
---

## TypeScript Conventions

- Use `interface` over `type` for object shapes
- All async functions must have try/catch
- Prefer `unknown` over `any`
```

### Loader behavior:
1. Scan `.matrix/microagents/` in project root
2. Scan `~/.matrix/microagents/` for global microagents
3. Parse YAML frontmatter + markdown body
4. Index triggers in SQLite for fast lookup
5. On task assignment, match triggers against task description
6. Inject matched microagent content into agent system prompt

### Types:
```typescript
interface Microagent {
  name: string;
  type: 'knowledge' | 'repo' | 'task';
  triggers: string[];
  priority: number;
  content: string;        // Markdown body
  filePath: string;       // Source file
  version: number;
}

interface MicroagentMatch {
  microagent: Microagent;
  trigger: string;        // Which trigger matched
  score: number;          // Match confidence
}
```

### COMPLETE criteria
- [ ] Microagent markdown format defined with YAML frontmatter
- [ ] Loader scans project-local and global directories
- [ ] Triggers indexed in SQLite for fast lookup
- [ ] `loadMicroagents()` returns all available microagents
- [ ] `matchMicroagents(taskDescription)` returns matched microagents sorted by priority

### VALIDATION criteria
- [ ] Create a test microagent file in `.matrix/microagents/test.md`
- [ ] `loadMicroagents()` discovers it
- [ ] `matchMicroagents("fix typescript type error")` returns it (matches "typescript" and "type error" triggers)
- [ ] `matchMicroagents("update readme")` does NOT return it (no trigger match)
- [ ] Global microagent in `~/.matrix/microagents/` also loaded
- [ ] `bun test tests/unit/agents/microagent.test.ts` — all pass

---

## Task 8.2: Wire Microagents into Task Assignment

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Task 8.1 (microagent loader)
**Blocks**: Task 8.3

### Cause & effect

```
Microagents are useless if they're not injected into agent context.
The injection point is task assignment in mission-queue.ts.

Flow:
  Oracle assigns task → Match microagents against task description →
  Inject matched content into agent's system prompt/context →
  Agent works with project-specific knowledge

Without wiring:
  - Microagents exist as files but never get used
  - Agents work without project-specific context
```

### What to do

Modify `src/pty/mission-queue.ts` (or the agent context builder) to:
1. On task assignment, call `matchMicroagents(task.description)`
2. For each match, prepend microagent content to agent context
3. Track which microagents were injected (for Phase 9 effectiveness tracking)
4. Emit `MicroagentInjected` event (if Phase 1 is done)

### Context injection format:
```
## Project Knowledge (auto-injected)

### [microagent.name] (matched on: "[trigger]")
[microagent.content]

---
```

### COMPLETE criteria
- [ ] Task assignment checks for microagent matches
- [ ] Matched microagents injected into agent context
- [ ] Injection tracked: which microagents, which task, which triggers
- [ ] Multiple microagents sorted by priority, all injected

### VALIDATION criteria
- [ ] Create microagent with trigger "database", assign task "fix database query" → agent receives microagent content
- [ ] Assign task with no matching triggers → no injection (no errors)
- [ ] 3 microagents match → all 3 injected in priority order
- [ ] Check agent context/inbox for injected content
- [ ] Existing task assignment tests still pass

---

## Task 8.3: Microagent CLI & Effectiveness Tracking

**Assignable to**: `coder` role, `haiku` model
**Complexity**: low
**Depends on**: Tasks 8.1, 8.2
**Blocks**: nothing (enrichment)

### What to do

1. Add CLI commands for microagent management
2. Track effectiveness: did agents follow microagent guidance?

### CLI:
```bash
bun memory microagent list                    # Show all microagents
bun memory microagent add <name> <type>       # Create from template
bun memory microagent test "task description"  # Preview what would match
bun memory microagent stats                    # Effectiveness report
```

### Effectiveness tracking:
- Log every injection event: `{ task_id, microagent_name, trigger }`
- After task completion, Critic (Phase 9) can check if agent followed guidance
- Simple heuristic for now: if task with microagent succeeds → +1 to microagent score

### COMPLETE criteria
- [ ] CLI commands: list, add, test, stats
- [ ] `add` creates a template microagent file
- [ ] `test` shows which microagents would match a given description
- [ ] `stats` shows injection count and success rate per microagent

### VALIDATION criteria
- [ ] `bun memory microagent list` — shows loaded microagents
- [ ] `bun memory microagent test "fix typescript error"` — shows matching microagents
- [ ] `bun memory microagent add my-rules knowledge` — creates `.matrix/microagents/my-rules.md`
- [ ] `bun memory microagent stats` — shows injection counts

---

## Dependency Graph

```
Phase 6.4 (src/agents/)
    │
    ▼
Task 8.1 (Format & Loader)
    │
    ▼
Task 8.2 (Wire into assignment)
    │
    ▼
Task 8.3 (CLI & tracking)
```

**Execution order**: 8.1 → 8.2 → 8.3 (sequential)

---

## Phase 8 → Phase 9/11 Handoff

- **Phase 9 (Critic)**: Can evaluate "did agent follow microagent guidance?" as quality metric
- **Phase 11 (Resolver)**: Repo microagents provide issue-type-specific knowledge (e.g., "when fixing CSS bugs in this project, check X first")
