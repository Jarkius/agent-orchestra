/**
 * Multi-Agent Orchestration Tests
 *
 * Tests for agents, missions, and orchestration
 * Uses bun:test with isolated temp database
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createTempDb,
  cleanupTempDb,
  createTestAgent,
  createTestMission,
  incrementAgentStats,
  assertExists,
  assertNotExists,
  assertRowCount,
  assertFieldEquals,
  randomString,
  parallel,
  AgentRole,
  AgentModel,
} from "./test-utils";

// ============================================================================
// Agents Schema Tests
// ============================================================================

describe("Agents Schema", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("creates agent with default status pending", () => {
    const agent = createTestAgent(db, { status: "pending" });

    assertExists(db, "agents", agent.id);
    assertFieldEquals(db, "agents", agent.id, "status", "pending");
  });

  it("stores agent with explicit ID", () => {
    const agentId = 12345;
    const agent = createTestAgent(db, { id: agentId });

    expect(agent.id).toBe(agentId);
    assertExists(db, "agents", agentId);
  });

  it("tracks tasks_completed and tasks_failed", () => {
    const agent = createTestAgent(db, {
      tasks_completed: 5,
      tasks_failed: 2,
    });

    assertFieldEquals(db, "agents", agent.id, "tasks_completed", 5);
    assertFieldEquals(db, "agents", agent.id, "tasks_failed", 2);
  });

  it("updates timestamps", () => {
    const agent = createTestAgent(db);

    const before = db.query(`SELECT updated_at FROM agents WHERE id = ?`).get(agent.id) as any;

    db.run(`UPDATE agents SET status = 'busy', updated_at = datetime('now') WHERE id = ?`, [agent.id]);

    const after = db.query(`SELECT updated_at FROM agents WHERE id = ?`).get(agent.id) as any;
    expect(after.updated_at).toBeDefined();
  });

  it("handles NULL pane_id and pid", () => {
    const agent = createTestAgent(db);

    const row = db.query(`SELECT pane_id, pid FROM agents WHERE id = ?`).get(agent.id) as any;
    expect(row.pane_id).toBeNull();
    expect(row.pid).toBeNull();
  });
});

// ============================================================================
// Agent Roles Tests
// ============================================================================

describe("Agent Roles", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("supports all valid roles", () => {
    const roles: AgentRole[] = [
      "coder",
      "tester",
      "analyst",
      "reviewer",
      "architect",
      "debugger",
      "researcher",
      "scribe",
      "oracle",
      "generalist",
    ];

    for (const role of roles) {
      const agent = createTestAgent(db, {
        id: Math.floor(Math.random() * 100000),
        role,
        name: `${role}-agent`,
      });
      assertFieldEquals(db, "agents", agent.id, "role", role);
    }
  });

  it("defaults to generalist", () => {
    const result = db.run(
      `INSERT INTO agents (id, name) VALUES (?, ?)`,
      [99999, "default-role-agent"]
    );

    assertFieldEquals(db, "agents", 99999, "role", "generalist");
  });

  it("allows role reassignment", () => {
    const agent = createTestAgent(db, { role: "coder" });

    db.run(`UPDATE agents SET role = 'tester' WHERE id = ?`, [agent.id]);

    assertFieldEquals(db, "agents", agent.id, "role", "tester");
  });
});

// ============================================================================
// Agent Models Tests
// ============================================================================

describe("Agent Models", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("supports all valid models", () => {
    const models: AgentModel[] = ["haiku", "sonnet", "opus"];

    for (const model of models) {
      const agent = createTestAgent(db, {
        id: Math.floor(Math.random() * 100000),
        model,
      });
      assertFieldEquals(db, "agents", agent.id, "model", model);
    }
  });

  it("defaults to sonnet", () => {
    const result = db.run(
      `INSERT INTO agents (id, name) VALUES (?, ?)`,
      [88888, "default-model-agent"]
    );

    assertFieldEquals(db, "agents", 88888, "model", "sonnet");
  });
});

// ============================================================================
// Agent Stats Tests
// ============================================================================

describe("Agent Stats", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("increments tasks_completed on success", () => {
    const agent = createTestAgent(db, { tasks_completed: 0 });

    incrementAgentStats(db, agent.id, true);
    assertFieldEquals(db, "agents", agent.id, "tasks_completed", 1);

    incrementAgentStats(db, agent.id, true);
    assertFieldEquals(db, "agents", agent.id, "tasks_completed", 2);
  });

  it("increments tasks_failed on failure", () => {
    const agent = createTestAgent(db, { tasks_failed: 0 });

    incrementAgentStats(db, agent.id, false);
    assertFieldEquals(db, "agents", agent.id, "tasks_failed", 1);

    incrementAgentStats(db, agent.id, false);
    assertFieldEquals(db, "agents", agent.id, "tasks_failed", 2);
  });

  it("tracks total_duration_ms", () => {
    const agent = createTestAgent(db);

    incrementAgentStats(db, agent.id, true, 1000);
    incrementAgentStats(db, agent.id, true, 2500);

    const row = db.query(`SELECT total_duration_ms FROM agents WHERE id = ?`).get(agent.id) as any;
    expect(row.total_duration_ms).toBe(3500);
  });

  it("does not affect duration on failure", () => {
    const agent = createTestAgent(db);

    incrementAgentStats(db, agent.id, true, 1000);
    incrementAgentStats(db, agent.id, false, 500); // Should not add duration

    const row = db.query(`SELECT total_duration_ms, tasks_failed FROM agents WHERE id = ?`).get(agent.id) as any;
    expect(row.total_duration_ms).toBe(1000);
    expect(row.tasks_failed).toBe(1);
  });
});

// ============================================================================
// Mission Queue Schema Tests
// ============================================================================

describe("Mission Queue Schema", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("creates mission with pending status", () => {
    const mission = createTestMission(db, { prompt: "Test mission" });

    assertExists(db, "missions", mission.id!, "id");
    assertFieldEquals(db, "missions", mission.id!, "status", "pending", "id");
  });

  it("validates priority constraint (critical|high|normal|low)", () => {
    const priorities = ["critical", "high", "normal", "low"];

    for (const priority of priorities) {
      const mission = createTestMission(db, {
        id: `priority-${priority}-${randomString(4)}`,
        priority: priority as any,
      });
      assertFieldEquals(db, "missions", mission.id!, "priority", priority, "id");
    }

    // Invalid priority
    expect(() => {
      db.run(
        `INSERT INTO missions (id, prompt, priority) VALUES (?, ?, ?)`,
        ["invalid-priority", "test", "invalid"]
      );
    }).toThrow();
  });

  it("validates status constraint", () => {
    const statuses = ["pending", "queued", "running", "completed", "failed", "retrying", "blocked"];

    for (const status of statuses) {
      const mission = createTestMission(db, {
        id: `status-${status}-${randomString(4)}`,
        status: status as any,
      });
      assertFieldEquals(db, "missions", mission.id!, "status", status, "id");
    }

    // Invalid status
    expect(() => {
      db.run(
        `INSERT INTO missions (id, prompt, status) VALUES (?, ?, ?)`,
        ["invalid-status", "test", "invalid"]
      );
    }).toThrow();
  });

  it("validates type constraint (extraction|analysis|synthesis|review|general)", () => {
    const types = ["extraction", "analysis", "synthesis", "review", "general"];

    for (const type of types) {
      const mission = createTestMission(db, {
        id: `type-${type}-${randomString(4)}`,
        type: type as any,
      });
      assertFieldEquals(db, "missions", mission.id!, "type", type, "id");
    }

    // Invalid type
    expect(() => {
      db.run(
        `INSERT INTO missions (id, prompt, type) VALUES (?, ?, ?)`,
        ["invalid-type", "test", "invalid"]
      );
    }).toThrow();
  });

  it("tracks retry_count", () => {
    const mission = createTestMission(db, { retry_count: 0 });

    for (let i = 1; i <= 3; i++) {
      db.run(`UPDATE missions SET retry_count = ? WHERE id = ?`, [i, mission.id]);
      assertFieldEquals(db, "missions", mission.id!, "retry_count", i, "id");
    }
  });
});

// ============================================================================
// Mission Priority Tests
// ============================================================================

describe("Mission Priority", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("orders critical > high > normal > low", () => {
    db.run("DELETE FROM missions");

    createTestMission(db, { id: "low-1", priority: "low" });
    createTestMission(db, { id: "high-1", priority: "high" });
    createTestMission(db, { id: "critical-1", priority: "critical" });
    createTestMission(db, { id: "normal-1", priority: "normal" });

    // Priority ordering: critical=0, high=1, normal=2, low=3
    const ordered = db.query(`
      SELECT id, priority,
        CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
        END as priority_order
      FROM missions
      ORDER BY priority_order ASC
    `).all() as any[];

    expect(ordered[0].priority).toBe("critical");
    expect(ordered[1].priority).toBe("high");
    expect(ordered[2].priority).toBe("normal");
    expect(ordered[3].priority).toBe("low");
  });

  it("re-sorts on priority change", () => {
    db.run("DELETE FROM missions");

    const low = createTestMission(db, { id: "priority-change", priority: "low" });
    createTestMission(db, { id: "normal-fixed", priority: "normal" });

    // Escalate low to critical
    db.run(`UPDATE missions SET priority = 'critical' WHERE id = ?`, [low.id]);

    const ordered = db.query(`
      SELECT id, priority,
        CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
        END as priority_order
      FROM missions
      ORDER BY priority_order ASC
    `).all() as any[];

    expect(ordered[0].id).toBe("priority-change");
    expect(ordered[0].priority).toBe("critical");
  });

  it("dequeues highest priority first", () => {
    db.run("DELETE FROM missions");

    createTestMission(db, { id: "should-be-third", priority: "low", status: "queued" });
    createTestMission(db, { id: "should-be-first", priority: "critical", status: "queued" });
    createTestMission(db, { id: "should-be-second", priority: "high", status: "queued" });

    const next = db.query(`
      SELECT id FROM missions
      WHERE status = 'queued'
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
        END ASC
      LIMIT 1
    `).get() as any;

    expect(next.id).toBe("should-be-first");
  });
});

// ============================================================================
// Mission Dependencies Tests
// ============================================================================

describe("Mission Dependencies", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("blocks mission with unmet dependencies", () => {
    db.run("DELETE FROM missions");

    const dep = createTestMission(db, { id: "dependency", status: "pending" });
    const blocked = createTestMission(db, {
      id: "blocked-mission",
      status: "blocked",
      depends_on: [dep.id!],
    });

    assertFieldEquals(db, "missions", blocked.id!, "status", "blocked", "id");
  });

  it("unblocks when dependency completes", () => {
    db.run("DELETE FROM missions");

    const dep = createTestMission(db, { id: "dep-to-complete", status: "pending" });
    const blocked = createTestMission(db, {
      id: "waiting-mission",
      status: "blocked",
      depends_on: [dep.id!],
    });

    // Complete the dependency
    db.run(`UPDATE missions SET status = 'completed' WHERE id = ?`, [dep.id]);

    // Check if blocked mission can now proceed
    const depRow = db.query(`SELECT status FROM missions WHERE id = ?`).get(dep.id) as any;
    expect(depRow.status).toBe("completed");

    // In real system, a trigger would unblock - here we simulate
    db.run(`UPDATE missions SET status = 'queued' WHERE id = ?`, [blocked.id]);
    assertFieldEquals(db, "missions", blocked.id!, "status", "queued", "id");
  });

  it("handles multiple dependencies", () => {
    db.run("DELETE FROM missions");

    const dep1 = createTestMission(db, { id: "multi-dep-1", status: "pending" });
    const dep2 = createTestMission(db, { id: "multi-dep-2", status: "pending" });
    const blocked = createTestMission(db, {
      id: "multi-blocked",
      status: "blocked",
      depends_on: [dep1.id!, dep2.id!],
    });

    // Parse depends_on
    const row = db.query(`SELECT depends_on FROM missions WHERE id = ?`).get(blocked.id) as any;
    const deps = JSON.parse(row.depends_on);
    expect(deps.length).toBe(2);
    expect(deps).toContain(dep1.id);
    expect(deps).toContain(dep2.id);
  });

  it("stores dependencies as JSON array", () => {
    const mission = createTestMission(db, {
      depends_on: ["dep-1", "dep-2", "dep-3"],
    });

    const row = db.query(`SELECT depends_on FROM missions WHERE id = ?`).get(mission.id) as any;
    const deps = JSON.parse(row.depends_on);
    expect(deps).toEqual(["dep-1", "dep-2", "dep-3"]);
  });
});

// ============================================================================
// Mission Lifecycle Tests
// ============================================================================

describe("Mission Lifecycle", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("transitions pending -> queued", () => {
    const mission = createTestMission(db, { status: "pending" });

    db.run(`UPDATE missions SET status = 'queued' WHERE id = ?`, [mission.id]);

    assertFieldEquals(db, "missions", mission.id!, "status", "queued", "id");
  });

  it("transitions queued -> running on dequeue", () => {
    const agent = createTestAgent(db);
    const mission = createTestMission(db, { status: "queued" });

    db.run(
      `UPDATE missions SET status = 'running', assigned_to = ?, started_at = datetime('now') WHERE id = ?`,
      [agent.id, mission.id]
    );

    assertFieldEquals(db, "missions", mission.id!, "status", "running", "id");
    assertFieldEquals(db, "missions", mission.id!, "assigned_to", agent.id, "id");

    const row = db.query(`SELECT started_at FROM missions WHERE id = ?`).get(mission.id) as any;
    expect(row.started_at).toBeDefined();
  });

  it("transitions running -> completed", () => {
    const mission = createTestMission(db, { status: "running" });

    db.run(
      `UPDATE missions SET status = 'completed', result = ?, completed_at = datetime('now') WHERE id = ?`,
      [JSON.stringify({ output: "Success" }), mission.id]
    );

    assertFieldEquals(db, "missions", mission.id!, "status", "completed", "id");

    const row = db.query(`SELECT result, completed_at FROM missions WHERE id = ?`).get(mission.id) as any;
    expect(row.completed_at).toBeDefined();
    expect(JSON.parse(row.result).output).toBe("Success");
  });

  it("transitions running -> failed", () => {
    const mission = createTestMission(db, { status: "running" });

    db.run(
      `UPDATE missions SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?`,
      [JSON.stringify({ message: "Timeout", code: "TIMEOUT" }), mission.id]
    );

    assertFieldEquals(db, "missions", mission.id!, "status", "failed", "id");

    const row = db.query(`SELECT error FROM missions WHERE id = ?`).get(mission.id) as any;
    expect(JSON.parse(row.error).code).toBe("TIMEOUT");
  });

  it("transitions failed -> retrying", () => {
    const mission = createTestMission(db, { status: "failed", retry_count: 0 });

    db.run(
      `UPDATE missions SET status = 'retrying', retry_count = retry_count + 1 WHERE id = ?`,
      [mission.id]
    );

    assertFieldEquals(db, "missions", mission.id!, "status", "retrying", "id");
    assertFieldEquals(db, "missions", mission.id!, "retry_count", 1, "id");
  });

  it("records start/end timestamps", () => {
    const mission = createTestMission(db, { status: "pending" });

    // Start
    db.run(
      `UPDATE missions SET status = 'running', started_at = datetime('now') WHERE id = ?`,
      [mission.id]
    );

    // Complete
    db.run(
      `UPDATE missions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`,
      [mission.id]
    );

    const row = db.query(`SELECT started_at, completed_at FROM missions WHERE id = ?`).get(mission.id) as any;
    expect(row.started_at).toBeDefined();
    expect(row.completed_at).toBeDefined();
  });
});

// ============================================================================
// Load Balancing Tests
// ============================================================================

describe("Load Balancing", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("prefers idle agents", () => {
    db.run("DELETE FROM agents");

    createTestAgent(db, { id: 1, status: "busy" });
    createTestAgent(db, { id: 2, status: "idle" });
    createTestAgent(db, { id: 3, status: "busy" });

    const idleAgent = db.query(
      `SELECT id FROM agents WHERE status = 'idle' LIMIT 1`
    ).get() as any;

    expect(idleAgent.id).toBe(2);
  });

  it("prefers role specialists for task type", () => {
    db.run("DELETE FROM agents");

    createTestAgent(db, { id: 1, role: "generalist", status: "idle" });
    createTestAgent(db, { id: 2, role: "tester", status: "idle" });
    createTestAgent(db, { id: 3, role: "coder", status: "idle" });

    // For testing task, prefer tester
    const specialist = db.query(
      `SELECT id, role FROM agents
       WHERE status = 'idle' AND role = 'tester'
       LIMIT 1`
    ).get() as any;

    expect(specialist.id).toBe(2);
    expect(specialist.role).toBe("tester");
  });

  it("falls back to least busy agent", () => {
    db.run("DELETE FROM agents");

    createTestAgent(db, { id: 1, status: "busy", tasks_completed: 10 });
    createTestAgent(db, { id: 2, status: "busy", tasks_completed: 5 });
    createTestAgent(db, { id: 3, status: "busy", tasks_completed: 2 }); // Least busy

    // When no idle agents, get least busy
    const leastBusy = db.query(
      `SELECT id, tasks_completed FROM agents
       WHERE status = 'busy'
       ORDER BY tasks_completed ASC
       LIMIT 1`
    ).get() as any;

    expect(leastBusy.id).toBe(3);
    expect(leastBusy.tasks_completed).toBe(2);
  });

  it("handles empty agent pool", () => {
    db.run("DELETE FROM agents");

    const agents = db.query(`SELECT * FROM agents WHERE status = 'idle'`).all();
    expect(agents.length).toBe(0);

    // In real system, this would throw or queue the task
    const available = db.query(`SELECT id FROM agents WHERE status = 'idle' LIMIT 1`).get();
    expect(available).toBeNull();
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe("Agent Edge Cases", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("handles concurrent agent spawns", async () => {
    const results = await parallel([
      () => Promise.resolve(createTestAgent(db, { id: 10001 })),
      () => Promise.resolve(createTestAgent(db, { id: 10002 })),
      () => Promise.resolve(createTestAgent(db, { id: 10003 })),
    ]);

    const ids = results.map((a) => a.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("handles rapid task assignments", async () => {
    const agent = createTestAgent(db, { status: "idle" });

    const assignments = await parallel([
      () => Promise.resolve(db.run(`UPDATE agents SET current_task_id = ? WHERE id = ?`, [`task-1`, agent.id])),
      () => Promise.resolve(db.run(`UPDATE agents SET current_task_id = ? WHERE id = ?`, [`task-2`, agent.id])),
      () => Promise.resolve(db.run(`UPDATE agents SET current_task_id = ? WHERE id = ?`, [`task-3`, agent.id])),
    ]);

    // Should have one of the task IDs (last write wins)
    const row = db.query(`SELECT current_task_id FROM agents WHERE id = ?`).get(agent.id) as any;
    expect(["task-1", "task-2", "task-3"]).toContain(row.current_task_id);
  });

  it("handles agent status races", async () => {
    const agent = createTestAgent(db, { status: "idle" });

    await parallel([
      () => Promise.resolve(db.run(`UPDATE agents SET status = 'busy' WHERE id = ?`, [agent.id])),
      () => Promise.resolve(db.run(`UPDATE agents SET status = 'working' WHERE id = ?`, [agent.id])),
      () => Promise.resolve(db.run(`UPDATE agents SET status = 'idle' WHERE id = ?`, [agent.id])),
    ]);

    // Should have one valid status
    const row = db.query(`SELECT status FROM agents WHERE id = ?`).get(agent.id) as any;
    expect(["idle", "busy", "working"]).toContain(row.status);
  });

  it("handles very long prompt in mission", () => {
    const longPrompt = "X".repeat(50000);
    const mission = createTestMission(db, { prompt: longPrompt });

    const row = db.query(`SELECT prompt FROM missions WHERE id = ?`).get(mission.id) as any;
    expect(row.prompt.length).toBe(50000);
  });

  it("handles special characters in mission prompt", () => {
    const specialPrompt = 'Prompt with "quotes" and \'apostrophes\' and <html> & symbols';
    const mission = createTestMission(db, { prompt: specialPrompt });

    const row = db.query(`SELECT prompt FROM missions WHERE id = ?`).get(mission.id) as any;
    expect(row.prompt).toBe(specialPrompt);
  });

  it("handles unicode in agent name", () => {
    const unicodeName = "Agent-测试-🤖-émoji";
    const agent = createTestAgent(db, { name: unicodeName });

    assertFieldEquals(db, "agents", agent.id, "name", unicodeName);
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("Agent Performance", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("creates 50 agents quickly", () => {
    const start = Date.now();

    for (let i = 0; i < 50; i++) {
      createTestAgent(db, { id: 50000 + i });
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000); // Should complete in < 3 seconds
  });

  it("creates 100 missions quickly", () => {
    const start = Date.now();

    for (let i = 0; i < 100; i++) {
      createTestMission(db, { prompt: `Mission ${i}` });
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // Should complete in < 5 seconds
  });

  it("queries agents by role quickly", () => {
    // Ensure some agents exist with roles
    for (let i = 0; i < 20; i++) {
      createTestAgent(db, {
        id: 60000 + i,
        role: i % 2 === 0 ? "coder" : "tester",
      });
    }

    const start = Date.now();

    for (let i = 0; i < 100; i++) {
      db.query(`SELECT * FROM agents WHERE role = ?`).all("coder");
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000); // 100 queries in < 2 seconds
  });
});
