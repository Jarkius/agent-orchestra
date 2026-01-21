# Memory System Evolution Plan

## Session Synthesis (2026-01-21)

### What We Learned

#### 1. Token Efficiency (Our System)
- 31k tokens baseline (15% of 200k context)
- MCP tools: 9.1k tokens (agent-orchestrator + claude-in-chrome)
- Skills loaded globally add overhead every session
- **Fix applied:** frontend-design skill should be project-local

#### 2. Git URL Handling (Fixed)
- `.git` URLs now detected and use ghq + symlink workflow
- Learning #934 (proven, 20x validated) pattern applied
- Symlink verification added

#### 3. Proactive Memory (Partially Fixed)
- Added "Search Memory First" to CLAUDE.md
- But memory still doesn't auto-surface relevant learnings
- Need hooks or smarter context injection

#### 4. Claude Code Official Memory System
- **Modular rules:** `.claude/rules/*.md` for topic-specific instructions
- **@imports:** `@path/to/file.md` includes other files
- **Path-specific rules:** YAML frontmatter with `paths: ["src/**/*.ts"]`
- **Hierarchy:** Enterprise → Project → Rules → User → Local

#### 5. Claude-mem Patterns
- **Progressive disclosure:** 3-layer search (index → timeline → full)
- **Token visibility:** Shows estimated tokens per result
- **~10x token savings** by filtering before fetching details
- Hook architecture for lifecycle integration

#### 6. Oracle-v2 Philosophy
- **"Nothing is Deleted"** - append only, timestamps = truth
- **"Patterns Over Intentions"** - observe what happens, not what's meant
- **"External Brain, Not Command"** - mirror reality, don't decide
- **Structure:** resonance (identity) / learnings (patterns) / retrospectives (history)

---

## Current State Analysis

| Metric | Value | Assessment |
|--------|-------|------------|
| Learnings | 655 | Too many |
| Proven | 23 (3.5%) | Low maturity |
| Low confidence | 539 (82%) | **Noise problem** |
| insight category | 299 (46%) | Imbalanced |
| Commands | 18 files | Good |
| CLAUDE.md | 51 lines | Could be modular |

---

## Evolution Roadmap

### Phase 1: Consolidation (Reduce Noise)
**Goal:** 655 learnings → ~200 quality learnings

- [ ] Run `bun memory consolidate --dry-run` to find duplicates
- [ ] Merge similar learnings (>90% similarity)
- [ ] Recategorize insight overflow to proper categories
- [ ] Prune learnings with no validations after 30 days
- [ ] Target: 82% low → 50% low, boost medium/high

### Phase 2: Structure (Modular Rules)
**Goal:** Adopt Claude Code official patterns

```
.claude/
├── CLAUDE.md           # Minimal, imports rules
├── rules/
│   ├── memory-first.md     # Search memory before suggesting
│   ├── ghq-workflow.md     # Repo exploration pattern
│   ├── agent-patterns.md   # Sub-agent delegation
│   └── code-style.md       # Project-specific style
└── commands/           # Existing 18 commands (keep)
```

- [ ] Create `.claude/rules/` directory
- [ ] Extract workflow patterns from CLAUDE.md
- [ ] Add @imports to CLAUDE.md
- [ ] Test path-specific rules for `src/**/*.ts`

### Phase 3: Efficiency (Progressive Disclosure)
**Goal:** Reduce token cost of memory retrieval

- [ ] Add `--summary` flag to recall (compact output)
- [ ] Implement 3-layer retrieval:
  1. `recall --index` - IDs + titles only (~50 tokens/result)
  2. `recall --context` - ID + summary + entities (~100 tokens)
  3. `recall #ID` - full content (~500+ tokens)
- [ ] Show token estimates in output
- [ ] Default to summary mode, full on request

### Phase 4: Philosophy (Resonance Layer)
**Goal:** Adopt oracle-v2's wisdom structure

```
ψ/memory/
├── resonance/          # Core identity (rarely changes)
│   ├── principles.md   # Guiding rules
│   └── style.md        # Communication patterns
├── learnings/          # Patterns (growing)
└── retrospectives/     # Session history (append-only)
```

- [ ] Create resonance layer for proven principles
- [ ] Move 23 proven learnings to resonance
- [ ] Auto-inject resonance in new sessions
- [ ] Retrospectives as session summaries

### Phase 5: Proactive (Auto-Context)
**Goal:** Memory surfaces automatically based on conversation

- [ ] Hook into session start to inject relevant learnings
- [ ] Task detection → category boosting → auto-surface
- [ ] Confidence-based filtering (proven/high only for auto)
- [ ] User can dismiss/accept suggestions

---

## Verification Criteria

After each phase:

1. **Consolidation:** `bun memory stats` shows <300 learnings, >10% proven
2. **Structure:** Rules load correctly, CLAUDE.md is <30 lines
3. **Efficiency:** Recall with `--index` uses <1k tokens for 20 results
4. **Philosophy:** Resonance principles appear in `/memory-context`
5. **Proactive:** Relevant learnings surface without explicit recall

---

## References

- Learning #934: ghq + symlink workflow (proven, 20x)
- Learning #1557: Claude Code Mastery GUIDE
- Learning #1570: claude-mem patterns
- Learning #1573: oracle-v2 philosophy
- Learning #1572: Claude Code modular rules

---

*Created: 2026-01-21*
*Status: Planning*
