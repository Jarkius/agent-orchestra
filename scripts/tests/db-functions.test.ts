/**
 * db.ts Function Tests
 *
 * Tests the actual exported functions from db.ts to verify
 * the task linking implementation works in practice.
 *
 * Uses the real database module (not temp DB) to test real behavior.
 */

import { describe, it, expect, afterEach } from "bun:test";
import {
  db,
  createTask,
  completeTask,
  getTask,
  linkTaskToUnified,
  linkTaskToMission,
  getLinkedTasks,
  getTaskLineage,
  getLearningsByTask,
  getLearningsByMission,
  getSiblingTasks,
  updateUnifiedTaskStatus,
  createLearning,
} from "../../src/db";
import { randomString } from "./test-utils";

// Test prefix to identify test data for cleanup
const TEST_PREFIX = `test_db_${Date.now()}_`;

// Cleanup function
function cleanupTestData() {
  db.run(`DELETE FROM agent_tasks WHERE id LIKE '${TEST_PREFIX}%'`);
  db.run(`DELETE FROM unified_tasks WHERE title LIKE '${TEST_PREFIX}%'`);
  db.run(`DELETE FROM learnings WHERE title LIKE '${TEST_PREFIX}%'`);
  db.run(`DELETE FROM missions WHERE id LIKE '${TEST_PREFIX}%'`);
}

describe("db.ts Task Linking Functions", () => {
  afterEach(() => {
    cleanupTestData();
  });

  describe("createTask with linking options", () => {
    it("should create task with unified_task_id", () => {
      // Create unified task directly
      const result = db.run(
        `INSERT INTO unified_tasks (title, domain, status) VALUES (?, ?, ?)`,
        [`${TEST_PREFIX}Parent task`, "project", "open"]
      );
      const unifiedTaskId = Number(result.lastInsertRowid);

      // Create agent task with link
      const taskId = `${TEST_PREFIX}${randomString(8)}`;
      createTask(taskId, 1, "Test prompt", undefined, "normal", {
        unified_task_id: unifiedTaskId,
      });

      // Verify link
      const task = getTask(taskId);
      expect(task).toBeTruthy();
      expect(task.unified_task_id).toBe(unifiedTaskId);
    });

    it("should create task with session_id", () => {
      // Create session
      const sessionId = `${TEST_PREFIX}session_${randomString(6)}`;
      db.run(
        `INSERT INTO sessions (id, summary) VALUES (?, ?)`,
        [sessionId, "Test session"]
      );

      const taskId = `${TEST_PREFIX}${randomString(8)}`;
      createTask(taskId, 1, "Test prompt", undefined, "normal", {
        session_id: sessionId,
      });

      const task = getTask(taskId);
      expect(task).toBeTruthy();
      expect(task.session_id).toBe(sessionId);
    });

    it("should create task with all linking options", () => {
      // Create unified task
      const utResult = db.run(
        `INSERT INTO unified_tasks (title, domain, status) VALUES (?, ?, ?)`,
        [`${TEST_PREFIX}Full link test`, "project", "open"]
      );
      const unifiedTaskId = Number(utResult.lastInsertRowid);

      // Create session
      const sessionId = `${TEST_PREFIX}session_${randomString(6)}`;
      db.run(
        `INSERT INTO sessions (id, summary) VALUES (?, ?)`,
        [sessionId, "Test session"]
      );

      const taskId = `${TEST_PREFIX}${randomString(8)}`;
      createTask(taskId, 1, "Test prompt", "context", "high", {
        unified_task_id: unifiedTaskId,
        session_id: sessionId,
      });

      const task = getTask(taskId);
      expect(task.unified_task_id).toBe(unifiedTaskId);
      expect(task.session_id).toBe(sessionId);
      expect(task.priority).toBe("high");
    });
  });

  describe("linkTaskToUnified", () => {
    it("should link existing task to unified_task", () => {
      // Create task without link
      const taskId = `${TEST_PREFIX}${randomString(8)}`;
      createTask(taskId, 1, "Orphan task");

      // Create unified task
      const result = db.run(
        `INSERT INTO unified_tasks (title, domain) VALUES (?, ?)`,
        [`${TEST_PREFIX}Link target`, "project"]
      );
      const unifiedTaskId = Number(result.lastInsertRowid);

      // Verify no link initially
      let task = getTask(taskId);
      expect(task.unified_task_id).toBeNull();

      // Link
      linkTaskToUnified(taskId, unifiedTaskId);

      // Verify link
      task = getTask(taskId);
      expect(task.unified_task_id).toBe(unifiedTaskId);
    });
  });

  describe("linkTaskToMission", () => {
    it("should link task to mission", () => {
      // Create task
      const taskId = `${TEST_PREFIX}${randomString(8)}`;
      createTask(taskId, 1, "Task for mission");

      // Create mission
      const missionId = `${TEST_PREFIX}mission_${randomString(6)}`;
      db.run(
        `INSERT INTO missions (id, prompt, status) VALUES (?, ?, ?)`,
        [missionId, "Test mission", "pending"]
      );

      // Verify no link initially
      let task = getTask(taskId);
      expect(task.parent_mission_id).toBeNull();

      // Link
      linkTaskToMission(taskId, missionId);

      // Verify link
      task = getTask(taskId);
      expect(task.parent_mission_id).toBe(missionId);
    });
  });

  describe("getLinkedTasks", () => {
    it("should return all tasks for unified_task", () => {
      // Create unified task
      const result = db.run(
        `INSERT INTO unified_tasks (title, domain) VALUES (?, ?)`,
        [`${TEST_PREFIX}Multi-task parent`, "project"]
      );
      const unifiedTaskId = Number(result.lastInsertRowid);

      // Create multiple linked tasks
      for (let i = 0; i < 5; i++) {
        const taskId = `${TEST_PREFIX}task_${i}_${randomString(4)}`;
        createTask(taskId, 1, `Task ${i}`, undefined, "normal", {
          unified_task_id: unifiedTaskId,
        });
      }

      // Query
      const tasks = getLinkedTasks(unifiedTaskId);
      expect(tasks.length).toBe(5);
    });

    it("should return empty array for non-existent unified_task", () => {
      const tasks = getLinkedTasks(999999);
      expect(tasks).toEqual([]);
    });
  });

  describe("getTaskLineage", () => {
    it("should return complete lineage", () => {
      // Create unified task
      const utResult = db.run(
        `INSERT INTO unified_tasks (title, domain, status) VALUES (?, ?, ?)`,
        [`${TEST_PREFIX}Lineage test`, "project", "in_progress"]
      );
      const unifiedTaskId = Number(utResult.lastInsertRowid);

      // Create tasks
      for (let i = 0; i < 3; i++) {
        const taskId = `${TEST_PREFIX}lineage_task_${i}_${randomString(4)}`;
        createTask(taskId, 1, `Lineage task ${i}`, undefined, "normal", {
          unified_task_id: unifiedTaskId,
        });
        // Mark as completed with some metrics
        completeTask(taskId, "Result", 1000 + i * 100, 500, 200);
      }

      // Create learnings
      for (let i = 0; i < 2; i++) {
        createLearning({
          category: "testing",
          title: `${TEST_PREFIX}Learning ${i}`,
          description: "Test learning",
          confidence: "low",
          source_unified_task_id: unifiedTaskId,
        });
      }

      // Get lineage
      const lineage = getTaskLineage(unifiedTaskId);

      expect(lineage.unified_task).toBeTruthy();
      expect(lineage.unified_task.title).toBe(`${TEST_PREFIX}Lineage test`);
      expect(lineage.agent_tasks.length).toBe(3);
      expect(lineage.learnings.length).toBe(2);
      expect(lineage.stats.task_count).toBe(3);
      expect(lineage.stats.total_duration_ms).toBe(3300); // 1000+1100+1200
    });
  });

  describe("getSiblingTasks", () => {
    it("should return other tasks with same unified_task", () => {
      // Create unified task
      const utResult = db.run(
        `INSERT INTO unified_tasks (title, domain) VALUES (?, ?)`,
        [`${TEST_PREFIX}Siblings`, "project"]
      );
      const unifiedTaskId = Number(utResult.lastInsertRowid);

      // Create 3 sibling tasks
      const taskIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const taskId = `${TEST_PREFIX}sibling_${i}_${randomString(4)}`;
        taskIds.push(taskId);
        createTask(taskId, 1, `Sibling ${i}`, undefined, "normal", {
          unified_task_id: unifiedTaskId,
        });
      }

      // Get siblings of first task
      const siblings = getSiblingTasks(taskIds[0]!);
      expect(siblings.length).toBe(2); // Excludes self
      expect(siblings.some((s: any) => s.id === taskIds[1])).toBe(true);
      expect(siblings.some((s: any) => s.id === taskIds[2])).toBe(true);
      expect(siblings.some((s: any) => s.id === taskIds[0])).toBe(false);
    });

    it("should return empty for task without unified_task", () => {
      const taskId = `${TEST_PREFIX}orphan_${randomString(6)}`;
      createTask(taskId, 1, "Orphan task");

      const siblings = getSiblingTasks(taskId);
      expect(siblings).toEqual([]);
    });
  });

  describe("updateUnifiedTaskStatus", () => {
    it("should update status correctly", () => {
      const result = db.run(
        `INSERT INTO unified_tasks (title, domain, status) VALUES (?, ?, ?)`,
        [`${TEST_PREFIX}Status test`, "project", "open"]
      );
      const unifiedTaskId = Number(result.lastInsertRowid);

      // Verify initial status
      let unified = db.query(`SELECT status FROM unified_tasks WHERE id = ?`).get(unifiedTaskId) as any;
      expect(unified.status).toBe("open");

      // Update to in_progress
      updateUnifiedTaskStatus(unifiedTaskId, "in_progress");
      unified = db.query(`SELECT status FROM unified_tasks WHERE id = ?`).get(unifiedTaskId) as any;
      expect(unified.status).toBe("in_progress");

      // Update to done
      updateUnifiedTaskStatus(unifiedTaskId, "done");
      unified = db.query(`SELECT status FROM unified_tasks WHERE id = ?`).get(unifiedTaskId) as any;
      expect(unified.status).toBe("done");
    });
  });

  describe("completeTask with unified_task sync", () => {
    it("should sync unified_task to done when all tasks complete", () => {
      // Create unified task
      const utResult = db.run(
        `INSERT INTO unified_tasks (title, domain, status) VALUES (?, ?, ?)`,
        [`${TEST_PREFIX}Completion sync`, "project", "in_progress"]
      );
      const unifiedTaskId = Number(utResult.lastInsertRowid);

      // Create two tasks
      const task1 = `${TEST_PREFIX}complete_1_${randomString(4)}`;
      const task2 = `${TEST_PREFIX}complete_2_${randomString(4)}`;

      createTask(task1, 1, "Task 1", undefined, "normal", { unified_task_id: unifiedTaskId });
      createTask(task2, 1, "Task 2", undefined, "normal", { unified_task_id: unifiedTaskId });

      // Complete task 1
      completeTask(task1, "Done 1", 1000, 100, 50);

      // Unified should still be in_progress
      let unified = db.query(`SELECT status FROM unified_tasks WHERE id = ?`).get(unifiedTaskId) as any;
      expect(unified.status).toBe("in_progress");

      // Complete task 2
      completeTask(task2, "Done 2", 1000, 100, 50);

      // Unified should now be done
      unified = db.query(`SELECT status FROM unified_tasks WHERE id = ?`).get(unifiedTaskId) as any;
      expect(unified.status).toBe("done");
    });
  });

  describe("createLearning with source links", () => {
    it("should store all source links", () => {
      // Create unified task
      const utResult = db.run(
        `INSERT INTO unified_tasks (title, domain) VALUES (?, ?)`,
        [`${TEST_PREFIX}Learning source`, "project"]
      );
      const unifiedTaskId = Number(utResult.lastInsertRowid);

      // Create mission
      const missionId = `${TEST_PREFIX}mission_${randomString(6)}`;
      db.run(
        `INSERT INTO missions (id, prompt, status, unified_task_id) VALUES (?, ?, ?, ?)`,
        [missionId, "Test mission", "completed", unifiedTaskId]
      );

      // Create task
      const taskId = `${TEST_PREFIX}task_${randomString(6)}`;
      createTask(taskId, 1, "Work", undefined, "normal", {
        unified_task_id: unifiedTaskId,
      });
      linkTaskToMission(taskId, missionId);

      // Create learning with all links
      const learningId = createLearning({
        category: "testing",
        title: `${TEST_PREFIX}Linked learning`,
        description: "Test",
        confidence: "medium",
        source_task_id: taskId,
        source_mission_id: missionId,
        source_unified_task_id: unifiedTaskId,
      });

      // Verify
      const learning = db.query(`SELECT * FROM learnings WHERE id = ?`).get(learningId) as any;
      expect(learning.source_task_id).toBe(taskId);
      expect(learning.source_mission_id).toBe(missionId);
      expect(learning.source_unified_task_id).toBe(unifiedTaskId);
    });
  });

  describe("getLearningsByTask and getLearningsByMission", () => {
    it("should query learnings by task", () => {
      const taskId = `${TEST_PREFIX}task_${randomString(6)}`;
      createTask(taskId, 1, "Source task");

      // Create 3 learnings from this task
      for (let i = 0; i < 3; i++) {
        createLearning({
          category: "testing",
          title: `${TEST_PREFIX}Task learning ${i}`,
          source_task_id: taskId,
        });
      }

      const learnings = getLearningsByTask(taskId);
      expect(learnings.length).toBe(3);
    });

    it("should query learnings by mission", () => {
      const missionId = `${TEST_PREFIX}mission_${randomString(6)}`;
      db.run(
        `INSERT INTO missions (id, prompt, status) VALUES (?, ?, ?)`,
        [missionId, "Source mission", "completed"]
      );

      // Create 2 learnings from this mission
      for (let i = 0; i < 2; i++) {
        createLearning({
          category: "testing",
          title: `${TEST_PREFIX}Mission learning ${i}`,
          source_mission_id: missionId,
        });
      }

      const learnings = getLearningsByMission(missionId);
      expect(learnings.length).toBe(2);
    });
  });
});
