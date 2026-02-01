# Phase 6: Codebase Restructuring — Agent Tasks

**Phase**: 6 (Tier 0 — Foundation)
**Priority**: P0
**Why first**: Every subsequent phase adds new files. If the structure is messy now, it compounds. Clean house before building.

---

## Cause & Effect Chain

```
Phase 6 (Clean Structure)
  ├─► Phase 1 (Event Stream) — New src/events/ needs clear home
  ├─► Phase 7 (Stuck Detection) — New src/agents/ needs soul/ merged in
  ├─► Phase 8 (Microagents) — Needs src/agents/ to exist cleanly
  ├─► Phase 9 (Critic) — New src/critic/ fits in clean structure
  └─► ALL phases benefit from files under 500 lines (easier to modify)

If skipped:
  - New phases pile code into already-bloated files
  - Test discovery remains broken (4 locations)
  - God objects become harder to split as more code depends on them
  - CLI remains 38 disconnected scripts
```

---

## Task 6.1: Split `vector-db.ts` (2,193 lines → 4 files)

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: nothing
**Blocks**: Tasks 6.6 (test consolidation needs stable imports)

### What to do

Split `src/vector-db.ts` into:

| New file | Responsibility | Approx lines |
|----------|---------------|--------------|
| `src/vector/client.ts` | ChromaDB connection, health check, collection management | ~300 |
| `src/vector/collections.ts` | Collection CRUD, schema definitions, metadata handling | ~500 |
| `src/vector/search.ts` | Query building, semantic search, similarity scoring | ~600 |
| `src/vector/embeddings.ts` | Embedding generation, caching, batch operations | ~400 |
| `src/vector/index.ts` | Re-export public API (backwards compat barrel) | ~30 |

### Steps

1. Read `src/vector-db.ts` fully — identify class/function boundaries
2. Create `src/vector/` directory
3. Extract each concern into its own file with proper imports
4. Create `src/vector/index.ts` barrel that re-exports everything `vector-db.ts` used to export
5. Update `src/vector-db.ts` to be a thin shim: `export * from './vector/index'`
6. Find all files that import from `vector-db` — verify they still work
7. Run ALL tests

### COMPLETE criteria
- [ ] No single file in `src/vector/` exceeds 600 lines
- [ ] `src/vector-db.ts` is either deleted or a 1-line re-export shim
- [ ] All public exports from old `vector-db.ts` are available from `src/vector/index.ts`
- [ ] Zero import errors across the codebase

### VALIDATION criteria
- [ ] `bun test` — all existing tests pass
- [ ] `grep -r "from.*vector-db" src/` — no broken imports (all resolve)
- [ ] `wc -l src/vector/*.ts` — each file under 600 lines
- [ ] `bun run src/mcp/server.ts --help` or equivalent — MCP server starts without error
- [ ] `bun memory index grep "ChromaDB"` — code search still works (proves vector search intact)

---

## Task 6.2: Split `db/core.ts` (1,118 lines → 4 files)

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: nothing
**Blocks**: Tasks 6.6

### What to do

Split `src/db/core.ts` into:

| New file | Responsibility | Approx lines |
|----------|---------------|--------------|
| `src/db/schema.ts` | Table definitions, column types, CREATE statements | ~250 |
| `src/db/migrations.ts` | Schema versioning, ALTER statements, migration runner | ~300 |
| `src/db/connection.ts` | SQLite open/close, WAL mode, pragma settings | ~200 |
| `src/db/locking.ts` | Write locking, transaction helpers, retry logic | ~200 |

### Steps

1. Read `src/db/core.ts` — map all exported functions/classes
2. Identify natural boundaries: schema DDL, migration logic, connection setup, locking
3. Extract into 4 files with proper cross-imports
4. Update `src/db/core.ts` to re-export (or update the shim at `src/db.ts`)
5. Verify all consumers still work

### COMPLETE criteria
- [ ] No file in `src/db/` exceeds 400 lines
- [ ] `src/db.ts` shim still works (backwards compat)
- [ ] All DB operations function correctly

### VALIDATION criteria
- [ ] `bun test` — all tests pass
- [ ] `bun memory status` — SQLite health check passes
- [ ] `grep -r "from.*db/core" src/` — all imports resolve
- [ ] `bun memory recall "test query"` — proves DB read path works
- [ ] Create and retrieve a test learning — proves DB write path works

---

## Task 6.3: Split `oracle/orchestrator.ts` (1,047 lines → 3 files)

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: nothing
**Blocks**: Phase 7 (Stuck Detection wires into orchestrator), Phase 9 (Critic integrates here)

### Cause & effect

```
orchestrator.ts is the integration point for Phases 7, 9, 10
If it stays monolithic → each phase adds 200+ lines → becomes 2000+ line god object
Split now → each phase modifies only its relevant sub-module
```

### What to do

Split `src/oracle/orchestrator.ts` into:

| New file | Responsibility | Approx lines |
|----------|---------------|--------------|
| `src/oracle/analyzer.ts` | Workload analysis, complexity scoring, bottleneck detection | ~350 |
| `src/oracle/rebalancer.ts` | Load rebalancing, task redistribution, agent reassignment | ~350 |
| `src/oracle/spawning.ts` | Proactive agent spawning, pool management, scaling decisions | ~300 |

### Steps

1. Read `src/oracle/orchestrator.ts` — identify the 3 major concerns
2. Extract each into its own file
3. Keep `orchestrator.ts` as a thin coordinator that imports and wires the three modules
4. Verify Oracle intelligence tests pass

### COMPLETE criteria
- [ ] `orchestrator.ts` under 200 lines (coordinator only)
- [ ] Each extracted file under 400 lines
- [ ] Oracle behavior unchanged

### VALIDATION criteria
- [ ] `bun test scripts/tests/oracle-spawning.test.ts` — 17 tests pass
- [ ] `bun test scripts/tests/task-routing.test.ts` — 27 tests pass
- [ ] `bun test scripts/tests/simulation.test.ts` — 17 tests pass
- [ ] Oracle correctly routes a test task (manual check)

---

## Task 6.4: Merge `soul/` into `agents/` and create `matrix/`

**Assignable to**: `coder` role, `haiku` model (straightforward file moves)
**Complexity**: low
**Depends on**: nothing
**Blocks**: Phase 8 (Microagents needs `src/agents/` directory)

### Cause & effect

```
soul/ contains agent role definitions and curiosity directives
These ARE agent concerns, not a separate domain
Phase 8 (Microagents) adds src/agents/microagent.ts
Phase 7 (Stuck Detection) adds src/agents/stuck-detector.ts
If soul/ exists separately → confusion about where agent logic lives
```

### What to do

1. Create `src/agents/` directory
2. Move `src/soul/agent-roles.ts` → `src/agents/roles.ts`
3. Move `src/soul/curiosity-directive.ts` → `src/agents/curiosity.ts`
4. Move `src/soul/sync.ts` → `src/agents/sync.ts`
5. Update `src/soul/index.ts` → `src/agents/index.ts`
6. Make `src/soul/` a re-export shim (or delete if no external consumers)
7. Consolidate matrix files:
   - `src/matrix-hub.ts` → `src/matrix/hub.ts`
   - `src/matrix-daemon.ts` → `src/matrix/daemon.ts`
   - `src/matrix-client.ts` → `src/matrix/client.ts`
   - Create `src/matrix/index.ts` barrel
8. Update all imports across the codebase

### COMPLETE criteria
- [ ] `src/agents/` contains all agent-related definitions
- [ ] `src/matrix/` contains hub, daemon, client
- [ ] `src/soul/` is deleted or a 1-line shim
- [ ] No standalone matrix-*.ts files in `src/`

### VALIDATION criteria
- [ ] `bun test` — all tests pass
- [ ] `grep -r "from.*soul" src/` — no broken imports
- [ ] `grep -r "from.*matrix-hub\|matrix-daemon\|matrix-client" src/` — all updated
- [ ] `bun memory status` — matrix daemon still connects
- [ ] Agent spawning still works (roles resolve correctly)

---

## Task 6.5: Consolidate `psi/` and `ψ/`

**Assignable to**: `coder` role, `haiku` model
**Complexity**: low
**Depends on**: nothing
**Blocks**: nothing (cosmetic but prevents confusion)

### Cause & effect

```
ψ/ (unicode) causes issues with:
- Some terminal emulators
- Grep/find tools that don't handle unicode
- Git operations on some platforms
- Developer confusion ("which psi directory?")

If left alone → every new session wastes time figuring out which is which
```

### What to do

1. Compare contents of `psi/` and `ψ/` — identify overlap
2. Merge any unique content from `ψ/` into `psi/`
3. Remove `ψ/` directory
4. Update `scripts/memory/sync-from-psi.ts` and `sync-to-psi.ts` if they reference `ψ/`
5. Update `.gitignore` if needed

### COMPLETE criteria
- [ ] Only `psi/` exists (no `ψ/`)
- [ ] All unique content preserved in `psi/`
- [ ] Sync scripts updated

### VALIDATION criteria
- [ ] `ls -d ψ/ 2>&1` — "No such file or directory"
- [ ] `ls psi/` — contains all knowledge files
- [ ] `bun memory recall "test"` — memory system still works
- [ ] `grep -r "ψ" scripts/ src/` — no references to unicode directory remain

---

## Task 6.6: Consolidate all tests into `tests/`

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium
**Depends on**: Tasks 6.1, 6.2, 6.3 (imports must be stable before moving tests)
**Blocks**: all future phases (consistent test location)

### Cause & effect

```
Currently tests are in 4 places:
  ./tests/                    (1 file)
  ./scripts/tests/            (23 files) ← most tests here
  ./src/pty/tests/            (5 files)
  ./src/learning/tests/       (1 file)

Consequences of scattered tests:
  - `bun test` may not find all tests
  - CI/CD config must list multiple paths
  - New contributors don't know where to add tests
  - Coverage reporting is fragmented

After consolidation:
  - `bun test tests/` runs everything
  - Clear unit/integration/e2e separation
  - Single config for CI
```

### What to do

Create unified test structure:
```
tests/
├── unit/           # Fast, no external deps
│   ├── db/
│   ├── vector/
│   ├── oracle/
│   └── agents/
├── integration/    # Needs SQLite/ChromaDB
│   ├── learning/
│   ├── indexer/
│   └── matrix/
└── e2e/            # Full system tests
    ├── chaos.test.ts
    ├── simulation.test.ts
    └── mission-flow.test.ts
```

### Steps

1. Inventory all test files across 4 locations
2. Classify each as unit/integration/e2e
3. Move files to `tests/` with updated import paths
4. Update `package.json` test scripts if needed
5. Delete old test directories
6. Run full test suite to verify

### COMPLETE criteria
- [ ] All `.test.ts` and `.spec.ts` files live under `tests/`
- [ ] No test files in `scripts/tests/`, `src/*/tests/`
- [ ] Tests organized as unit/integration/e2e
- [ ] `package.json` test command points to `tests/`

### VALIDATION criteria
- [ ] `bun test tests/` — ALL tests discovered and run
- [ ] `find src scripts -name "*.test.ts"` — returns nothing
- [ ] Same number of tests pass as before the move (count before and after)
- [ ] `bun test tests/unit/` — runs only fast unit tests
- [ ] `bun test tests/integration/` — runs integration tests
- [ ] `bun test tests/e2e/` — runs e2e tests

---

## Task 6.7: CLI Framework

**Assignable to**: `coder` role, `sonnet` model
**Complexity**: medium-high
**Depends on**: Task 6.4 (directory structure settled)
**Blocks**: Phases 7-11 (all add new CLI commands)

### Cause & effect

```
Currently: 38 scripts in scripts/memory/ with ad-hoc argument parsing
  bun memory recall → runs scripts/memory/recall.ts
  bun memory learn → runs scripts/memory/learn.ts
  ... each script parses its own args differently

Consequences:
  - No --help for any command
  - No consistent error handling
  - No argument validation
  - Adding a new command = new script file + manual wiring
  - Phases 7-11 each add 2-5 new commands = 10-25 more ad-hoc scripts

After CLI framework:
  - `bun memory --help` lists all commands
  - `bun memory <cmd> --help` shows usage
  - New commands auto-discovered from src/cli/commands/
  - Consistent arg parsing, error handling, output formatting
```

### What to do

1. Create `src/cli/index.ts` — main entry point with command router
2. Create `src/cli/command.ts` — base `Command` interface:
   ```typescript
   interface Command {
     name: string;
     description: string;
     args: ArgDefinition[];
     run(args: ParsedArgs): Promise<void>;
   }
   ```
3. Create `src/cli/commands/` — one file per command group:
   - `recall.ts`, `learn.ts`, `status.ts`, `message.ts`, `index.ts` (search), etc.
4. Migrate top 10 most-used scripts first, leave others as deprecated shims
5. Update `scripts/memory.ts` entry point to route through CLI framework

### COMPLETE criteria
- [ ] `src/cli/` directory with command framework
- [ ] Top 10 commands migrated: `status`, `init`, `recall`, `learn`, `message`, `task`, `index`, `context`, `stats`, `export`
- [ ] Each command has `--help` output
- [ ] Remaining scripts still work (not broken, just not migrated yet)

### VALIDATION criteria
- [ ] `bun memory --help` — shows all available commands
- [ ] `bun memory status --help` — shows status command usage
- [ ] `bun memory recall "test query"` — works identically to before
- [ ] `bun memory learn --help` — shows learn command options
- [ ] All migrated commands produce same output as their script predecessors
- [ ] `bun memory nonexistent` — shows helpful error + available commands

---

## Dependency Graph

```
Task 6.1 (Split vector-db.ts)     ──┐
Task 6.2 (Split db/core.ts)       ──┤
Task 6.3 (Split orchestrator.ts)  ──┼──► Task 6.6 (Consolidate tests)
Task 6.4 (Merge soul/ + matrix/)  ──┤        │
Task 6.5 (Consolidate psi/)       ──┘        │
                                              ▼
                                   Task 6.7 (CLI framework)
```

**Parallelizable**: Tasks 6.1, 6.2, 6.3, 6.4, 6.5 can ALL run in parallel (independent files)
**Sequential**: Task 6.6 waits for 6.1-6.5 (needs stable imports)
**Sequential**: Task 6.7 waits for 6.4 (needs directory structure finalized)

---

## Phase 6 → Phase 1 Handoff

When Phase 6 is complete, Phase 1 (Event Stream) gets:
- Clean `src/events/` directory ready to create
- `src/oracle/` split into modules (easier to wire events into specific concerns)
- `src/db/` split (schema.ts is the right place to add events table)
- Tests consolidated (new event tests go in `tests/unit/events/`)
- CLI framework (add `bun memory events` command easily)
