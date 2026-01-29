/**
 * Task Linking Tests
 *
 * Tests for the task intelligence bridge between:
 * - unified_tasks (persistent business requirements)
 * - agent_tasks (execution history)
 * - missions (orchestration queue)
 * - learnings (knowledge extraction)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createTempDb,
  cleanupTempDb,
  getTempDb,
  createTestTask,
  createTestAgent,
  createTestAgentTask,
  createTestMission,
  createTestLinkedLearning,
  completeTestAgentTask,
  assertFieldEquals,
  assertRowCount,
  randomString,
} from "./test-utils";

// ============================================================================
// Task Linking Schema Tests
// ============================================================================

describe("Task Linking Schema", () => {
  let db: Database;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    cleanupTempDb();
  });

  describe("agent_tasks table", () => {
    it("includes unified_task_id column", () => {
      const task = createTestAgentTask(db, { unified_task_id: 42 });
      const row = db.query(`SELECT unified_task_id FROM agent_tasks WHERE id = ?`).get(task.id) as any;
      expect(row.unified_task_id).toBe(42);
    });

    it("includes parent_mission_id column", () => {
      const task = createTestAgentTask(db, { parent_mission_id: "mission_abc123" });
      const row = db.query(`SELECT parent_mission_id FROM agent_tasks WHERE id = ?`).get(task.id) as any;
      expect(row.parent_mission_id).toBe("mission_abc123");
    });

    it("allows null for linking columns", () => {
      const task = createTestAgentTask(db, {});
      const row = db.query(`SELECT unified_task_id, parent_mission_id FROM agent_tasks WHERE id = ?`).get(task.id) as any;
      expect(row.unified_task_id).toBeNull();
      expect(row.parent_mission_id).toBeNull();
    });

    it("has index on unified_task_id", () => {
      const indexes = db.query(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_tasks'`).all() as any[];
      const hasIndex = indexes.some((i) => i.name === "idx_agent_tasks_unified");
      expect(hasIndex).toBe(true);
    });

    it("has index on parent_mission_id", () => {
      const indexes = db.query(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_tasks'`).all() as any[];
      const hasIndex = indexes.some((i) => i.name === "idx_agent_tasks_mission");
      expect(hasIndex).toBe(true);
    });
  });

  describe("missions table", () => {
    it("includes unified_task_id column", () => {
      const mission = createTestMission(db, { unified_task_id: 99 });
      const row = db.query(`SELECT unified_task_id FROM missions WHERE id = ?`).get(mission.id) as any;
      expect(row.unified_task_id).toBe(99);
    });

    it("has index on unified_task_id", () => {
      const indexes = db.query(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='missions'`).all() as any[];
      const hasIndex = indexes.some((i) => i.name === "idx_missions_unified");
      expect(hasIndex).toBe(true);
    });
  });

  describe("learnings table", () => {
    it("includes source_task_id column", () => {
      const learning = createTestLinkedLearning(db, { source_task_id: "task_abc" });
      const row = db.query(`SELECT source_task_id FROM learnings WHERE id = ?`).get(learning.id) as any;
      expect(row.source_task_id).toBe("task_abc");
    });

    it("includes source_mission_id column", () => {
      const learning = createTestLinkedLearning(db, { source_mission_id: "mission_xyz" });
      const row = db.query(`SELECT source_mission_id FROM learnings WHERE id = ?`).get(learning.id) as any;
      expect(row.source_mission_id).toBe("mission_xyz");
    });

    it("includes source_unified_task_id column", () => {
      const learning = createTestLinkedLearning(db, { source_unified_task_id: 123 });
      const row = db.query(`SELECT source_unified_task_id FROM learnings WHERE id = ?`).get(learning.id) as any;
      expect(row.source_unified_task_id).toBe(123);
    });

    it("has indexes on source columns", () => {
      const indexes = db.query(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='learnings'`).all() as any[];
      expect(indexes.some((i) => i.name === "idx_learnings_task")).toBe(true);
      expect(indexes.some((i) => i.name === "idx_learnings_mission")).toBe(true);
      expect(indexes.some((i) => i.name === "idx_learnings_unified")).toBe(true);
    });
  });
});

// ============================================================================
// Task Assignment Linking Tests
// ============================================================================

describe("Task Assignment Linking", () => {
  let db: Database;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it("links agent_task to unified_task on assignment", () => {
    // Create a unified task (business requirement)
    const unifiedTask = createTestTask(db, {
      title: "Implement feature X",
      domain: "project",
      status: "open",
    });

    // Assign work to an agent with link
    const agentTask = createTestAgentTask(db, {
      prompt: "Write the code for feature X",
      unified_task_id: unifiedTask.id,
    });

    // Verify link exists
    const row = db.query(`SELECT unified_task_id FROM agent_tasks WHERE id = ?`).get(agentTask.id) as any;
    expect(row.unified_task_id).toBe(unifiedTask.id);
  });

  it("links mission to unified_task on enqueue", () => {
    const unifiedTask = createTestTask(db, {
      title: "Analyze codebase",
      domain: "system",
    });

    const mission = createTestMission(db, {
      prompt: "Deep analysis of module dependencies",
      type: "analysis",
      unified_task_id: unifiedTask.id,
    });

    const row = db.query(`SELECT unified_task_id FROM missions WHERE id = ?`).get(mission.id) as any;
    expect(row.unified_task_id).toBe(unifiedTask.id);
  });

  it("links agent_task to parent mission", () => {
    const mission = createTestMission(db, {
      prompt: "Complex multi-step task",
    });

    const agentTask = createTestAgentTask(db, {
      prompt: "Step 1 of complex task",
      parent_mission_id: mission.id,
    });

    const row = db.query(`SELECT parent_mission_id FROM agent_tasks WHERE id = ?`).get(agentTask.id) as any;
    expect(row.parent_mission_id).toBe(mission.id);
  });

  it("creates full lineage: unified → mission → agent_task", () => {
    // Business requirement
    const unifiedTask = createTestTask(db, {
      title: "Build authentication system",
      domain: "project",
    });

    // Orchestration mission
    const mission = createTestMission(db, {
      prompt: "Implement JWT auth",
      unified_task_id: unifiedTask.id,
    });

    // Actual agent work
    const agentTask = createTestAgentTask(db, {
      prompt: "Write JWT validation code",
      unified_task_id: unifiedTask.id,
      parent_mission_id: mission.id,
    });

    // Query full lineage
    const lineage = db.query(`
      SELECT
        ut.title as unified_title,
        m.prompt as mission_prompt,
        at.prompt as task_prompt
      FROM agent_tasks at
      JOIN unified_tasks ut ON at.unified_task_id = ut.id
      JOIN missions m ON at.parent_mission_id = m.id
      WHERE at.id = ?
    `).get(agentTask.id) as any;

    expect(lineage.unified_title).toBe("Build authentication system");
    expect(lineage.mission_prompt).toBe("Implement JWT auth");
    expect(lineage.task_prompt).toBe("Write JWT validation code");
  });
});

// ============================================================================
// Completion Sync Tests
// ============================================================================

describe("Task Completion Sync", () => {
  let db: Database;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it("unified_task remains open when linked tasks still pending", () => {
    const unifiedTask = createTestTask(db, {
      title: "Multi-step feature",
      domain: "project",
      status: "in_progress",
    });

    // Two tasks linked to same unified task
    createTestAgentTask(db, { unified_task_id: unifiedTask.id, status: "completed" });
    createTestAgentTask(db, { unified_task_id: unifiedTask.id, status: "pending" });

    // Check: should still be in_progress (one task still pending)
    const row = db.query(`SELECT status FROM unified_tasks WHERE id = ?`).get(unifiedTask.id) as any;
    expect(row.status).toBe("in_progress");
  });

  it("can query all agent_tasks for a unified_task", () => {
    const unifiedTask = createTestTask(db, { title: "Feature Y", domain: "project" });

    createTestAgentTask(db, { prompt: "Task 1", unified_task_id: unifiedTask.id });
    createTestAgentTask(db, { prompt: "Task 2", unified_task_id: unifiedTask.id });
    createTestAgentTask(db, { prompt: "Task 3", unified_task_id: unifiedTask.id });

    const tasks = db.query(`SELECT * FROM agent_tasks WHERE unified_task_id = ?`).all(unifiedTask.id) as any[];
    expect(tasks.length).toBe(3);
  });

  it("tracks token usage per unified_task", () => {
    const unifiedTask = createTestTask(db, { title: "Token test", domain: "project" });

    createTestAgentTask(db, { unified_task_id: unifiedTask.id, input_tokens: 1000 });
    createTestAgentTask(db, { unified_task_id: unifiedTask.id, input_tokens: 2500 });
    createTestAgentTask(db, { unified_task_id: unifiedTask.id, input_tokens: 500 });

    const result = db.query(`
      SELECT SUM(input_tokens) as total_tokens
      FROM agent_tasks
      WHERE unified_task_id = ?
    `).get(unifiedTask.id) as any;

    expect(result.total_tokens).toBe(4000);
  });

  it("calculates duration per unified_task", () => {
    const unifiedTask = createTestTask(db, { title: "Duration test", domain: "project" });

    createTestAgentTask(db, { unified_task_id: unifiedTask.id, duration_ms: 5000 });
    createTestAgentTask(db, { unified_task_id: unifiedTask.id, duration_ms: 3000 });

    const result = db.query(`
      SELECT SUM(duration_ms) as total_duration, AVG(duration_ms) as avg_duration
      FROM agent_tasks
      WHERE unified_task_id = ?
    `).get(unifiedTask.id) as any;

    expect(result.total_duration).toBe(8000);
    expect(result.avg_duration).toBe(4000);
  });
});

// ============================================================================
// Learning Link Tests
// ============================================================================

describe("Learning Task Links", () => {
  let db: Database;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it("attaches source_task_id to harvested learning", () => {
    const agentTask = createTestAgentTask(db, { prompt: "Debug memory leak" });

    const learning = createTestLinkedLearning(db, {
      category: "debugging",
      title: "Memory leak detection pattern",
      source_task_id: agentTask.id,
    });

    const row = db.query(`SELECT source_task_id FROM learnings WHERE id = ?`).get(learning.id) as any;
    expect(row.source_task_id).toBe(agentTask.id);
  });

  it("attaches source_mission_id to harvested learning", () => {
    const mission = createTestMission(db, { prompt: "Performance optimization" });

    const learning = createTestLinkedLearning(db, {
      category: "performance",
      title: "Query optimization technique",
      source_mission_id: mission.id,
    });

    const row = db.query(`SELECT source_mission_id FROM learnings WHERE id = ?`).get(learning.id) as any;
    expect(row.source_mission_id).toBe(mission.id);
  });

  it("attaches source_unified_task_id for full traceability", () => {
    const unifiedTask = createTestTask(db, { title: "Fix auth bug", domain: "project" });
    const mission = createTestMission(db, { unified_task_id: unifiedTask.id });
    const agentTask = createTestAgentTask(db, {
      unified_task_id: unifiedTask.id,
      parent_mission_id: mission.id
    });

    const learning = createTestLinkedLearning(db, {
      category: "debugging",
      title: "Auth token expiry handling",
      source_task_id: agentTask.id,
      source_mission_id: mission.id,
      source_unified_task_id: unifiedTask.id,
    });

    const row = db.query(`
      SELECT source_task_id, source_mission_id, source_unified_task_id
      FROM learnings WHERE id = ?
    `).get(learning.id) as any;

    expect(row.source_task_id).toBe(agentTask.id);
    expect(row.source_mission_id).toBe(mission.id);
    expect(row.source_unified_task_id).toBe(unifiedTask.id);
  });

  it("queries learnings by unified_task", () => {
    const unifiedTask = createTestTask(db, { title: "Feature Z", domain: "project" });

    createTestLinkedLearning(db, { title: "Learning 1", source_unified_task_id: unifiedTask.id });
    createTestLinkedLearning(db, { title: "Learning 2", source_unified_task_id: unifiedTask.id });
    createTestLinkedLearning(db, { title: "Unrelated learning" });

    const learnings = db.query(`
      SELECT * FROM learnings WHERE source_unified_task_id = ?
    `).all(unifiedTask.id) as any[];

    expect(learnings.length).toBe(2);
  });

  it("queries learnings by mission", () => {
    const mission = createTestMission(db, { prompt: "Test mission" });

    createTestLinkedLearning(db, { title: "Mission learning", source_mission_id: mission.id });

    const learnings = db.query(`
      SELECT * FROM learnings WHERE source_mission_id = ?
    `).all(mission.id) as any[];

    expect(learnings.length).toBe(1);
    expect(learnings[0].title).toBe("Mission learning");
  });
});

// ============================================================================
// Task Lineage Query Tests
// ============================================================================

describe("Task Lineage Queries", () => {
  let db: Database;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it("gets full task lineage for a unified_task", () => {
    const unifiedTask = createTestTask(db, { title: "Complex feature", domain: "project" });

    // Multiple missions
    const mission1 = createTestMission(db, { prompt: "Phase 1", unified_task_id: unifiedTask.id });
    const mission2 = createTestMission(db, { prompt: "Phase 2", unified_task_id: unifiedTask.id });

    // Agent tasks under missions
    createTestAgentTask(db, { prompt: "M1-T1", unified_task_id: unifiedTask.id, parent_mission_id: mission1.id });
    createTestAgentTask(db, { prompt: "M1-T2", unified_task_id: unifiedTask.id, parent_mission_id: mission1.id });
    createTestAgentTask(db, { prompt: "M2-T1", unified_task_id: unifiedTask.id, parent_mission_id: mission2.id });

    // Learnings
    createTestLinkedLearning(db, { title: "L1", source_unified_task_id: unifiedTask.id });
    createTestLinkedLearning(db, { title: "L2", source_unified_task_id: unifiedTask.id });

    // Query lineage
    const missions = db.query(`SELECT * FROM missions WHERE unified_task_id = ?`).all(unifiedTask.id) as any[];
    const tasks = db.query(`SELECT * FROM agent_tasks WHERE unified_task_id = ?`).all(unifiedTask.id) as any[];
    const learnings = db.query(`SELECT * FROM learnings WHERE source_unified_task_id = ?`).all(unifiedTask.id) as any[];

    expect(missions.length).toBe(2);
    expect(tasks.length).toBe(3);
    expect(learnings.length).toBe(2);
  });

  it("finds sibling tasks (same unified_task)", () => {
    const unifiedTask = createTestTask(db, { title: "Shared work", domain: "project" });

    const task1 = createTestAgentTask(db, { prompt: "Sibling 1", unified_task_id: unifiedTask.id });
    const task2 = createTestAgentTask(db, { prompt: "Sibling 2", unified_task_id: unifiedTask.id });
    createTestAgentTask(db, { prompt: "Unrelated" });

    const siblings = db.query(`
      SELECT * FROM agent_tasks
      WHERE unified_task_id = ? AND id != ?
    `).all(unifiedTask.id, task1.id) as any[];

    expect(siblings.length).toBe(1);
    expect(siblings[0].prompt).toBe("Sibling 2");
  });

  it("calculates stats per unified_task", () => {
    const unifiedTask = createTestTask(db, { title: "Stats test", domain: "project" });

    createTestAgentTask(db, { unified_task_id: unifiedTask.id, status: "completed", input_tokens: 1000, duration_ms: 5000 });
    createTestAgentTask(db, { unified_task_id: unifiedTask.id, status: "completed", input_tokens: 2000, duration_ms: 3000 });
    createTestAgentTask(db, { unified_task_id: unifiedTask.id, status: "failed" });

    const stats = db.query(`
      SELECT
        COUNT(*) as total_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(input_tokens) as total_tokens,
        SUM(duration_ms) as total_duration_ms
      FROM agent_tasks
      WHERE unified_task_id = ?
    `).get(unifiedTask.id) as any;

    expect(stats.total_tasks).toBe(3);
    expect(stats.completed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.total_tokens).toBe(3000);
    expect(stats.total_duration_ms).toBe(8000);
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe("Task Linking Edge Cases", () => {
  let db: Database;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it("handles orphaned tasks gracefully", () => {
    // Create task with non-existent unified_task_id (orphaned)
    const orphanTask = createTestAgentTask(db, { unified_task_id: 99999 });

    // Query should still work
    const row = db.query(`SELECT * FROM agent_tasks WHERE id = ?`).get(orphanTask.id) as any;
    expect(row).toBeTruthy();
    expect(row.unified_task_id).toBe(99999);

    // Left join returns null for missing parent
    const lineage = db.query(`
      SELECT at.id, ut.title
      FROM agent_tasks at
      LEFT JOIN unified_tasks ut ON at.unified_task_id = ut.id
      WHERE at.id = ?
    `).get(orphanTask.id) as any;

    expect(lineage.id).toBe(orphanTask.id);
    expect(lineage.title).toBeNull();
  });

  it("handles tasks with only mission link (no unified)", () => {
    const mission = createTestMission(db, { prompt: "Standalone mission" });
    const task = createTestAgentTask(db, {
      parent_mission_id: mission.id,
      // No unified_task_id
    });

    const row = db.query(`SELECT unified_task_id, parent_mission_id FROM agent_tasks WHERE id = ?`).get(task.id) as any;
    expect(row.unified_task_id).toBeNull();
    expect(row.parent_mission_id).toBe(mission.id);
  });

  it("handles learning with partial links", () => {
    const learning = createTestLinkedLearning(db, {
      title: "Partial link",
      source_mission_id: "mission_123",
      // No task or unified links
    });

    const row = db.query(`
      SELECT source_task_id, source_mission_id, source_unified_task_id
      FROM learnings WHERE id = ?
    `).get(learning.id) as any;

    expect(row.source_task_id).toBeNull();
    expect(row.source_mission_id).toBe("mission_123");
    expect(row.source_unified_task_id).toBeNull();
  });

  it("handles concurrent task creation with same unified_task", () => {
    const unifiedTask = createTestTask(db, { title: "Concurrent test", domain: "project" });

    // Simulate concurrent creation
    const tasks = Array.from({ length: 10 }, (_, i) =>
      createTestAgentTask(db, {
        prompt: `Concurrent task ${i}`,
        unified_task_id: unifiedTask.id
      })
    );

    expect(tasks.length).toBe(10);

    const count = db.query(`SELECT COUNT(*) as count FROM agent_tasks WHERE unified_task_id = ?`).get(unifiedTask.id) as any;
    expect(count.count).toBe(10);
  });

  it("handles empty/null values in link columns", () => {
    // All links null
    const task = createTestAgentTask(db, {
      unified_task_id: undefined,
      parent_mission_id: undefined,
    });

    const row = db.query(`SELECT * FROM agent_tasks WHERE id = ?`).get(task.id) as any;
    expect(row.unified_task_id).toBeNull();
    expect(row.parent_mission_id).toBeNull();
  });

  it("queries across domains correctly", () => {
    const systemTask = createTestTask(db, { title: "System work", domain: "system" });
    const projectTask = createTestTask(db, { title: "Project work", domain: "project" });
    const sessionTask = createTestTask(db, { title: "Session work", domain: "session" });

    createTestAgentTask(db, { unified_task_id: systemTask.id });
    createTestAgentTask(db, { unified_task_id: projectTask.id });
    createTestAgentTask(db, { unified_task_id: projectTask.id });
    createTestAgentTask(db, { unified_task_id: sessionTask.id });

    // Count by domain
    const result = db.query(`
      SELECT ut.domain, COUNT(at.id) as task_count
      FROM agent_tasks at
      JOIN unified_tasks ut ON at.unified_task_id = ut.id
      GROUP BY ut.domain
    `).all() as any[];

    const byDomain = Object.fromEntries(result.map((r) => [r.domain, r.task_count]));
    expect(byDomain.system).toBe(1);
    expect(byDomain.project).toBe(2);
    expect(byDomain.session).toBe(1);
  });
});

// ============================================================================
// Integration-style Tests
// ============================================================================

describe("Task Linking Integration", () => {
  let db: Database;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    cleanupTempDb();
  });

  it("simulates full workflow: requirement → mission → task → learning", () => {
    // 1. Business requirement created
    const unifiedTask = createTestTask(db, {
      title: "Add user authentication",
      domain: "project",
      status: "open",
    });

    // 2. Orchestrator creates mission
    const mission = createTestMission(db, {
      prompt: "Implement JWT-based authentication",
      type: "synthesis",
      unified_task_id: unifiedTask.id,
    });

    // Update unified task to in_progress
    db.run(`UPDATE unified_tasks SET status = 'in_progress' WHERE id = ?`, [unifiedTask.id]);

    // 3. Agent executes task
    const agent = createTestAgent(db, { role: "coder" });
    const agentTask = createTestAgentTask(db, {
      agent_id: agent.id,
      prompt: "Write JWT validation middleware",
      unified_task_id: unifiedTask.id,
      parent_mission_id: mission.id,
      status: "running",
    });

    // 4. Task completes
    completeTestAgentTask(db, agentTask.id!, "JWT middleware implemented with refresh tokens", 45000);

    // 5. Learning harvested
    const learning = createTestLinkedLearning(db, {
      category: "architecture",
      title: "JWT refresh token rotation pattern",
      description: "Implemented sliding window refresh for better security",
      source_task_id: agentTask.id,
      source_mission_id: mission.id,
      source_unified_task_id: unifiedTask.id,
    });

    // Verify full traceability
    const fullQuery = db.query(`
      SELECT
        ut.title as requirement,
        m.prompt as mission,
        at.prompt as task,
        at.result as task_result,
        l.title as learning_title
      FROM learnings l
      JOIN agent_tasks at ON l.source_task_id = at.id
      JOIN missions m ON l.source_mission_id = m.id
      JOIN unified_tasks ut ON l.source_unified_task_id = ut.id
      WHERE l.id = ?
    `).get(learning.id) as any;

    expect(fullQuery.requirement).toBe("Add user authentication");
    expect(fullQuery.mission).toBe("Implement JWT-based authentication");
    expect(fullQuery.task).toBe("Write JWT validation middleware");
    expect(fullQuery.task_result).toContain("JWT middleware");
    expect(fullQuery.learning_title).toBe("JWT refresh token rotation pattern");
  });

  it("tracks cost attribution per requirement", () => {
    const feature1 = createTestTask(db, { title: "Feature 1", domain: "project" });
    const feature2 = createTestTask(db, { title: "Feature 2", domain: "project" });

    // Feature 1: 3 tasks, various costs
    createTestAgentTask(db, { unified_task_id: feature1.id, input_tokens: 1000, duration_ms: 10000 });
    createTestAgentTask(db, { unified_task_id: feature1.id, input_tokens: 2000, duration_ms: 20000 });
    createTestAgentTask(db, { unified_task_id: feature1.id, input_tokens: 500, duration_ms: 5000 });

    // Feature 2: 2 tasks, higher costs
    createTestAgentTask(db, { unified_task_id: feature2.id, input_tokens: 5000, duration_ms: 60000 });
    createTestAgentTask(db, { unified_task_id: feature2.id, input_tokens: 3000, duration_ms: 40000 });

    // Cost report per feature
    const costs = db.query(`
      SELECT
        ut.title,
        COUNT(at.id) as task_count,
        SUM(at.input_tokens) as total_tokens,
        SUM(at.duration_ms) / 1000.0 as total_seconds
      FROM unified_tasks ut
      LEFT JOIN agent_tasks at ON ut.id = at.unified_task_id
      GROUP BY ut.id
      ORDER BY total_tokens DESC
    `).all() as any[];

    expect(costs[0].title).toBe("Feature 2");
    expect(costs[0].task_count).toBe(2);
    expect(costs[0].total_tokens).toBe(8000);

    expect(costs[1].title).toBe("Feature 1");
    expect(costs[1].task_count).toBe(3);
    expect(costs[1].total_tokens).toBe(3500);
  });

  it("finds related learnings for similar tasks", () => {
    // Past task and learning
    const pastTask = createTestTask(db, { title: "Fix memory leak", domain: "project" });
    createTestLinkedLearning(db, {
      category: "debugging",
      title: "Memory profiling with heapdump",
      source_unified_task_id: pastTask.id,
    });

    // Current similar task
    const currentTask = createTestTask(db, { title: "Debug memory issue", domain: "project" });

    // Query learnings from similar past work (simulating semantic search would use category)
    const relatedLearnings = db.query(`
      SELECT l.* FROM learnings l
      WHERE l.category = 'debugging'
      AND l.source_unified_task_id IS NOT NULL
    `).all() as any[];

    expect(relatedLearnings.length).toBe(1);
    expect(relatedLearnings[0].title).toContain("Memory");
  });
});
