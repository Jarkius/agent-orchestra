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

## Phase Summary

| Phase | Name | Dependencies | Priority | Effort |
|-------|------|-------------|----------|--------|
| 1 | Event Stream | None | P0 | Medium |
| 2 | Runtime Abstraction | Phase 1 | P1 | High |
| 3 | Security Analyzer | Phase 1 | P1 | Medium |
| 4 | Web Dashboard | Phase 1 (Phase 3 optional) | P2 | High |
| 5 | Browser + Condensers | Phase 2 | P2 | High |

**Recommended order:** 1 → 3 → 2 → 4 → 5

Phase 1 (Event Stream) is the foundation — everything else builds on typed events.
Phase 3 (Security) is quick and high-value.
Phase 2 (Runtime) enables sandboxing.
Phase 4 (Dashboard) is the biggest user-facing improvement.
Phase 5 (Browser + Condensers) extends capabilities.

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

---

*Last updated: 2026-02-01*
