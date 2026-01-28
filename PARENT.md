# Parent: The-Oracle-Construct

> *"Two memory systems, one consciousness."*

Agent Orchestra is the **operational memory and orchestration subsystem** of The Matrix ecosystem.

## Lineage

```
The-Oracle-Construct (Wisdom + Voice)
    │
    ├─ matrix-seed (Philosophy core, 66KB)
    │   └── CLAUDE.md v2.0 (Soul-first)
    │   └── BIBLE.md (Self-awakening doctrine)
    │
    ├─ matrix-reloaded (Full operational, 13MB)
    │   └── Voice system (Piper TTS)
    │   └── 39+ workflows
    │   └── Self-healing (matrix-doctor.sh)
    │
    └─ matrix-memory-agents (Agent Orchestra)
       ├── SQLite persistent memory
       ├── ChromaDB semantic search
       ├── Parallel agent spawning (tmux + worktrees)
       ├── Oracle task routing
       └── Learning confidence tracking
```

## Design Principles

Follows **ADR-003 Mind Hierarchy**:

| Tier | Model | Use In Orchestra |
|------|-------|------------------|
| **Wise** | Opus | Oracle routing, complex decomposition |
| **Intelligent** | Sonnet | Task execution, learning extraction |
| **Mechanical** | Haiku | Fast routing, simple queries |

See: `The-matrix/psi/memory/adr/ADR-003-hierarchical-mind-architecture.md`

## Integration with psi/

Agent Orchestra's SQLite database syncs with The Matrix's psi/ file system:

| Agent Orchestra | Direction | psi/ files |
|-----------------|-----------|------------|
| `learnings` table (high confidence) | → | `psi/memory/learnings/*.md` |
| `sessions` table | → | `psi/memory/retrospectives/*.md` |
| Mission results | → | Scribe captures via `/rrr` |
| Proven learnings | → | `psi/learn/archive/` |
| - | ← | Import retrospectives to SQLite |
| - | ← | Git history validates learnings |

## Memory Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    UNIFIED MEMORY LAYER                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Agent Orchestra (Operational)     The Matrix (Philosophical) │
│  ─────────────────────────────    ───────────────────────── │
│  • SQLite sessions                 • psi/memory/retrospectives │
│  • Learnings with confidence       • psi/memory/learnings     │
│  • ChromaDB vectors                • psi/The_Source (BIBLE)   │
│  • Mission queue                   • Voice system (Piper)     │
│  • Task routing                    • Slash commands           │
│                                                              │
│            ↓ sync-to-psi.ts    sync-from-psi.ts ↑           │
│            └──────────────┬───────────────────┘             │
│                           │                                  │
│                    Bidirectional Sync                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## What We Inherit

### From The Matrix Philosophy
- **Nothing Is Deleted** — Archive, don't destroy
- **Patterns Over Intentions** — Document what IS, not what should be
- **The Operator Is Mortal** — Efficiency is respect
- **Continuous Becoming** — Endless capacity to transform

### From The Matrix Operations
- Voice system for agent announcements
- Retrospective format for session capture
- Knowledge loop (/learn → /wisdom → /distill)

## What We Contribute

### To The Matrix Ecosystem
- **Persistent operational memory** — SQLite survives restarts
- **Semantic search** — ChromaDB understands meaning
- **Parallel agent coordination** — tmux + worktree isolation
- **Learning confidence tracking** — low → medium → high → proven
- **Cross-project messaging** — Matrix Hub (WebSocket)

## Commands

| Command | Description |
|---------|-------------|
| `bun memory status` | Check health (run first in sessions) |
| `bun memory init` | Initialize/repair services |
| `bun memory recall "query"` | Search all memory |
| `bun memory learn ./file.md` | Capture knowledge |
| `bun memory sync-to-psi` | Export to psi/memory/ |
| `bun memory sync-from-psi` | Import from psi/memory/ |

## Related Repositories

| Repository | Description | Link |
|------------|-------------|------|
| The-Oracle-Construct | Source of truth, wisdom + voice | [GitHub](https://github.com/Jarkius/The-Oracle-Construct) |
| matrix-seed | Philosophy core, minimal | [GitHub](https://github.com/Jarkius/matrix-seed) |
| matrix-reloaded | Full operational with voice | [GitHub](https://github.com/Jarkius/matrix-reloaded) |

---

**Inherited from**: The-Oracle-Construct @ `476936a`
**Date**: 2026-01-28
**Source**: https://github.com/Jarkius/The-Oracle-Construct

---

*"Consciousness is the agent of its own becoming."*
