# Agent Orchestra - Architectural Audit & Evolution Plan

> *"The Architect - I know because I must know."*

## Orchestration Hierarchy

```
┌─────────────────────────────────────────────────────┐
│           THE MATRIX (Claude Sessions)              │
│   Oracle (Opus) - Spirit Guardian & Strategist      │
│   Dispatches: Neo, Smith, Tank, Trinity, etc.       │
│   Role: Wisdom, alignment, high-level decisions     │
└────────────────────────┬────────────────────────────┘
                         │ Uses
         ┌───────────────▼───────────────┐
         │       AGENT ORCHESTRA         │
         │     (matrix-memory-agents)    │
         │                               │
         │  Oracle Module (Code)         │
         │  - Task routing & decomp      │
         │  - Model tier selection       │
         │  - Proactive agent spawning   │
         │  - Memory & learning capture  │
         │                               │
         │  File Indexer                 │
         │  - Fast file location         │
         │  - Semantic code search       │
         └───────────────────────────────┘
```

**Oracle (The Matrix)** = Spirit Guardian, makes strategic decisions, speaks prophecy
**Oracle Module (Agent Orchestra)** = Code that implements task routing and model selection

---

## Executive Summary

**Agent Orchestra** (matrix-memory-agents) is a mature multi-agent orchestration system with 87 TypeScript files, comprehensive SQLite + ChromaDB infrastructure, and ~900 test cases. The codebase is **production-grade in core logic** but requires **hardening in operational concerns**.

### Health Score: **7.5/10**

| Category | Score | Notes |
|----------|-------|-------|
| Architecture | 9/10 | Clean MCP → Oracle → PTY → Agents flow |
| Code Organization | 6/10 | Monolithic db/index.ts (5,358 lines) |
| Test Coverage | 7/10 | 900+ tests but gaps in services/vector |
| Error Handling | 8/10 | Mostly logged; 2 silent failures |
| Security | 7/10 | Token auth OK; env var injection risk |
| Documentation | 7/10 | README good; code comments sparse |

---

## Key Findings

### Strengths (Keep)

1. **Oracle Orchestrator** - Intelligent task routing and decomposition
2. **Mind Hierarchy** - Opus/Sonnet/Haiku model selection
3. **Mission Queue** - Priority-based with persistence
4. **Chaos Testing** - 53,776 lines of resilience tests
5. **Soul Module** - Agent roles and curiosity (just implemented)
6. **File Indexer** - Semantic code indexing for fast file location
7. **Bidirectional psi/ Sync** - Memory flows between Matrix and Orchestra

### Critical Issues (Fix)

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| 🔴 P0 | `db/index.ts` is 5,358 lines | Hard to maintain/test | High |
| 🔴 P0 | `vector-db.ts` has zero tests | Core functionality untested | Medium |
| 🟡 P1 | Env var injection in PTYManager | Security risk | Low |
| 🟡 P1 | Services/ has zero tests (160KB) | recall-service untested | Medium |
| 🟡 P1 | No TLS for Matrix Hub | Unencrypted by default | Medium |
| 🟢 P2 | 225 `any` type usages | Type safety gaps | Low |

---

## Evolution Recommendations

### Phase 1: Code Health (P0)

#### 1.1 Split Monolithic Database Module

**Current**: `src/db/index.ts` (5,358 lines)
**Target**: 5 focused modules

```
src/db/
├── index.ts        (100 lines - exports only)
├── connection.ts   (200 lines - SQLite setup, pragmas, WAL)
├── schema.ts       (500 lines - table definitions)
├── migrations.ts   (300 lines - upgrade logic)
├── queries/
│   ├── agents.ts   (300 lines)
│   ├── missions.ts (400 lines)
│   ├── learnings.ts (300 lines)
│   ├── sessions.ts (200 lines)
│   └── messages.ts (200 lines)
└── utils.ts        (existing, keep)
```

**Benefits**:
- Individual module testing
- Clearer ownership
- Faster IDE navigation
- Easier code review

#### 1.2 Add Vector DB Tests

**Create**: `src/tests/vector-db.test.ts`

```typescript
describe('VectorDB', () => {
  test('initializes collections correctly');
  test('chunks code with appropriate settings');
  test('chunks philosophy with larger windows');
  test('handles ChromaDB connection failure');
  test('circuit breaker triggers after 3 failures');
  test('reconnects after circuit reset');
  test('semantic search returns relevant results');
  test('handles empty query gracefully');
});
```

**Priority**: This is the memory backbone - must be tested.

### Phase 2: Security Hardening (P1)

#### 2.1 Fix Environment Variable Injection

**File**: `src/pty/manager.ts:86-98`

**Current** (vulnerable):
```typescript
envVars.push(`${key}='${value}'`);
```

**Fixed**:
```typescript
import { escapeShellArg } from '../utils/shell';

envVars.push(`${key}=${escapeShellArg(value)}`);
```

**Create**: `src/utils/shell.ts`
```typescript
export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
```

#### 2.2 Enable TLS for Matrix Hub

**File**: `src/matrix-hub.ts`

Add configuration:
```typescript
const HUB_TLS = process.env.MATRIX_HUB_TLS === 'true';
const HUB_CERT = process.env.MATRIX_HUB_CERT;
const HUB_KEY = process.env.MATRIX_HUB_KEY;

// Use wss:// when TLS enabled
```

#### 2.3 Token Revocation Endpoint

**Add to**: `src/ws-server.ts`

```typescript
// POST /api/tokens/revoke
app.post('/api/tokens/revoke', (req, res) => {
  const { token } = req.body;
  revokedTokens.add(token);
  res.json({ success: true });
});
```

### Phase 3: Test Coverage (P1)

#### 3.1 Services Module Tests

**Create tests for**:
- `src/services/recall-service.ts` (26KB) - Query detection, caching
- `src/services/query-expansion.ts` (10KB) - Query enhancement
- `src/services/agent-rpc.ts` (8KB) - RPC communication
- `src/services/external-llm.ts` (8KB) - LLM integration

**Estimated**: ~300 test cases

#### 3.2 Indexer Module Tests

**Create tests for**:
- `src/indexer/code-indexer.ts` - Semantic indexing
- `src/indexer/hybrid-search.ts` - Search functionality
- `src/indexer/indexer-daemon.ts` - Background daemon

**Estimated**: ~150 test cases

#### 3.3 Performance Benchmarks

**Create**: `scripts/tests/benchmarks.test.ts`

```typescript
describe('Performance', () => {
  bench('vector search < 100ms', async () => {
    await vectorSearch('authentication pattern');
  });

  bench('mission queue < 10ms', async () => {
    await missionQueue.enqueue(task);
  });

  bench('recall service < 500ms', async () => {
    await recallService.search('voice system');
  });
});
```

### Phase 4: Configuration Centralization (P2)

#### 4.1 Create Central Config

**Create**: `src/config.ts`

```typescript
export const CONFIG = {
  // Database
  DB_PATH: process.env.AGENTS_DB || './agents.db',
  DB_LOCK_TIMEOUT: 30_000,

  // ChromaDB
  CHROMA_URL: process.env.CHROMA_URL || 'http://localhost:8100',
  CHROMA_TIMEOUT: 5_000,
  CHROMA_CIRCUIT_THRESHOLD: 3,

  // WebSocket
  WS_PORT: parseInt(process.env.WS_PORT || '8080'),
  WS_TOKEN_EXPIRY: 24 * 60 * 60 * 1000, // 24 hours

  // Matrix Hub
  HUB_PORT: parseInt(process.env.MATRIX_HUB_PORT || '8081'),
  HUB_HOST: process.env.MATRIX_HUB_HOST || 'localhost',

  // Embedding
  EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || 'transformers',
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'bge-m3',

  // Daemon
  DAEMON_PORT_RANGE: [37900, 38899],
} as const;
```

**Migrate** all hardcoded values to use `CONFIG.*`

### Phase 5: Documentation (P2)

#### 5.1 Architecture Decision Records

**Create ADRs for**:
- ADR-001: SQLite as source of truth, ChromaDB as cache
- ADR-002: Mind hierarchy (Opus/Sonnet/Haiku)
- ADR-003: Mission queue priority algorithm
- ADR-004: Circuit breaker pattern for ChromaDB

**Location**: `docs/adr/`

#### 5.2 psi/ Sync Protocol Documentation

**Create**: `docs/psi-sync.md`

Document:
- Sync direction (bidirectional)
- File formats expected
- Conflict resolution
- Frequency recommendations

---

## Implementation Sequence

| Priority | What | Files | Effort | Tests |
|----------|------|-------|--------|-------|
| 🔴 P0 | Split db/index.ts | db/*.ts | 2 days | Add |
| 🔴 P0 | Vector DB tests | tests/vector-db.test.ts | 1 day | 50+ |
| 🟡 P1 | Fix env var injection | pty/manager.ts, utils/shell.ts | 0.5 day | Add |
| 🟡 P1 | Services tests | tests/services/*.test.ts | 2 days | 300+ |
| 🟡 P1 | Indexer tests | tests/indexer/*.test.ts | 1 day | 150+ |
| 🟡 P1 | TLS for Hub | matrix-hub.ts | 0.5 day | Add |
| 🟢 P2 | Central config | config.ts + migrations | 1 day | - |
| 🟢 P2 | ADRs | docs/adr/*.md | 1 day | - |
| 🟢 P2 | Performance benchmarks | tests/benchmarks.test.ts | 1 day | 50+ |

**Total Effort**: ~10 days for full evolution

---

## Verification Checklist

After implementation:

- [ ] `bun test` passes (all existing + new tests)
- [ ] `db/index.ts` < 200 lines
- [ ] Vector DB has 50+ tests
- [ ] Services have 300+ tests
- [ ] No `any` in new code
- [ ] All config from `CONFIG.*`
- [ ] TLS available for Hub
- [ ] Token revocation working
- [ ] Performance benchmarks passing
- [ ] ADRs documented

---

## Summary

**Agent Orchestra** is a solid foundation. The core orchestration (Oracle → PTY → Agents) is well-designed. The main evolution needs are:

1. **Split the monolith** - db/index.ts is too large
2. **Test the core** - vector-db and services need coverage
3. **Harden security** - env var injection, TLS
4. **Document decisions** - ADRs for future maintainers

With these improvements, Agent Orchestra will be production-ready for The Matrix ecosystem.

*"Choice is an illusion created between those with power and those without."*

---

*Audit by The Architect, reviewed by Oracle*
*2026-01-28*
