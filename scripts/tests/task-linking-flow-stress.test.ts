/**
 * Task Linking Flow & Stress Tests
 *
 * Flow tests: End-to-end workflow validation
 * Stress tests: Performance under load
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createTempDb,
  cleanupTempDb,
  createTestTask,
  createTestAgent,
  createTestMission,
  createTestAgentTask,
  createTestLinkedLearning,
  randomString,
} from "./test-utils";

// ============================================================================
// FLOW TESTS - Complete workflow scenarios
// ============================================================================

describe("Flow Tests", () => {
  let db: Database;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    cleanupTempDb();
  });

  describe("Complete Development Cycle", () => {
    it("should handle: requirement → planning → implementation → testing → learning → completion", () => {
      // 1. REQUIREMENT: Business need created
      const requirement = createTestTask(db, {
        title: "Add payment processing",
        domain: "project",
        status: "open",
        priority: "high",
      });

      // 2. PLANNING: Orchestrator creates mission
      const mission = createTestMission(db, {
        prompt: "Implement Stripe payment integration",
        type: "synthesis",
        priority: "high",
        unified_task_id: requirement.id,
      });

      // Update status
      db.run(`UPDATE unified_tasks SET status = 'in_progress' WHERE id = ?`, [requirement.id]);

      // 3. IMPLEMENTATION: Multiple agents work
      const coder = createTestAgent(db, { role: "coder" });
      const tester = createTestAgent(db, { role: "tester" });
      const reviewer = createTestAgent(db, { role: "reviewer" });

      // Coder implements
      const implTask = createTestAgentTask(db, {
        agent_id: coder.id,
        prompt: "Write Stripe integration code",
        unified_task_id: requirement.id,
        parent_mission_id: mission.id,
        status: "completed",
        tokens_used: 3000,
        duration_ms: 60000,
      });

      // Tester tests
      const testTask = createTestAgentTask(db, {
        agent_id: tester.id,
        prompt: "Write payment tests",
        unified_task_id: requirement.id,
        parent_mission_id: mission.id,
        status: "completed",
        tokens_used: 1500,
        duration_ms: 30000,
      });

      // Reviewer reviews
      const reviewTask = createTestAgentTask(db, {
        agent_id: reviewer.id,
        prompt: "Review payment code",
        unified_task_id: requirement.id,
        parent_mission_id: mission.id,
        status: "completed",
        tokens_used: 1000,
        duration_ms: 20000,
      });

      // 4. LEARNING: Extract insights
      createTestLinkedLearning(db, {
        category: "architecture",
        title: "Stripe webhook verification",
        description: "Always verify webhook signatures before processing",
        source_task_id: implTask.id,
        source_mission_id: mission.id,
        source_unified_task_id: requirement.id,
      });

      createTestLinkedLearning(db, {
        category: "testing",
        title: "Payment test isolation",
        description: "Use Stripe test mode with separate API keys",
        source_task_id: testTask.id,
        source_mission_id: mission.id,
        source_unified_task_id: requirement.id,
      });

      // 5. COMPLETION: Mark mission and requirement done
      db.run(`UPDATE missions SET status = 'completed' WHERE id = ?`, [mission.id]);

      // Check all tasks complete
      const pending = db.query(`
        SELECT COUNT(*) as count FROM agent_tasks
        WHERE unified_task_id = ? AND status NOT IN ('completed', 'cancelled', 'failed')
      `).get(requirement.id) as any;

      if (pending.count === 0) {
        db.run(`UPDATE unified_tasks SET status = 'done' WHERE id = ?`, [requirement.id]);
      }

      // VERIFY: Full traceability
      const stats = db.query(`
        SELECT
          COUNT(DISTINCT at.id) as task_count,
          COUNT(DISTINCT at.agent_id) as agent_count,
          SUM(at.tokens_used) as total_tokens,
          SUM(at.duration_ms) as total_duration
        FROM agent_tasks at
        WHERE at.unified_task_id = ?
      `).get(requirement.id) as any;

      expect(stats.task_count).toBe(3);
      expect(stats.agent_count).toBe(3);
      expect(stats.total_tokens).toBe(5500);
      expect(stats.total_duration).toBe(110000);

      const learnings = db.query(`SELECT * FROM learnings WHERE source_unified_task_id = ?`).all(requirement.id) as any[];
      expect(learnings.length).toBe(2);

      const unified = db.query(`SELECT status FROM unified_tasks WHERE id = ?`).get(requirement.id) as any;
      expect(unified.status).toBe("done");
    });

    it("should handle: failure → retry → learning → eventual success", () => {
      const requirement = createTestTask(db, {
        title: "Fix production bug",
        domain: "system",
        status: "in_progress",
        priority: "critical",
      });

      const mission = createTestMission(db, {
        prompt: "Debug and fix memory leak",
        type: "analysis",
        unified_task_id: requirement.id,
      });

      const debuggerAgent = createTestAgent(db, { role: "debugger" });

      // First attempt fails
      const attempt1 = createTestAgentTask(db, {
        agent_id: debuggerAgent.id,
        prompt: "Analyze memory leak",
        unified_task_id: requirement.id,
        parent_mission_id: mission.id,
        status: "failed",
        error: "Could not reproduce issue",
      });

      // Extract learning from failure
      createTestLinkedLearning(db, {
        category: "debugging",
        title: "Memory leak reproduction",
        description: "Need to enable heap profiling in test environment",
        source_task_id: attempt1.id,
        source_mission_id: mission.id,
        source_unified_task_id: requirement.id,
      });

      // Second attempt succeeds
      const attempt2 = createTestAgentTask(db, {
        agent_id: debuggerAgent.id,
        prompt: "Analyze memory leak with heap profiling",
        unified_task_id: requirement.id,
        parent_mission_id: mission.id,
        status: "completed",
        result: "Found circular reference in event handlers",
        tokens_used: 2000,
        duration_ms: 45000,
      });

      // Extract success learning
      createTestLinkedLearning(db, {
        category: "debugging",
        title: "Circular reference detection",
        description: "Event handlers must be properly unregistered to avoid circular refs",
        confidence: "high",
        source_task_id: attempt2.id,
        source_mission_id: mission.id,
        source_unified_task_id: requirement.id,
      });

      // VERIFY: Both attempts tracked
      const attempts = db.query(`
        SELECT * FROM agent_tasks WHERE unified_task_id = ? ORDER BY created_at
      `).all(requirement.id) as any[];

      expect(attempts.length).toBe(2);
      expect(attempts[0].status).toBe("failed");
      expect(attempts[1].status).toBe("completed");

      // VERIFY: Learnings from both attempts
      const learnings = db.query(`SELECT * FROM learnings WHERE source_unified_task_id = ?`).all(requirement.id) as any[];
      expect(learnings.length).toBe(2);
    });

    it("should handle: multi-domain task with cross-cutting learnings", () => {
      // System task
      const systemTask = createTestTask(db, {
        title: "Upgrade database schema",
        domain: "system",
        status: "in_progress",
      });

      // Project task (depends on system)
      const projectTask = createTestTask(db, {
        title: "Update API for new schema",
        domain: "project",
        status: "blocked",
      });

      // Session task (depends on project)
      const sessionTask = createTestTask(db, {
        title: "Test API changes locally",
        domain: "session",
        status: "open",
      });

      // Work on system task
      const schemaMission = createTestMission(db, {
        prompt: "Run database migration",
        unified_task_id: systemTask.id,
      });

      createTestAgentTask(db, {
        prompt: "Execute migration scripts",
        unified_task_id: systemTask.id,
        parent_mission_id: schemaMission.id,
        status: "completed",
      });

      // Cross-cutting learning
      createTestLinkedLearning(db, {
        category: "architecture",
        title: "Zero-downtime migrations",
        description: "Use expand-contract pattern for schema changes",
        source_unified_task_id: systemTask.id,
      });

      // Unblock and work on project task
      db.run(`UPDATE unified_tasks SET status = 'done' WHERE id = ?`, [systemTask.id]);
      db.run(`UPDATE unified_tasks SET status = 'in_progress' WHERE id = ?`, [projectTask.id]);

      const apiMission = createTestMission(db, {
        prompt: "Update API endpoints",
        unified_task_id: projectTask.id,
      });

      createTestAgentTask(db, {
        prompt: "Refactor endpoints for new schema",
        unified_task_id: projectTask.id,
        parent_mission_id: apiMission.id,
        status: "completed",
      });

      // VERIFY: Can query across domains
      const byDomain = db.query(`
        SELECT ut.domain, COUNT(at.id) as task_count
        FROM unified_tasks ut
        LEFT JOIN agent_tasks at ON ut.id = at.unified_task_id
        WHERE ut.id IN (?, ?, ?)
        GROUP BY ut.domain
      `).all(systemTask.id, projectTask.id, sessionTask.id) as any[];

      const domainMap = Object.fromEntries(byDomain.map((r) => [r.domain, r.task_count]));
      expect(domainMap.system).toBe(1);
      expect(domainMap.project).toBe(1);
    });
  });
});

// ============================================================================
// STRESS TESTS - Performance under load
// ============================================================================

describe("Stress Tests", () => {
  let db: Database;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    cleanupTempDb();
  });

  describe("High Volume", () => {
    it("should handle 1000 tasks linked to single unified_task", () => {
      const unifiedTask = createTestTask(db, {
        title: "High volume parent",
        domain: "project",
      });

      const startInsert = performance.now();

      // Insert 1000 tasks
      const insertStmt = db.prepare(`
        INSERT INTO agent_tasks (id, agent_id, prompt, status, unified_task_id, tokens_used, duration_ms)
        VALUES (?, ?, ?, 'completed', ?, ?, ?)
      `);

      db.transaction(() => {
        for (let i = 0; i < 1000; i++) {
          insertStmt.run(
            `task_${randomString(8)}_${i}`,
            (i % 5) + 1,
            `Task ${i}`,
            unifiedTask.id,
            Math.floor(Math.random() * 1000),
            Math.floor(Math.random() * 10000)
          );
        }
      })();

      const insertDuration = performance.now() - startInsert;
      console.log(`  Insert 1000 tasks: ${insertDuration.toFixed(2)}ms`);
      expect(insertDuration).toBeLessThan(1000); // Should be < 1s

      // Query performance
      const startQuery = performance.now();
      const tasks = db.query(`SELECT * FROM agent_tasks WHERE unified_task_id = ?`).all(unifiedTask.id) as any[];
      const queryDuration = performance.now() - startQuery;

      console.log(`  Query 1000 tasks: ${queryDuration.toFixed(2)}ms`);
      expect(tasks.length).toBe(1000);
      expect(queryDuration).toBeLessThan(100); // Should be < 100ms with index

      // Stats aggregation performance
      const startStats = performance.now();
      const stats = db.query(`
        SELECT
          COUNT(*) as count,
          SUM(tokens_used) as total_tokens,
          AVG(duration_ms) as avg_duration
        FROM agent_tasks
        WHERE unified_task_id = ?
      `).get(unifiedTask.id) as any;
      const statsDuration = performance.now() - startStats;

      console.log(`  Aggregate stats: ${statsDuration.toFixed(2)}ms`);
      expect(stats.count).toBe(1000);
      expect(statsDuration).toBeLessThan(50);
    });

    it("should handle 100 unified_tasks with 10 tasks each", () => {
      const startInsert = performance.now();

      const unifiedIds: number[] = [];

      db.transaction(() => {
        for (let u = 0; u < 100; u++) {
          const result = db.run(
            `INSERT INTO unified_tasks (title, domain, status) VALUES (?, ?, ?)`,
            [`Unified ${u}`, "project", "in_progress"]
          );
          const unifiedId = Number(result.lastInsertRowid);
          unifiedIds.push(unifiedId);

          for (let t = 0; t < 10; t++) {
            db.run(
              `INSERT INTO agent_tasks (id, agent_id, prompt, status, unified_task_id)
               VALUES (?, ?, ?, 'completed', ?)`,
              [`task_${u}_${t}_${randomString(4)}`, 1, `Task ${u}-${t}`, unifiedId]
            );
          }
        }
      })();

      const insertDuration = performance.now() - startInsert;
      console.log(`  Insert 100 unified + 1000 tasks: ${insertDuration.toFixed(2)}ms`);
      expect(insertDuration).toBeLessThan(2000);

      // Query across all unified tasks
      const startQuery = performance.now();
      const summary = db.query(`
        SELECT ut.id, ut.title, COUNT(at.id) as task_count
        FROM unified_tasks ut
        LEFT JOIN agent_tasks at ON ut.id = at.unified_task_id
        GROUP BY ut.id
        HAVING task_count > 0
      `).all() as any[];
      const queryDuration = performance.now() - startQuery;

      console.log(`  Summary query: ${queryDuration.toFixed(2)}ms`);
      expect(summary.length).toBe(100);
      expect(queryDuration).toBeLessThan(200);
    });

    it("should handle 500 learnings with source links", () => {
      const unifiedTask = createTestTask(db, { title: "Learning stress", domain: "project" });
      const mission = createTestMission(db, { unified_task_id: unifiedTask.id });
      const agentTask = createTestAgentTask(db, {
        unified_task_id: unifiedTask.id,
        parent_mission_id: mission.id,
      });

      const startInsert = performance.now();

      const stmt = db.prepare(`
        INSERT INTO learnings (category, title, description, confidence, source_task_id, source_mission_id, source_unified_task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const categories = ["debugging", "architecture", "testing", "performance", "security"];

      db.transaction(() => {
        for (let i = 0; i < 500; i++) {
          stmt.run(
            categories[i % categories.length],
            `Learning ${i}`,
            `Description for learning ${i}`,
            "medium",
            agentTask.id,
            mission.id,
            unifiedTask.id
          );
        }
      })();

      const insertDuration = performance.now() - startInsert;
      console.log(`  Insert 500 learnings: ${insertDuration.toFixed(2)}ms`);
      expect(insertDuration).toBeLessThan(1000);

      // Query by various source types
      const startQuery1 = performance.now();
      const byTask = db.query(`SELECT * FROM learnings WHERE source_task_id = ?`).all(agentTask.id) as any[];
      const q1Duration = performance.now() - startQuery1;
      console.log(`  Query by task: ${q1Duration.toFixed(2)}ms (${byTask.length} results)`);
      expect(byTask.length).toBe(500);

      const startQuery2 = performance.now();
      const byMission = db.query(`SELECT * FROM learnings WHERE source_mission_id = ?`).all(mission.id) as any[];
      const q2Duration = performance.now() - startQuery2;
      console.log(`  Query by mission: ${q2Duration.toFixed(2)}ms`);
      expect(byMission.length).toBe(500);

      const startQuery3 = performance.now();
      const byUnified = db.query(`SELECT * FROM learnings WHERE source_unified_task_id = ?`).all(unifiedTask.id) as any[];
      const q3Duration = performance.now() - startQuery3;
      console.log(`  Query by unified: ${q3Duration.toFixed(2)}ms`);
      expect(byUnified.length).toBe(500);

      expect(q1Duration).toBeLessThan(50);
      expect(q2Duration).toBeLessThan(50);
      expect(q3Duration).toBeLessThan(50);
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle rapid sequential inserts", () => {
      const unifiedTask = createTestTask(db, { title: "Rapid inserts", domain: "project" });

      const start = performance.now();
      const taskIds: string[] = [];

      // Rapid fire inserts (simulating concurrent agents)
      for (let i = 0; i < 100; i++) {
        const taskId = `rapid_${randomString(8)}_${i}`;
        taskIds.push(taskId);

        db.run(
          `INSERT INTO agent_tasks (id, agent_id, prompt, status, unified_task_id)
           VALUES (?, ?, ?, 'pending', ?)`,
          [taskId, (i % 5) + 1, `Rapid task ${i}`, unifiedTask.id]
        );
      }

      const duration = performance.now() - start;
      console.log(`  100 rapid inserts: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(500);

      // Verify all inserted
      const count = db.query(`SELECT COUNT(*) as c FROM agent_tasks WHERE unified_task_id = ?`).get(unifiedTask.id) as any;
      expect(count.c).toBe(100);
    });

    it("should handle rapid status updates", () => {
      const unifiedTask = createTestTask(db, { title: "Rapid updates", domain: "project" });

      // Create tasks
      const taskIds: string[] = [];
      for (let i = 0; i < 50; i++) {
        const taskId = `update_${randomString(8)}_${i}`;
        taskIds.push(taskId);
        db.run(
          `INSERT INTO agent_tasks (id, agent_id, prompt, status, unified_task_id)
           VALUES (?, 1, ?, 'pending', ?)`,
          [taskId, `Task ${i}`, unifiedTask.id]
        );
      }

      // Rapid status updates
      const start = performance.now();

      for (const taskId of taskIds) {
        db.run(`UPDATE agent_tasks SET status = 'running' WHERE id = ?`, [taskId]);
        db.run(`UPDATE agent_tasks SET status = 'completed', result = 'Done' WHERE id = ?`, [taskId]);
      }

      const duration = performance.now() - start;
      console.log(`  100 status updates (50 tasks × 2): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(500);

      // Verify all completed
      const completed = db.query(`
        SELECT COUNT(*) as c FROM agent_tasks
        WHERE unified_task_id = ? AND status = 'completed'
      `).get(unifiedTask.id) as any;
      expect(completed.c).toBe(50);
    });
  });

  describe("Complex Queries", () => {
    it("should handle multi-table joins efficiently", () => {
      // Setup: 10 unified tasks, each with 5 missions, each with 10 tasks, each with 2 learnings
      const setup = () => {
        for (let u = 0; u < 10; u++) {
          const utResult = db.run(
            `INSERT INTO unified_tasks (title, domain, status) VALUES (?, ?, ?)`,
            [`Unified ${u}`, "project", "in_progress"]
          );
          const unifiedId = Number(utResult.lastInsertRowid);

          for (let m = 0; m < 5; m++) {
            const missionId = `mission_${u}_${m}_${randomString(4)}`;
            db.run(
              `INSERT INTO missions (id, prompt, status, unified_task_id) VALUES (?, ?, ?, ?)`,
              [missionId, `Mission ${u}-${m}`, "completed", unifiedId]
            );

            for (let t = 0; t < 10; t++) {
              const taskId = `task_${u}_${m}_${t}_${randomString(4)}`;
              db.run(
                `INSERT INTO agent_tasks (id, agent_id, prompt, status, unified_task_id, parent_mission_id, tokens_used)
                 VALUES (?, 1, ?, 'completed', ?, ?, ?)`,
                [taskId, `Task ${u}-${m}-${t}`, unifiedId, missionId, 100]
              );

              for (let l = 0; l < 2; l++) {
                db.run(
                  `INSERT INTO learnings (category, title, source_task_id, source_mission_id, source_unified_task_id)
                   VALUES (?, ?, ?, ?, ?)`,
                  ["testing", `Learning ${u}-${m}-${t}-${l}`, taskId, missionId, unifiedId]
                );
              }
            }
          }
        }
      };

      const startSetup = performance.now();
      db.transaction(setup)();
      const setupDuration = performance.now() - startSetup;
      console.log(`  Setup (10×5×10×2 = 1000 learnings): ${setupDuration.toFixed(2)}ms`);

      // Complex query: Get unified task with aggregated stats
      const startQuery = performance.now();
      const results = db.query(`
        SELECT
          ut.id,
          ut.title,
          (SELECT COUNT(*) FROM missions WHERE unified_task_id = ut.id) as mission_count,
          (SELECT COUNT(*) FROM agent_tasks WHERE unified_task_id = ut.id) as task_count,
          (SELECT SUM(tokens_used) FROM agent_tasks WHERE unified_task_id = ut.id) as total_tokens,
          (SELECT COUNT(*) FROM learnings WHERE source_unified_task_id = ut.id) as learning_count
        FROM unified_tasks ut
      `).all() as any[];
      const queryDuration = performance.now() - startQuery;

      console.log(`  Complex aggregation query: ${queryDuration.toFixed(2)}ms`);
      expect(results.length).toBe(10);
      expect(results[0].mission_count).toBe(5);
      expect(results[0].task_count).toBe(50);
      expect(results[0].learning_count).toBe(100);
      expect(queryDuration).toBeLessThan(500);
    });
  });
});
