# Learning Loop: Closed-Loop Knowledge System

## Overview

The Learning Loop implements a closed-loop learning system that automatically harvests knowledge from missions, analyzes failures, recommends agents based on history, and maintains a dual-collection pattern for knowledge management.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MISSION EXECUTION                         │
│              (Agent completes/fails a task)                  │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌──────────┐   ┌──────────┐   ┌──────────┐
       │ harvest  │   │ analyze  │   │  detect  │
       │ (success)│   │ (failure)│   │ patterns │
       └────┬─────┘   └────┬─────┘   └────┬─────┘
            │              │              │
            ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                   DUAL-COLLECTION STORE                      │
│                                                              │
│  ┌────────────────────┐    ┌────────────────────┐          │
│  │     KNOWLEDGE      │    │      LESSONS       │          │
│  │   (Raw Facts)      │    │ (Problem→Solution) │          │
│  │                    │    │                    │          │
│  │ • Observations     │    │ • problem: what    │          │
│  │ • Discoveries      │    │ • solution: how    │          │
│  │ • Mission outputs  │    │ • outcome: result  │          │
│  └────────────────────┘    └────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    RECOMMENDATIONS                           │
│  • Agent selection based on success history                  │
│  • Relevant lessons for new problems                         │
│  • Similar failure analysis                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Dual-Collection Pattern

The system maintains two separate collections for different types of knowledge:

### Knowledge Entries (Raw Facts)

Stored in `knowledge` table and `knowledge_entries` ChromaDB collection.

```typescript
interface KnowledgeEntry {
  id: string;
  content: string;      // The observation/fact
  missionId?: string;   // Source mission
  category?: string;    // Topic category
  timestamp: Date;
}
```

**Use cases:**
- Mission outputs and discoveries
- Code observations
- System behaviors documented

### Lesson Entries (Structured Solutions)

Stored in `lessons` table and `lesson_entries` ChromaDB collection.

```typescript
interface LessonEntry {
  id: string;
  problem: string;      // What went wrong
  solution: string;     // How it was fixed
  outcome: string;      // Result/verification
  category?: string;
  confidence: number;   // 0-1 scale
  frequency: number;    // How often encountered
}
```

**Use cases:**
- Debugging patterns
- Best practices from experience
- Repeated problem solutions

---

## Core Methods

### Knowledge Management

```typescript
// Add raw knowledge
await learningLoop.addKnowledge({
  content: "ChromaDB requires cosine distance for semantic search",
  category: "architecture",
  missionId: "mission_123"
});

// Search knowledge
const entries = await learningLoop.searchKnowledge("embedding distance", 5);
```

### Lesson Management

```typescript
// Add a lesson
await learningLoop.addLesson({
  problem: "TypeScript import errors with ESM modules",
  solution: "Add 'type': 'module' to package.json and use .js extensions",
  outcome: "Resolved all import errors, builds successfully",
  category: "tooling",
  confidence: 0.8
});

// Find relevant lessons for a problem
const lessons = await learningLoop.getRelevantLessons(
  "module resolution failing"
);
```

### Harvesting from Sessions

```typescript
// Extract learnings from a session's context
const learnings = await learningLoop.harvestFromSession("session_123");

// Auto-distill from recent sessions
const result = await learningLoop.autoDistillSessions({
  limit: 10,
  minAgeDays: 1
});
// Returns: { sessionsProcessed, learningsExtracted, errors }
```

### Failure Analysis

```typescript
// Analyze a failed mission
const analysis = await learningLoop.analyzeFailure(failedMission);
// Returns: {
//   rootCause: "Task exceeded 120s timeout",
//   category: "timeout",
//   suggestion: "Consider increasing timeout or breaking task into smaller chunks",
//   similarFailures: ["learning_45", "learning_67"]
// }

// Cluster similar failures
const clusters = learningLoop.clusterSimilarFailures(failures);
// Returns: Map<clusterKey, FailedMission[]>
```

### Agent Recommendation

```typescript
// Get best agent for a task based on learning history
const recommendation = await learningLoop.recommendAgent({
  prompt: "Implement caching with Redis",
  type: "implementation"
});
// Returns: {
//   agentId: 2,
//   reason: "75% success rate on 8 similar tasks",
//   confidence: 0.8,
//   alternatives: [1, 3]
// }
```

### Pattern Detection

```typescript
// Detect patterns in recent missions
const patterns = await learningLoop.detectPatterns(missions, 20);
// Returns patterns like:
// - "analysis tasks have 40% failure rate"
// - "implementation tasks have 90% success rate"
```

---

## Confidence Model

Lessons use a numeric confidence scale (0-1):

| Score | Meaning | When Applied |
|-------|---------|--------------|
| 0.3 | Low | Auto-extracted, unverified |
| 0.5 | Medium | Manually added or validated once |
| 0.7 | High | Validated multiple times |
| 0.9+ | Proven | Consistently useful |

### Confidence Updates

```typescript
// Boost confidence when lesson proves useful
learningLoop.boostConfidence(lessonId, "Used successfully in mission_456");

// Decay stale learnings (call periodically)
learningLoop.decayStale(90); // Decay learnings older than 90 days
```

---

## Integration with Oracle

The Oracle orchestrator integrates with the learning loop for intelligent agent selection:

```typescript
// Oracle uses learning loop for recommendations
const { agent, reason, lessons } = await oracle.recommendAgentWithLearning({
  prompt: "Fix authentication bug",
  type: "debugging"
});

// Relevant lessons are included for agent context
console.log(lessons);
// [{ problem: "JWT expiry not checked", solution: "Add middleware validation", ... }]
```

---

## CLI Commands

```bash
# Quick knowledge capture
bun memory learn debugging "Cache invalidation timing" \
  --lesson "Always invalidate before write" \
  --prevention "Add pre-write hooks"

# Extract learnings from sessions
bun memory distill              # Last session
bun memory distill --last 5     # Last 5 sessions
bun memory distill --all        # All sessions

# Validate a learning (increases confidence)
/memory-validate 45

# Export learnings to markdown
bun memory export
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `add_learning` | Create a new learning with structured fields |
| `recall_learnings` | Search learnings semantically |
| `validate_learning` | Increase confidence of a learning |
| `get_learning` | Get learning details by ID |
| `list_learnings` | List learnings with filters |

---

## Storage

### SQLite Tables

```sql
-- Raw knowledge entries
CREATE TABLE knowledge (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL,
  mission_id TEXT,
  category TEXT,
  agent_id INTEGER,
  created_at TEXT
);

-- Structured lessons
CREATE TABLE lessons (
  id INTEGER PRIMARY KEY,
  problem TEXT NOT NULL,
  solution TEXT NOT NULL,
  outcome TEXT NOT NULL,
  category TEXT,
  confidence REAL DEFAULT 0.5,
  frequency INTEGER DEFAULT 1,
  agent_id INTEGER,
  created_at TEXT
);
```

### ChromaDB Collections

| Collection | Purpose |
|------------|---------|
| `knowledge_entries` | Semantic search over raw knowledge |
| `lesson_entries` | Semantic search over lessons |

---

## File Structure

```
src/learning/
├── loop.ts           # LearningLoop class implementation
├── index.ts          # Exports and singleton
└── tests/
    └── integration.test.ts

src/interfaces/
└── learning.ts       # Type definitions
```

---

## Best Practices

1. **Add lessons for repeated problems** - If you solve the same type of issue twice, create a lesson
2. **Validate when useful** - Increase confidence when a lesson helps solve a problem
3. **Use categories** - Helps with filtering and organization
4. **Include outcomes** - Lessons without outcomes are less useful
5. **Periodically distill** - Run `bun memory distill --last 5` weekly to capture insights
