/**
 * Memory System Tests
 *
 * Tests for sessions, learnings, recall, and data integrity
 * Uses bun:test with isolated temp database
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createTempDb,
  cleanupTempDb,
  getTempDb,
  createTestSession,
  createTestLearning,
  createTestTask,
  assertExists,
  assertNotExists,
  assertRowCount,
  assertFieldEquals,
  randomString,
  parallel,
  sleep,
} from "./test-utils";

// ============================================================================
// Sessions Tests
// ============================================================================

describe("Sessions", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("creates session with summary", () => {
    const session = createTestSession(db, {
      summary: "Test session summary",
      tags: "test,memory",
    });

    assertExists(db, "sessions", session.id);
    assertFieldEquals(db, "sessions", session.id, "summary", "Test session summary");
  });

  it("creates session with unique ID", () => {
    const session1 = createTestSession(db);
    const session2 = createTestSession(db);

    expect(session1.id).not.toBe(session2.id);
  });

  it("retrieves session by ID", () => {
    const session = createTestSession(db, { summary: "Retrieve test" });

    const row = db.query("SELECT * FROM sessions WHERE id = ?").get(session.id) as any;

    expect(row).toBeDefined();
    expect(row.summary).toBe("Retrieve test");
  });

  it("updates session summary", () => {
    const session = createTestSession(db, { summary: "Original" });

    db.run("UPDATE sessions SET summary = ? WHERE id = ?", ["Updated", session.id]);

    assertFieldEquals(db, "sessions", session.id, "summary", "Updated");
  });

  it("handles empty summary", () => {
    const session = createTestSession(db, { summary: "" });

    assertExists(db, "sessions", session.id);
    assertFieldEquals(db, "sessions", session.id, "summary", "");
  });

  it("handles unicode in summary", () => {
    const unicodeSummary = "Test with emoji 🚀 and accénts naïve";
    const session = createTestSession(db, { summary: unicodeSummary });

    assertFieldEquals(db, "sessions", session.id, "summary", unicodeSummary);
  });

  it("handles very long summary", () => {
    const longSummary = "A".repeat(10000);
    const session = createTestSession(db, { summary: longSummary });

    const row = db.query("SELECT summary FROM sessions WHERE id = ?").get(session.id) as any;
    expect(row.summary.length).toBe(10000);
  });

  it("creates multiple sessions concurrently", async () => {
    const results = await parallel([
      () => Promise.resolve(createTestSession(db, { summary: "Concurrent 1" })),
      () => Promise.resolve(createTestSession(db, { summary: "Concurrent 2" })),
      () => Promise.resolve(createTestSession(db, { summary: "Concurrent 3" })),
    ]);

    expect(results.length).toBe(3);
    const ids = new Set(results.map((s) => s.id));
    expect(ids.size).toBe(3); // All unique
  });
});

// ============================================================================
// Learnings Tests
// ============================================================================

describe("Learnings", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("creates learning with all fields", () => {
    const learning = createTestLearning(db, {
      category: "architecture",
      title: "Test learning",
      description: "Test description",
      confidence: "high",
    });

    expect(learning.id).toBeGreaterThan(0);
    assertFieldEquals(db, "learnings", learning.id!, "category", "architecture");
    assertFieldEquals(db, "learnings", learning.id!, "confidence", "high");
  });

  it("creates learning with all valid categories", () => {
    const categories = [
      "performance",
      "architecture",
      "tooling",
      "process",
      "debugging",
      "security",
      "testing",
      "philosophy",
      "principle",
      "insight",
      "pattern",
      "retrospective",
    ];

    for (const category of categories) {
      const learning = createTestLearning(db, { category, title: `${category} test` });
      assertFieldEquals(db, "learnings", learning.id!, "category", category);
    }
  });

  it("creates learning with all confidence levels", () => {
    const levels = ["low", "medium", "high", "proven"];

    for (const confidence of levels) {
      const learning = createTestLearning(db, {
        title: `${confidence} confidence`,
        confidence,
      });
      assertFieldEquals(db, "learnings", learning.id!, "confidence", confidence);
    }
  });

  it("auto-increments learning ID", () => {
    const l1 = createTestLearning(db, { title: "First" });
    const l2 = createTestLearning(db, { title: "Second" });
    const l3 = createTestLearning(db, { title: "Third" });

    expect(l2.id).toBeGreaterThan(l1.id!);
    expect(l3.id).toBeGreaterThan(l2.id!);
  });

  it("handles special characters in title", () => {
    const specialTitle = 'Title with "quotes" and <html> & symbols';
    const learning = createTestLearning(db, { title: specialTitle });

    assertFieldEquals(db, "learnings", learning.id!, "title", specialTitle);
  });

  it("links learning to session", () => {
    const session = createTestSession(db, { summary: "Source session" });

    db.run(
      "INSERT INTO learnings (category, title, source_session_id) VALUES (?, ?, ?)",
      ["testing", "Linked learning", session.id]
    );

    const learning = db.query(
      "SELECT * FROM learnings WHERE source_session_id = ?"
    ).get(session.id) as any;

    expect(learning).toBeDefined();
    expect(learning.source_session_id).toBe(session.id);
  });

  it("updates validation count", () => {
    const learning = createTestLearning(db);

    // Simulate validation
    db.run(
      "UPDATE learnings SET validation_count = validation_count + 1 WHERE id = ?",
      [learning.id]
    );

    const row = db.query("SELECT validation_count FROM learnings WHERE id = ?").get(
      learning.id
    ) as any;
    expect(row.validation_count).toBe(1);
  });
});

// ============================================================================
// Unified Tasks Tests
// ============================================================================

describe("Unified Tasks", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("creates task with all domains", () => {
    const domains: Array<"system" | "project" | "session"> = ["system", "project", "session"];

    for (const domain of domains) {
      const task = createTestTask(db, { title: `${domain} task`, domain });
      assertFieldEquals(db, "unified_tasks", task.id!, "domain", domain);
    }
  });

  it("creates task with all priorities", () => {
    const priorities = ["critical", "high", "normal", "low"];

    for (const priority of priorities) {
      const task = createTestTask(db, { title: `${priority} priority`, priority });
      assertFieldEquals(db, "unified_tasks", task.id!, "priority", priority);
    }
  });

  it("creates task with all statuses", () => {
    const statuses = ["open", "in_progress", "done", "blocked", "wont_fix"];

    for (const status of statuses) {
      const task = createTestTask(db, { title: `${status} status`, status });
      assertFieldEquals(db, "unified_tasks", task.id!, "status", status);
    }
  });

  it("updates task status through all transitions", () => {
    const task = createTestTask(db, { status: "open" });

    const transitions = ["in_progress", "blocked", "in_progress", "done", "open", "wont_fix"];

    for (const status of transitions) {
      db.run("UPDATE unified_tasks SET status = ? WHERE id = ?", [status, task.id]);
      assertFieldEquals(db, "unified_tasks", task.id!, "status", status);
    }
  });

  it("rejects invalid status", () => {
    expect(() => {
      db.run(
        "INSERT INTO unified_tasks (title, domain, status) VALUES (?, ?, ?)",
        ["Bad status", "session", "invalid_status"]
      );
    }).toThrow();
  });

  it("rejects invalid domain", () => {
    expect(() => {
      db.run(
        "INSERT INTO unified_tasks (title, domain) VALUES (?, ?)",
        ["Bad domain", "invalid_domain"]
      );
    }).toThrow();
  });

  it("rejects invalid priority", () => {
    expect(() => {
      db.run(
        "INSERT INTO unified_tasks (title, domain, priority) VALUES (?, ?, ?)",
        ["Bad priority", "session", "invalid_priority"]
      );
    }).toThrow();
  });

  it("filters tasks by domain", () => {
    // Clear existing
    db.run("DELETE FROM unified_tasks");

    createTestTask(db, { title: "System 1", domain: "system" });
    createTestTask(db, { title: "System 2", domain: "system" });
    createTestTask(db, { title: "Project 1", domain: "project" });
    createTestTask(db, { title: "Session 1", domain: "session" });

    assertRowCount(db, "unified_tasks", 2, "domain = 'system'");
    assertRowCount(db, "unified_tasks", 1, "domain = 'project'");
    assertRowCount(db, "unified_tasks", 1, "domain = 'session'");
  });

  it("filters tasks by status", () => {
    db.run("DELETE FROM unified_tasks");

    createTestTask(db, { title: "Open 1", status: "open" });
    createTestTask(db, { title: "Open 2", status: "open" });
    createTestTask(db, { title: "Done 1", status: "done" });

    assertRowCount(db, "unified_tasks", 2, "status = 'open'");
    assertRowCount(db, "unified_tasks", 1, "status = 'done'");
  });

  it("links task to session", () => {
    const session = createTestSession(db);

    db.run(
      "INSERT INTO unified_tasks (title, domain, session_id) VALUES (?, ?, ?)",
      ["Session task", "session", session.id]
    );

    const task = db.query(
      "SELECT * FROM unified_tasks WHERE session_id = ?"
    ).get(session.id) as any;

    expect(task).toBeDefined();
    expect(task.session_id).toBe(session.id);
  });
});

// ============================================================================
// Data Integrity Tests
// ============================================================================

describe("Data Integrity", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("maintains referential integrity for session links", () => {
    const session = createTestSession(db);
    const learning = createTestLearning(db);

    db.run("UPDATE learnings SET source_session_id = ? WHERE id = ?", [
      session.id,
      learning.id,
    ]);

    // Verify link
    const row = db.query(
      "SELECT l.*, s.summary FROM learnings l JOIN sessions s ON l.source_session_id = s.id WHERE l.id = ?"
    ).get(learning.id) as any;

    expect(row).toBeDefined();
    expect(row.source_session_id).toBe(session.id);
  });

  it("handles orphaned references gracefully", () => {
    // Create learning with non-existent session reference
    db.run(
      "INSERT INTO learnings (category, title, source_session_id) VALUES (?, ?, ?)",
      ["testing", "Orphan", "non_existent_session"]
    );

    // Should still query without error
    const orphans = db.query(
      "SELECT * FROM learnings WHERE source_session_id NOT IN (SELECT id FROM sessions)"
    ).all();

    expect(orphans.length).toBeGreaterThan(0);
  });

  it("counts records correctly across tables", () => {
    db.run("DELETE FROM sessions");
    db.run("DELETE FROM learnings");
    db.run("DELETE FROM unified_tasks");

    createTestSession(db);
    createTestSession(db);
    createTestLearning(db);
    createTestTask(db, { domain: "system" });
    createTestTask(db, { domain: "project" });
    createTestTask(db, { domain: "session" });

    assertRowCount(db, "sessions", 2);
    assertRowCount(db, "learnings", 1);
    assertRowCount(db, "unified_tasks", 3);
  });

  it("handles concurrent writes without corruption", async () => {
    const writes = [];
    for (let i = 0; i < 10; i++) {
      writes.push(
        Promise.resolve(createTestSession(db, { summary: `Concurrent ${i}` }))
      );
    }

    const results = await Promise.all(writes);
    const ids = new Set(results.map((s) => s.id));

    expect(ids.size).toBe(10); // All unique IDs
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe("Edge Cases", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("handles empty strings", () => {
    const session = createTestSession(db, { summary: "", tags: "" });
    assertExists(db, "sessions", session.id);
  });

  it("handles null values", () => {
    db.run("INSERT INTO sessions (id, summary) VALUES (?, NULL)", [
      `session_null_${randomString()}`,
    ]);

    const row = db.query(
      "SELECT * FROM sessions WHERE summary IS NULL"
    ).get() as any;
    expect(row).toBeDefined();
  });

  it("handles very long text", () => {
    const longText = "X".repeat(100000);
    const session = createTestSession(db, { summary: longText });

    const row = db.query("SELECT summary FROM sessions WHERE id = ?").get(
      session.id
    ) as any;
    expect(row.summary.length).toBe(100000);
  });

  it("handles unicode and emoji", () => {
    const unicodeText = "Unicode: 你好 مرحبا 🎉 émoji naïve Ñ";
    const session = createTestSession(db, { summary: unicodeText });

    assertFieldEquals(db, "sessions", session.id, "summary", unicodeText);
  });

  it("handles special SQL characters", () => {
    const sqlChars = "Test with ' single quote and \" double quote and ; semicolon";
    const session = createTestSession(db, { summary: sqlChars });

    assertFieldEquals(db, "sessions", session.id, "summary", sqlChars);
  });

  it("handles newlines and tabs", () => {
    const multiline = "Line 1\nLine 2\tTabbed\r\nWindows line";
    const session = createTestSession(db, { summary: multiline });

    assertFieldEquals(db, "sessions", session.id, "summary", multiline);
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("Performance", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("creates 100 sessions quickly", () => {
    const start = Date.now();

    for (let i = 0; i < 100; i++) {
      createTestSession(db, { summary: `Perf test ${i}` });
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // Should complete in < 5 seconds
  });

  it("queries 1000 rows quickly", () => {
    // First create rows
    for (let i = 0; i < 100; i++) {
      createTestLearning(db, { title: `Query test ${i}` });
    }

    const start = Date.now();

    for (let i = 0; i < 100; i++) {
      db.query("SELECT * FROM learnings WHERE title LIKE ?").all("%Query test%");
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000); // 100 queries in < 2 seconds
  });
});
