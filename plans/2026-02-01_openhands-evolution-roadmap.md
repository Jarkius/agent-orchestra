# Plan: OpenHands-Inspired Evolution Roadmap

**Created**: 2026-02-01
**Branch**: feat/openhands-synthesis
**Status**: Planning
**Source**: Deep dive analysis of [OpenHands](https://github.com/OpenHands/OpenHands) (SWEBench 77.6%)

## Context

OpenHands is a mature, production-grade AI coding platform with:
- Event-driven agent loop (Action → Observation typed events)
- Sandboxed runtimes (Docker, K8s, Remote, Local)
- Security analyzer framework (LOW/MEDIUM/HIGH risk scoring)
- Full web UI (React 19 + Vite + Tailwind)
- Browser automation via Playwright
- Memory condensation strategies (6 types)
- MCP integration with stdio/SSE/SHTTP transports

Agent Orchestra already **exceeds** OpenHands in:
- Memory system (confidence-tracked learnings, semantic search)
- Multi-agent orchestration (Oracle intelligence, proactive spawning)
- Cross-instance communication (Matrix Hub)
- Knowledge graph (entity extraction, relationships)

What OpenHands has that we don't:
- Unified event stream architecture
- Execution sandboxing (Docker/K8s runtime)
- Security analysis before action execution
- Human-facing web UI
- Browser automation (headless Playwright)
- Real-time context condensation

---

## Phase 1: Event Stream Foundation

> *"The EventStream is the nervous system."*

### Problem

Agent Orchestra uses 3 fragmented communication layers: WebSocket (:8080), File IPC (`./data/agent_inbox/`), and Matrix Hub (:8081). No unified event log with causality tracking.

### Solution

Add a typed `EventStream` layer inspired by OpenHands' `events/stream.py`.

### Implementation

**New files:**
- `src/events/event.ts` — Base Event class with `id`, `timestamp`, `source`, `cause` (parent event ID)
- `src/events/action.ts` — Action types: `CmdRunAction`, `FileEditAction`, `TaskAssignAction`, `MCPAction`
- `src/events/observation.ts` — Observation types: `CmdOutputObservation`, `ErrorObservation`, `TaskResultObservation`
- `src/events/stream.ts` — EventStream pub/sub with SQLite persistence

**Modify:**
- `src/pty/mission-queue.ts` — Emit events on mission state changes
- `src/mcp/tools/handlers/task.ts` — Emit events on task assignment/completion
- `src/db/core.ts` — Add `events` table (id, type, source, cause_id, payload JSON, timestamp)

**Reference:** OpenHands `openhands/events/stream.py` (thread-safe pub/sub with subscriber IDs)

### Success Criteria
- [ ] All agent actions emit typed events
- [ ] Events stored in SQLite with causality chain
- [ ] Full session replay from event log
- [ ] `bun memory events [session]` shows event timeline

### Effort: Medium

---

## Phase 2: Runtime Abstraction & Sandboxing

> *"Agents should never be able to `rm -rf /`."*

### Problem

Agents execute directly via tmux PTY on the host machine. No isolation beyond git worktrees (code only, not execution).

### Solution

Abstract execution behind a `Runtime` interface. Add Docker runtime for sandboxed execution.

### Implementation

**New files:**
- `src/runtime/base.ts` — Abstract `Runtime` interface
- `src/runtime/local.ts` — Wraps existing PTY execution (current behavior)
- `src/runtime/docker.ts` — Docker container per agent with resource limits
- `src/runtime/remote.ts` — HTTP-based execution on remote machines

**Interface:**
```typescript
interface Runtime {
  connect(): Promise<void>;
  executeAction(action: Action): Promise<Observation>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  close(): Promise<void>;
}
```

**Reference:** OpenHands `openhands/runtime/base.py` (abstract runtime with Docker/Local/Remote/K8s implementations)

### Success Criteria
- [ ] Existing PTY behavior wrapped as `LocalRuntime`
- [ ] `DockerRuntime` spawns isolated container per agent
- [ ] Resource limits configurable (CPU, memory, timeout)
- [ ] Runtime selection via config: `runtime: "local" | "docker" | "remote"`
- [ ] Existing tests pass with `LocalRuntime`

### Effort: High

---

## Phase 3: Security Analyzer

> *"Trust, but verify before execution."*

### Problem

No security layer. Agents can execute any command, including destructive ones (`rm -rf`, `git push --force`, accessing secrets).

### Solution

Add pluggable security analyzers that evaluate every action before execution.

### Implementation

**New files:**
- `src/security/analyzer.ts` — Base `SecurityAnalyzer` interface
- `src/security/risk-levels.ts` — `LOW | MEDIUM | HIGH` enum with `ActionConfirmationStatus`
- `src/security/rule-based.ts` — Pattern-matching analyzer (blocklist destructive commands)
- `src/security/llm-based.ts` — LLM-scored risk assessment (use Haiku for speed)

**Modify:**
- `src/pty/mission-queue.ts` — Check risk before execution
- `src/mcp/tools/handlers/task.ts` — Return `awaiting_confirmation` for HIGH-risk actions
- `src/db/core.ts` — Add `security_decisions` table for audit trail

**Risk patterns:**
```
HIGH: rm -rf, git push --force, DROP TABLE, env vars with secrets, sudo
MEDIUM: git push, npm publish, file write outside project, network calls
LOW: git status, file read, code search, test execution
```

**Reference:** OpenHands `openhands/security/analyzer.py` + `openhands/events/action/action.py` (ActionSecurityRisk enum)

### Success Criteria
- [ ] All agent actions pass through security check
- [ ] HIGH-risk actions require human confirmation
- [ ] Audit trail in SQLite
- [ ] `bun memory security-log` shows decisions
- [ ] Configurable: `security: { mode: "permissive" | "strict" | "paranoid" }`

### Effort: Medium

---

## Phase 4: Human-Facing Web Dashboard

> *"The Oracle needs a face."*

### Problem

Agent Orchestra has **zero visual interface**. Everything is CLI (`bun memory ...`) or tmux panes. Humans can't easily:
- Watch agents work in real-time
- Review security decisions
- Browse memory/learnings visually
- See cost metrics
- Approve/reject HIGH-risk actions

### Solution

Build a web dashboard. OpenHands uses React 19 + Vite + Tailwind + Zustand + TanStack Query + Socket.IO.

### OpenHands UI Features (for reference)

| Feature | OpenHands Implementation | Our Priority |
|---------|--------------------------|-------------|
| Chat interface | Message bubbles + markdown | P1 |
| Terminal view | Embedded xterm.js | P1 |
| Agent status | Real-time via Socket.IO | P1 |
| Planner tab | Markdown plan rendering | P2 |
| Code editor | Monaco editor | P3 |
| Browser view | Playwright screenshots | P3 |
| Settings | LLM config, model selection | P2 |
| Security review | Action approval UI | P1 (if Phase 3 done) |
| Conversation history | Sidebar panel | P2 |
| Metrics | Token usage, cost tracking | P2 |
| Microagent mgmt | Skill CRUD | P3 |

### Implementation

**New directory:** `dashboard/`

**Stack (aligned with Bun ecosystem):**
- **Framework**: React 19 + Vite (same as OpenHands)
- **State**: Zustand (lightweight, matches our TypeScript patterns)
- **Data**: TanStack Query for server state
- **Styling**: Tailwind CSS
- **Real-time**: WebSocket (reuse existing :8080 server)
- **Charts**: Lightweight charting for metrics

**MVP pages:**
1. **Agent Dashboard** — Live agent status, health, current tasks
2. **Memory Browser** — Search sessions, learnings, knowledge graph
3. **Event Timeline** — Real-time event stream (from Phase 1)
4. **Security Console** — Review/approve HIGH-risk actions (from Phase 3)
5. **Oracle Console** — Task routing decisions, mission queue

**API layer:**
- Extend existing WebSocket server (`:8080`) with dashboard events
- Add REST endpoints in MCP server for data queries
- SSE for real-time event streaming (reuse `matrix-watch.ts` pattern)

**Reference:** OpenHands `frontend/src/` — React 19 + Zustand stores + TanStack Query hooks + Socket.IO

### Success Criteria
- [ ] Dashboard accessible at `http://localhost:3000`
- [ ] Live agent status with health indicators
- [ ] Memory search with semantic results
- [ ] Event timeline with filtering
- [ ] Security action approval (if Phase 3 complete)
- [ ] `bun run dashboard` starts the UI

### Effort: High

---

## Phase 5: Browser Automation & Context Condensation

> *"See the web. Compress the mind."*

### Problem A: No Browser Automation
Research agents can't browse the web autonomously. Currently depends on Claude-in-Chrome MCP extension.

### Problem B: No Context Condensation
Long agent sessions hit token limits with no strategy for compressing old context.

### Solution A: Headless Playwright

**New files:**
- `src/runtime/browser.ts` — Playwright wrapper for headless browsing
- `src/mcp/tools/handlers/browse.ts` — Browse tools (goto, click, fill, screenshot)

**Reference:** OpenHands `openhands/runtime/browser/` + `openhands/agenthub/codeact_agent/tools/browser.py`

### Solution B: Memory Condensers

**New files:**
- `src/memory/condenser.ts` — Base condenser interface
- `src/memory/condensers/recent.ts` — Keep N recent events
- `src/memory/condensers/llm.ts` — LLM-based summarization
- `src/memory/condensers/observation-masking.ts` — Mask old observations

**Reference:** OpenHands `openhands/memory/condenser/` (6 strategies: noop, recent, observation_masking, llm, amortized, llm_attention)

### Success Criteria
- [ ] `researcher` agents can browse URLs headlessly
- [ ] Screenshot capture in observations
- [ ] Context condenser prevents token overflow
- [ ] Condenser strategy configurable per agent role
- [ ] `bun test scripts/tests/browser.test.ts` passes

### Effort: High

---

## Phase 6: Codebase Restructuring & Maintainability

> *"Clean the house before inviting guests."*

### Problem

Structure audit reveals significant maintainability debt:
- **God objects**: `vector-db.ts` (2,193 lines), `db/core.ts` (1,118 lines), `oracle/orchestrator.ts` (1,047 lines)
- **Misplaced files**: `orchestrator.ts` is a UI dashboard, not core orchestration logic
- **Duplicate directories**: `psi/` vs `ψ/` (unicode naming causes tooling issues)
- **Scattered tests**: 4 different locations (`scripts/tests/`, `tests/`, `src/**/*.test.ts`, inline)
- **No CLI framework**: 38 scripts in `scripts/memory/` with ad-hoc argument parsing
- **Catch-all `services/`**: Mixed responsibilities without clear boundaries

### Implementation

**6a. Split god objects:**
- `src/vector-db.ts` → `src/vector/client.ts`, `src/vector/collections.ts`, `src/vector/search.ts`, `src/vector/embeddings.ts`
- `src/db/core.ts` → `src/db/schema.ts`, `src/db/migrations.ts`, `src/db/connection.ts`, `src/db/locking.ts`
- `src/oracle/orchestrator.ts` → `src/oracle/analyzer.ts`, `src/oracle/rebalancer.ts`, `src/oracle/spawning.ts`

**6b. Consolidate directory structure:**
```
src/
├── agents/          # Agent lifecycle (merge soul/ into here)
├── cli/             # CLI framework with subcommands
├── db/              # Database (split from core.ts)
├── events/          # Phase 1 event stream
├── indexer/         # Code indexer (stays)
├── learning/        # Knowledge extraction (stays)
├── matrix/          # Hub, daemon, client (consolidate)
├── mcp/             # MCP server and tools (stays)
├── memory/          # Phase 5 condensers
├── oracle/          # Task routing (split from god object)
├── pty/             # PTY spawner, mission queue (stays)
├── runtime/         # Phase 2 runtimes
├── security/        # Phase 3 analyzers
├── vector/          # ChromaDB (split from vector-db.ts)
└── utils/           # Shared utilities
tests/               # ALL tests consolidated here
  ├── unit/
  ├── integration/
  └── e2e/
```

**6c. Consolidate `psi/` and `ψ/`:**
- Keep `psi/` (ASCII-safe), migrate content from `ψ/`
- Update all references

**6d. CLI framework:**
- Replace 38 ad-hoc scripts with a unified CLI entry point
- `bun memory <command>` routes through `src/cli/index.ts`
- Subcommand auto-discovery from `src/cli/commands/`

### Success Criteria
- [ ] No file exceeds 500 lines
- [ ] All tests in `tests/` directory with clear unit/integration/e2e split
- [ ] `psi/` is the single knowledge directory (no `ψ/` duplicate)
- [ ] CLI has `--help` for every command
- [ ] All existing tests still pass after restructuring

### Effort: Medium (refactoring, no new features)

---

## Phase 7: Stuck Detection & Self-Healing

> *"An agent that knows it's stuck is already halfway unstuck."*

### Problem

Agents can enter infinite loops — repeating the same failing command, alternating between two states, or generating monologues without progress. Currently no detection or recovery mechanism.

### Solution

Port OpenHands' 5-heuristic stuck detection system, adapted for our multi-agent context.

### Implementation

**New files:**
- `src/agents/stuck-detector.ts` — Heuristic engine with pluggable detectors
- `src/agents/detectors/` — Individual heuristic modules

**Heuristics (from OpenHands `controller/stuck.py`):**

| # | Heuristic | Detection | Recovery |
|---|-----------|-----------|----------|
| 1 | **Repeating action** | Same action emitted 3+ times consecutively | Force different approach or escalate |
| 2 | **Monologue** | 4+ consecutive think/message actions with no tool use | Inject nudge: "Take an action" |
| 3 | **Action-error alternation** | Alternating between same action and same error | Switch strategy or assign to different agent |
| 4 | **Condensation loop** | Condenser triggers while agent retries same failing context | Break context window, summarize and restart |
| 5 | **Token exhaustion spiral** | Approaching token limit with no progress markers | Force checkpoint, spawn fresh agent with summary |

**Modify:**
- `src/pty/mission-queue.ts` — Wire stuck detector into agent monitoring loop
- `src/oracle/orchestrator.ts` — Receive stuck signals, trigger recovery (reassign, respawn, decompose)

**Multi-agent advantage over OpenHands:**
OpenHands can only reset or abort a stuck agent. We can:
- Reassign to a different agent (different model/role)
- Decompose the stuck task into subtasks
- Share the stuck context to the oracle for strategic routing
- Log stuck patterns as learnings for future avoidance

**Reference:** OpenHands `openhands/controller/stuck.py` (5 heuristics with `StuckDetector` class)

### Success Criteria
- [ ] Stuck detection catches repeating loops within 30 seconds
- [ ] Auto-recovery: reassign or decompose stuck tasks
- [ ] Stuck events logged with heuristic type for pattern analysis
- [ ] `bun memory stuck-log` shows detection history
- [ ] Learning loop captures stuck patterns for future avoidance

### Effort: Medium

---

## Phase 8: Microagents — Dynamic Agent Customization

> *"Teach agents new tricks without redeploying."*

### Problem

Agent roles (`coder`, `tester`, `analyst`, etc.) are static. Adding domain-specific behavior requires code changes. No mechanism for project-specific or repo-specific agent customization.

### Solution

Implement a microagent system inspired by OpenHands — markdown files that define dynamic capabilities, triggers, and knowledge for agents.

### Implementation

**New files:**
- `src/agents/microagent.ts` — Microagent loader and registry
- `src/agents/microagent-types.ts` — Types: `RepoMicroagent`, `KnowledgeMicroagent`, `TaskMicroagent`

**Microagent types (inspired by OpenHands `openhands/microagent/`):**

| Type | Trigger | Purpose |
|------|---------|---------|
| **Knowledge** | Keyword match in task description | Inject domain knowledge (e.g., "when working with PostgreSQL, always...") |
| **Repo** | Always active in a specific repo/project | Project conventions, file structure, preferred patterns |
| **Task** | Task template with structured steps | Reusable workflows (e.g., "add API endpoint" template) |

**Microagent format (markdown with YAML frontmatter):**
```markdown
---
name: typescript-patterns
type: knowledge
triggers: ["typescript", "ts", ".ts file"]
version: 1
---

## TypeScript Conventions for This Project
- Use `interface` over `type` for object shapes
- Prefer `unknown` over `any`
- All async functions must have error handling
```

**Storage:**
- `.matrix/microagents/` directory in each project
- Global microagents in `~/.matrix/microagents/`
- SQLite registry for fast lookup by trigger

**Integration:**
- On task assignment, scan task description for trigger matches
- Inject matched microagent content into agent system prompt
- Track microagent effectiveness (did the agent follow the guidance?)

**Reference:** OpenHands `openhands/microagent/` (markdown frontmatter with `BaseMicroAgent`, `RepoMicroAgent`, `KnowledgeMicroAgent`)

### Success Criteria
- [ ] Microagents loaded from `.matrix/microagents/` directory
- [ ] Keyword triggers inject knowledge into agent context
- [ ] Repo microagents auto-apply to all agents in that project
- [ ] `bun memory microagent list|add|edit|test` CLI commands
- [ ] Microagent effectiveness tracked in learnings

### Effort: Medium

---

## Phase 9: Critic & Quality Gates

> *"Every agent deserves a code review."*

### Problem

No automated evaluation of agent work quality. The Oracle routes and assigns tasks, but doesn't assess the output. Bad results propagate unchecked. Quality scoring exists for learnings but not for task execution.

### Solution

Implement a critic system that evaluates agent task results before marking them complete. Inspired by OpenHands' `BaseCritic` but extended with our multi-agent capabilities.

### Implementation

**New files:**
- `src/critic/base.ts` — `BaseCritic` interface with `evaluate(task, result) → CriticScore`
- `src/critic/rule-based.ts` — Pattern-matching critic (tests pass? linting clean? no regressions?)
- `src/critic/llm-critic.ts` — LLM-based evaluation using Haiku for speed
- `src/critic/composite.ts` — Combines multiple critics with weighted scoring

**CriticScore:**
```typescript
interface CriticScore {
  score: number;        // 0.0 - 1.0
  passed: boolean;      // Meets threshold
  feedback: string;     // What went wrong (if failed)
  suggestions: string[];// How to improve
  metrics: {
    correctness: number;
    completeness: number;
    code_quality: number;
    test_coverage: number;
  };
}
```

**Quality gate flow:**
```
Agent completes task → Critic evaluates →
  If score ≥ threshold → Mark complete, extract learnings
  If score < threshold → Return to agent with feedback (max 2 retries)
  If still failing → Escalate to different agent or human
```

**Integration with existing systems:**
- Extend `src/learning/quality-scoring.ts` to cover task results (not just learnings)
- Wire into `src/pty/mission-queue.ts` completion handler
- Feed critic scores into Oracle routing decisions (agents with consistently low scores get simpler tasks)

**Reference:** OpenHands `openhands/critic/base.py` (BaseCritic with `CriticResult` containing `score`, `success`, `critique`)

### Success Criteria
- [ ] All completed tasks pass through at least one critic
- [ ] Failed critiques trigger retry with feedback
- [ ] Critic scores stored in `agent_tasks` for performance tracking
- [ ] Oracle uses historical critic scores for agent selection
- [ ] `bun memory quality-report` shows agent performance over time

### Effort: Medium

---

## Phase 10: Intelligent LLM Router

> *"The right model for the right job."*

### Problem

Model selection is manual — agents are spawned as `haiku`, `sonnet`, or `opus` based on the spawner's judgment. No dynamic routing based on task characteristics, no cost optimization, no vision-aware routing.

### Solution

Implement an LLM router that selects the optimal model based on task complexity, required capabilities (vision, long context, reasoning depth), and cost budget.

### Implementation

**New files:**
- `src/llm/router.ts` — `ModelRouter` with routing rules engine
- `src/llm/cost-tracker.ts` — Token usage and cost tracking per agent/task/session
- `src/llm/model-registry.ts` — Available models with capability metadata

**Routing factors:**

| Factor | Signal | Routing |
|--------|--------|---------|
| **Complexity** | Oracle complexity score | Low → haiku, Medium → sonnet, High → opus |
| **Vision** | Task includes images/screenshots | Route to vision-capable model |
| **Context length** | Estimated token count | Route to model with sufficient window |
| **Cost budget** | Per-task/per-session budget | Prefer cheaper models when budget is tight |
| **Historical performance** | Critic scores by model+task-type | Route to model that performs best for this task type |
| **Sticky routing** | Mid-task model switch | Avoid switching models mid-conversation (context loss) |

**Cost tracking:**
```typescript
interface CostEntry {
  agent_id: string;
  task_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  timestamp: Date;
}
```

**Modify:**
- `src/oracle/orchestrator.ts` — Use router instead of hardcoded model selection
- `src/pty/spawner.ts` — Accept model from router
- `src/db/core.ts` — Add `cost_tracking` table

**Reference:** OpenHands `openhands/llm/router/multimodal_router.py` (sticky token limit, vision-aware fallback routing)

### Success Criteria
- [ ] Model selection is automatic based on task characteristics
- [ ] Cost tracked per task with daily/weekly summaries
- [ ] Vision tasks automatically routed to vision-capable models
- [ ] `bun memory cost-report` shows spend breakdown
- [ ] Cost budget enforcement (warn/block when exceeded)

### Effort: Medium

---

## Phase 11: Automated Issue Resolver

> *"From issue to PR, autonomously."*

### Problem

Assigning work to agents requires manual task creation. No integration with GitHub/GitLab issue trackers. The full loop from "bug reported" to "PR submitted" requires human orchestration at every step.

### Solution

Build an issue resolver pipeline inspired by OpenHands' resolver system — automatically picks up issues, creates branches, assigns to agents, runs critics, and submits PRs.

### Implementation

**New files:**
- `src/resolver/pipeline.ts` — End-to-end issue → PR pipeline
- `src/resolver/issue-fetcher.ts` — Poll/webhook for new issues from GitHub/GitLab
- `src/resolver/pr-submitter.ts` — Create branches, commit, push, open PRs
- `src/resolver/platform.ts` — Abstract git platform interface

**Pipeline flow:**
```
Issue created → Fetch & analyze → Classify (bug/feature/refactor) →
  Decompose into tasks → Assign to agents →
  Agents work in worktrees → Critic evaluates →
  If passed → Create PR with description → Link to issue
  If failed → Retry with different agent/approach
```

**Platform abstraction (inspired by OpenHands `integrations/`):**
```typescript
interface GitPlatform {
  fetchIssues(filter: IssueFilter): Promise<Issue[]>;
  createBranch(name: string): Promise<void>;
  createPR(title: string, body: string, branch: string): Promise<PR>;
  addComment(issueId: string, body: string): Promise<void>;
}
```

**Start with GitHub only** (via `gh` CLI), add GitLab/others later.

**Integration:**
- Wire into Oracle for task decomposition and agent assignment
- Use existing worktree system for code isolation
- Feed PR review comments back as learnings

**Reference:** OpenHands `openhands/resolver/` (Factory+Strategy pattern, `resolve_issues()` pipeline, `send_pull_request()`)

### Success Criteria
- [ ] `bun memory resolve --issue 42` triggers full pipeline
- [ ] Auto-watch mode: `bun memory resolve --watch` polls for new issues
- [ ] PRs include issue context, test evidence, and agent attribution
- [ ] Failed attempts logged with analysis for learning
- [ ] GitHub integration works end-to-end

### Effort: High

---

## Phase Summary

| Phase | Name | Dependencies | Priority | Effort |
|-------|------|-------------|----------|--------|
| 1 | Event Stream | None | P0 | Medium |
| 2 | Runtime Abstraction | Phase 1 | P1 | High |
| 3 | Security Analyzer | Phase 1 | P1 | Medium |
| 4 | Web Dashboard | Phase 1 (Phase 3 optional) | P2 | High |
| 5 | Browser + Condensers | Phase 2 | P2 | High |
| **6** | **Codebase Restructuring** | **None** | **P0** | **Medium** |
| **7** | **Stuck Detection** | **Phase 1** | **P1** | **Medium** |
| **8** | **Microagents** | **None** | **P1** | **Medium** |
| **9** | **Critic & Quality Gates** | **Phase 1** | **P1** | **Medium** |
| **10** | **LLM Router** | **Phase 9** | **P2** | **Medium** |
| **11** | **Issue Resolver** | **Phases 7, 9** | **P3** | **High** |

### Recommended Execution Order

```
Tier 0 (Foundation — do first, parallel):
  Phase 6: Codebase Restructuring  ─── Clean house first
  Phase 1: Event Stream Foundation  ── Everything builds on events

Tier 1 (Core capabilities — after Tier 0):
  Phase 3: Security Analyzer        ── Quick, high-value
  Phase 7: Stuck Detection           ── Prevents wasted compute
  Phase 8: Microagents               ── No dependencies, high flexibility
  Phase 9: Critic & Quality Gates    ── Quality before automation

Tier 2 (Advanced — after Tier 1):
  Phase 2: Runtime Abstraction       ── Sandboxing
  Phase 10: LLM Router               ── Cost optimization (needs critic data)
  Phase 4: Web Dashboard             ── Biggest UX improvement

Tier 3 (Full autonomy — after Tier 2):
  Phase 5: Browser + Condensers      ── Extended capabilities
  Phase 11: Issue Resolver            ── End-to-end automation
```

**Rationale:**
- Phase 6 (Restructuring) is P0 because all subsequent phases are easier to implement in a clean codebase
- Phase 1 (Events) is P0 because phases 3, 7, 9 all emit/consume events
- Phases 7-9 are the "agent intelligence" cluster — stuck detection prevents loops, microagents add flexibility, critics ensure quality
- Phase 10 (Router) needs critic data to make informed model choices
- Phase 11 (Resolver) is the capstone — it combines all prior phases into end-to-end automation

---

## What We Keep (Already Better Than OpenHands)

| Capability | Our Advantage |
|------------|--------------|
| **Memory** | Confidence-tracked learnings (low → proven) with semantic search |
| **Orchestration** | Oracle intelligence with proactive spawning, complexity analysis |
| **Cross-Matrix** | Hub with PIN auth, cross-project messaging, presence |
| **Knowledge Graph** | Entity extraction, relationship mapping |
| **Git Isolation** | Worktrees (lighter than Docker for code isolation) |
| **Learning Loop** | Distill → Consolidate → Validate → Retrieve |
| **Chaos Testing** | 53,776 lines of resilience tests |

---

## References

- OpenHands source: `~/ghq/github.com/OpenHands/OpenHands/`
- OpenHands architecture doc: `ψ/learn/OpenHands/OpenHands/2026-02-01_ARCHITECTURE.md`
- OpenHands code patterns: `ψ/learn/OpenHands/OpenHands/2026-02-01_CODE-SNIPPETS.md`
- OpenHands synthesis: `ψ/learn/OpenHands/OpenHands/2026-02-01_SYNTHESIS-FOR-THE-MATRIX.md`
- Agent Orchestra audit: `docs/AUDIT-2026-01-28.md`
- Existing evolution plan: `docs/codebase-evolution-plan.md`
- OpenHands resolver: `openhands/resolver/` (Factory+Strategy, issue→PR pipeline)
- OpenHands microagents: `openhands/microagent/` (markdown frontmatter triggers)
- OpenHands critic: `openhands/critic/base.py` (BaseCritic evaluation)
- OpenHands stuck detection: `openhands/controller/stuck.py` (5 heuristics)
- OpenHands LLM router: `openhands/llm/router/` (MultimodalRouter)
- Codebase structure audit: Agent report from 2026-02-01 session

---

*Last updated: 2026-02-01 (expanded with Phases 6-11)*
