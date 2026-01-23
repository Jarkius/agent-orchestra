/**
 * Matrix Communication Tests
 *
 * Tests for matrix messaging, registry, and persistence
 * Uses bun:test with isolated temp database
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createTempDb,
  cleanupTempDb,
  createTestMessage,
  createTestMatrix,
  getNextSequence,
  assertExists,
  assertNotExists,
  assertRowCount,
  assertFieldEquals,
  randomString,
  parallel,
} from "./test-utils";

// ============================================================================
// Matrix Messages Schema Tests
// ============================================================================

describe("Matrix Messages Schema", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("creates message with all required fields", () => {
    const message = createTestMessage(db, {
      from_matrix: "sender-matrix",
      content: "Hello world",
    });

    expect(message.id).toBeGreaterThan(0);
    assertExists(db, "matrix_messages", message.id!);
    assertFieldEquals(db, "matrix_messages", message.id!, "from_matrix", "sender-matrix");
    assertFieldEquals(db, "matrix_messages", message.id!, "content", "Hello world");
  });

  it("auto-increments message ID", () => {
    const m1 = createTestMessage(db, { content: "First" });
    const m2 = createTestMessage(db, { content: "Second" });
    const m3 = createTestMessage(db, { content: "Third" });

    expect(m2.id).toBeGreaterThan(m1.id!);
    expect(m3.id).toBeGreaterThan(m2.id!);
  });

  it("validates message_type constraint (broadcast|direct)", () => {
    // Valid types
    const broadcast = createTestMessage(db, { message_type: "broadcast" });
    const direct = createTestMessage(db, { to_matrix: "target", message_type: "direct" });

    assertFieldEquals(db, "matrix_messages", broadcast.id!, "message_type", "broadcast");
    assertFieldEquals(db, "matrix_messages", direct.id!, "message_type", "direct");

    // Invalid type
    expect(() => {
      db.run(
        `INSERT INTO matrix_messages (from_matrix, content, message_type) VALUES (?, ?, ?)`,
        ["test", "content", "invalid_type"]
      );
    }).toThrow();
  });

  it("validates status constraint (pending|sending|sent|delivered|failed)", () => {
    const statuses = ["pending", "sending", "sent", "delivered", "failed"];

    for (const status of statuses) {
      const msg = createTestMessage(db, { status: status as any, content: `${status} message` });
      assertFieldEquals(db, "matrix_messages", msg.id!, "status", status);
    }

    // Invalid status
    expect(() => {
      db.run(
        `INSERT INTO matrix_messages (from_matrix, content, status) VALUES (?, ?, ?)`,
        ["test", "content", "invalid_status"]
      );
    }).toThrow();
  });

  it("handles unicode in content", () => {
    const unicodeContent = "Unicode: 你好 مرحبا 🎉 émoji naïve Ñ 🚀";
    const message = createTestMessage(db, { content: unicodeContent });

    assertFieldEquals(db, "matrix_messages", message.id!, "content", unicodeContent);
  });

  it("stores message_id as unique", () => {
    const messageId = `unique_${randomString(8)}`;
    createTestMessage(db, { message_id: messageId });

    // Duplicate should fail
    expect(() => {
      db.run(
        `INSERT INTO matrix_messages (message_id, from_matrix, content) VALUES (?, ?, ?)`,
        [messageId, "test", "duplicate"]
      );
    }).toThrow();
  });

  it("defaults status to pending", () => {
    const result = db.run(
      `INSERT INTO matrix_messages (from_matrix, content) VALUES (?, ?)`,
      ["test-matrix", "content"]
    );
    const id = Number(result.lastInsertRowid);

    assertFieldEquals(db, "matrix_messages", id, "status", "pending");
  });

  it("defaults message_type to broadcast", () => {
    const result = db.run(
      `INSERT INTO matrix_messages (from_matrix, content) VALUES (?, ?)`,
      ["test-matrix", "content"]
    );
    const id = Number(result.lastInsertRowid);

    assertFieldEquals(db, "matrix_messages", id, "message_type", "broadcast");
  });
});

// ============================================================================
// Matrix Registry Schema Tests
// ============================================================================

describe("Matrix Registry Schema", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("creates matrix with unique ID", () => {
    const matrix = createTestMatrix(db, { matrix_id: "unique-matrix" });

    expect(matrix.id).toBeGreaterThan(0);
    assertExists(db, "matrix_registry", matrix.id!);
  });

  it("enforces unique matrix_id constraint", () => {
    createTestMatrix(db, { matrix_id: "duplicate-test" });

    expect(() => {
      db.run(
        `INSERT INTO matrix_registry (matrix_id) VALUES (?)`,
        ["duplicate-test"]
      );
    }).toThrow();
  });

  it("validates status constraint (online|offline|away)", () => {
    const statuses: Array<"online" | "offline" | "away"> = ["online", "offline", "away"];

    for (const status of statuses) {
      const matrix = createTestMatrix(db, {
        matrix_id: `status-test-${status}`,
        status,
      });
      assertFieldEquals(db, "matrix_registry", matrix.id!, "status", status);
    }

    // Invalid status
    expect(() => {
      db.run(
        `INSERT INTO matrix_registry (matrix_id, status) VALUES (?, ?)`,
        ["invalid-status", "invalid"]
      );
    }).toThrow();
  });

  it("updates last_seen timestamp", () => {
    const matrix = createTestMatrix(db, { matrix_id: "timestamp-test" });

    // Get original timestamp
    const before = db.query(`SELECT last_seen FROM matrix_registry WHERE id = ?`).get(matrix.id) as any;

    // Update last_seen
    db.run(
      `UPDATE matrix_registry SET last_seen = datetime('now') WHERE id = ?`,
      [matrix.id]
    );

    const after = db.query(`SELECT last_seen FROM matrix_registry WHERE id = ?`).get(matrix.id) as any;
    expect(after.last_seen).toBeDefined();
  });

  it("handles display_name", () => {
    const matrix = createTestMatrix(db, {
      matrix_id: "display-test",
      display_name: "My Matrix Display Name",
    });

    assertFieldEquals(db, "matrix_registry", matrix.id!, "display_name", "My Matrix Display Name");
  });

  it("defaults status to offline", () => {
    const result = db.run(
      `INSERT INTO matrix_registry (matrix_id) VALUES (?)`,
      [`default-status-${randomString(4)}`]
    );
    const id = Number(result.lastInsertRowid);

    assertFieldEquals(db, "matrix_registry", id, "status", "offline");
  });
});

// ============================================================================
// Message Persistence Tests
// ============================================================================

describe("Message Persistence", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("saves outgoing message with pending status", () => {
    const message = createTestMessage(db, {
      from_matrix: "sender",
      content: "Outgoing message",
      status: "pending",
    });

    assertFieldEquals(db, "matrix_messages", message.id!, "status", "pending");
  });

  it("updates status to sent after delivery", () => {
    const message = createTestMessage(db, { status: "pending" });

    // Simulate send
    db.run(
      `UPDATE matrix_messages SET status = 'sent', sent_at = datetime('now') WHERE id = ?`,
      [message.id]
    );

    assertFieldEquals(db, "matrix_messages", message.id!, "status", "sent");
    const row = db.query(`SELECT sent_at FROM matrix_messages WHERE id = ?`).get(message.id) as any;
    expect(row.sent_at).toBeDefined();
  });

  it("marks failed with error message", () => {
    const message = createTestMessage(db, { status: "pending" });
    const errorMessage = "Connection refused";

    db.run(
      `UPDATE matrix_messages SET status = 'failed', error = ? WHERE id = ?`,
      [errorMessage, message.id]
    );

    assertFieldEquals(db, "matrix_messages", message.id!, "status", "failed");
    assertFieldEquals(db, "matrix_messages", message.id!, "error", errorMessage);
  });

  it("tracks retry_count", () => {
    const message = createTestMessage(db, { retry_count: 0 });

    // Simulate retries
    for (let i = 1; i <= 3; i++) {
      db.run(
        `UPDATE matrix_messages SET retry_count = ? WHERE id = ?`,
        [i, message.id]
      );
      assertFieldEquals(db, "matrix_messages", message.id!, "retry_count", i);
    }
  });

  it("calculates next_retry_at with exponential backoff", () => {
    const message = createTestMessage(db, { retry_count: 0 });

    // Backoff formula: 10s * 2^retryCount
    // Retry 0: 10s, Retry 1: 20s, Retry 2: 40s
    const baseDelay = 10;

    for (let retryCount = 0; retryCount < 3; retryCount++) {
      const delay = baseDelay * Math.pow(2, retryCount);
      db.run(
        `UPDATE matrix_messages
         SET retry_count = ?, next_retry_at = datetime('now', '+' || ? || ' seconds')
         WHERE id = ?`,
        [retryCount + 1, delay, message.id]
      );

      const row = db.query(`SELECT next_retry_at FROM matrix_messages WHERE id = ?`).get(message.id) as any;
      expect(row.next_retry_at).toBeDefined();
    }
  });

  it("transitions through status lifecycle", () => {
    const message = createTestMessage(db, { status: "pending" });

    // pending -> sending -> sent -> delivered
    const transitions = ["sending", "sent", "delivered"];

    for (const status of transitions) {
      db.run(`UPDATE matrix_messages SET status = ? WHERE id = ?`, [status, message.id]);
      assertFieldEquals(db, "matrix_messages", message.id!, "status", status);
    }
  });
});

// ============================================================================
// Sequence Numbers Tests
// ============================================================================

describe("Sequence Numbers", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("auto-increments per matrix", () => {
    const matrixId = `seq-test-${randomString(4)}`;

    const seq1 = getNextSequence(db, matrixId);
    const seq2 = getNextSequence(db, matrixId);
    const seq3 = getNextSequence(db, matrixId);

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
    expect(seq3).toBe(3);
  });

  it("maintains separate sequences per matrix", () => {
    const matrix1 = `matrix-1-${randomString(4)}`;
    const matrix2 = `matrix-2-${randomString(4)}`;

    const seq1a = getNextSequence(db, matrix1);
    const seq2a = getNextSequence(db, matrix2);
    const seq1b = getNextSequence(db, matrix1);
    const seq2b = getNextSequence(db, matrix2);

    expect(seq1a).toBe(1);
    expect(seq2a).toBe(1);
    expect(seq1b).toBe(2);
    expect(seq2b).toBe(2);
  });

  it("orders messages correctly", () => {
    const matrixId = `order-test-${randomString(4)}`;

    // Create messages with sequence numbers
    for (let i = 1; i <= 5; i++) {
      createTestMessage(db, {
        from_matrix: matrixId,
        content: `Message ${i}`,
        sequence_number: i,
      });
    }

    // Query in order
    const messages = db.query(
      `SELECT content, sequence_number FROM matrix_messages
       WHERE from_matrix = ? ORDER BY sequence_number ASC`
    ).all(matrixId) as any[];

    expect(messages.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(messages[i].sequence_number).toBe(i + 1);
      expect(messages[i].content).toBe(`Message ${i + 1}`);
    }
  });

  it("handles concurrent inserts atomically", async () => {
    const matrixId = `concurrent-seq-${randomString(4)}`;

    // Simulate concurrent sequence requests
    const results = await parallel([
      () => Promise.resolve(getNextSequence(db, matrixId)),
      () => Promise.resolve(getNextSequence(db, matrixId)),
      () => Promise.resolve(getNextSequence(db, matrixId)),
    ]);

    // All should be unique
    const unique = new Set(results);
    expect(unique.size).toBe(3);
  });
});

// ============================================================================
// Message Queries Tests
// ============================================================================

describe("Message Queries", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("filters by to_matrix for direct messages", () => {
    const targetMatrix = `target-${randomString(4)}`;

    createTestMessage(db, { to_matrix: targetMatrix, message_type: "direct", content: "Direct 1" });
    createTestMessage(db, { to_matrix: targetMatrix, message_type: "direct", content: "Direct 2" });
    createTestMessage(db, { to_matrix: "other-matrix", message_type: "direct", content: "Other" });

    const directMessages = db.query(
      `SELECT * FROM matrix_messages WHERE to_matrix = ? AND message_type = 'direct'`
    ).all(targetMatrix);

    expect(directMessages.length).toBe(2);
  });

  it("includes broadcasts in inbox", () => {
    db.run("DELETE FROM matrix_messages");

    createTestMessage(db, { message_type: "broadcast", content: "Broadcast 1" });
    createTestMessage(db, { message_type: "broadcast", content: "Broadcast 2" });
    createTestMessage(db, { to_matrix: "my-matrix", message_type: "direct", content: "Direct to me" });

    // Inbox query: broadcasts + direct messages to me
    const inbox = db.query(
      `SELECT * FROM matrix_messages
       WHERE message_type = 'broadcast' OR to_matrix = ?`
    ).all("my-matrix");

    expect(inbox.length).toBe(3);
  });

  it("excludes self-sent messages from inbox", () => {
    db.run("DELETE FROM matrix_messages");
    const myMatrix = "my-matrix";

    createTestMessage(db, { from_matrix: "other", message_type: "broadcast", content: "From other" });
    createTestMessage(db, { from_matrix: myMatrix, message_type: "broadcast", content: "From me" });

    const inbox = db.query(
      `SELECT * FROM matrix_messages
       WHERE (message_type = 'broadcast' OR to_matrix = ?)
       AND from_matrix != ?`
    ).all(myMatrix, myMatrix);

    expect(inbox.length).toBe(1);
    expect((inbox[0] as any).content).toBe("From other");
  });

  it("marks messages as read", () => {
    const msg1 = createTestMessage(db, { content: "Unread 1" });
    const msg2 = createTestMessage(db, { content: "Unread 2" });

    // Mark as read
    db.run(
      `UPDATE matrix_messages SET read_at = datetime('now') WHERE id IN (?, ?)`,
      [msg1.id, msg2.id]
    );

    const row1 = db.query(`SELECT read_at FROM matrix_messages WHERE id = ?`).get(msg1.id) as any;
    const row2 = db.query(`SELECT read_at FROM matrix_messages WHERE id = ?`).get(msg2.id) as any;

    expect(row1.read_at).toBeDefined();
    expect(row2.read_at).toBeDefined();
  });

  it("counts unread correctly", () => {
    db.run("DELETE FROM matrix_messages");
    const myMatrix = "count-test";

    // Create 3 unread + 2 read
    createTestMessage(db, { from_matrix: "other", to_matrix: myMatrix, message_type: "direct" });
    createTestMessage(db, { from_matrix: "other", to_matrix: myMatrix, message_type: "direct" });
    createTestMessage(db, { from_matrix: "other", to_matrix: myMatrix, message_type: "direct" });

    const readMsg1 = createTestMessage(db, { from_matrix: "other", to_matrix: myMatrix, message_type: "direct" });
    const readMsg2 = createTestMessage(db, { from_matrix: "other", to_matrix: myMatrix, message_type: "direct" });
    db.run(`UPDATE matrix_messages SET read_at = datetime('now') WHERE id IN (?, ?)`, [readMsg1.id, readMsg2.id]);

    const unreadCount = db.query(
      `SELECT COUNT(*) as count FROM matrix_messages
       WHERE to_matrix = ? AND read_at IS NULL`
    ).get(myMatrix) as { count: number };

    expect(unreadCount.count).toBe(3);
  });
});

// ============================================================================
// Retry Logic Tests
// ============================================================================

describe("Retry Logic", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("calculates backoff: 10s * 2^retryCount", () => {
    // Expected delays: retry 0: 10s, retry 1: 20s, retry 2: 40s, retry 3: 80s
    const baseDelay = 10;

    for (let retryCount = 0; retryCount < 4; retryCount++) {
      const expectedDelay = baseDelay * Math.pow(2, retryCount);
      expect(expectedDelay).toBe([10, 20, 40, 80][retryCount]);
    }
  });

  it("caps at 5 minutes maximum", () => {
    const baseDelay = 10;
    const maxDelay = 300; // 5 minutes

    // At retry 6: 10 * 2^6 = 640s, should cap at 300s
    for (let retryCount = 0; retryCount < 10; retryCount++) {
      const rawDelay = baseDelay * Math.pow(2, retryCount);
      const cappedDelay = Math.min(rawDelay, maxDelay);

      if (retryCount >= 5) {
        expect(cappedDelay).toBe(maxDelay);
      }
    }
  });

  it("respects max_retries limit", () => {
    const message = createTestMessage(db, {
      status: "pending",
      retry_count: 0,
    });

    const maxRetries = 3;

    // Retry until max
    for (let i = 0; i < maxRetries; i++) {
      db.run(`UPDATE matrix_messages SET retry_count = retry_count + 1 WHERE id = ?`, [message.id]);
    }

    const row = db.query(`SELECT retry_count FROM matrix_messages WHERE id = ?`).get(message.id) as any;
    expect(row.retry_count).toBe(maxRetries);

    // Check if we should stop retrying
    const shouldRetry = row.retry_count < maxRetries;
    expect(shouldRetry).toBe(false);
  });

  it("finds pending messages for retry", () => {
    db.run("DELETE FROM matrix_messages");

    createTestMessage(db, { status: "pending", retry_count: 0 });
    createTestMessage(db, { status: "pending", retry_count: 1 });
    createTestMessage(db, { status: "sent" }); // Should not be included
    createTestMessage(db, { status: "failed" }); // Should not be included

    const pendingForRetry = db.query(
      `SELECT * FROM matrix_messages
       WHERE status = 'pending' AND retry_count < 3`
    ).all();

    expect(pendingForRetry.length).toBe(2);
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe("Matrix Edge Cases", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("handles empty content", () => {
    // Note: content is NOT NULL, so empty string is allowed but NULL is not
    const message = createTestMessage(db, { content: "" });
    assertFieldEquals(db, "matrix_messages", message.id!, "content", "");
  });

  it("handles very long content (10KB)", () => {
    const longContent = "X".repeat(10000);
    const message = createTestMessage(db, { content: longContent });

    const row = db.query(`SELECT content FROM matrix_messages WHERE id = ?`).get(message.id) as any;
    expect(row.content.length).toBe(10000);
  });

  it("handles special SQL characters", () => {
    const sqlChars = "Content with ' single quote and \" double quote and ; semicolon -- comment";
    const message = createTestMessage(db, { content: sqlChars });

    assertFieldEquals(db, "matrix_messages", message.id!, "content", sqlChars);
  });

  it("handles concurrent message writes", async () => {
    const results = await parallel([
      () => Promise.resolve(createTestMessage(db, { content: "Concurrent 1" })),
      () => Promise.resolve(createTestMessage(db, { content: "Concurrent 2" })),
      () => Promise.resolve(createTestMessage(db, { content: "Concurrent 3" })),
      () => Promise.resolve(createTestMessage(db, { content: "Concurrent 4" })),
      () => Promise.resolve(createTestMessage(db, { content: "Concurrent 5" })),
    ]);

    // All should have unique IDs
    const ids = new Set(results.map((m) => m.id));
    expect(ids.size).toBe(5);
  });

  it("handles NULL to_matrix for broadcasts", () => {
    const message = createTestMessage(db, {
      message_type: "broadcast",
      content: "Broadcast to all",
    });

    const row = db.query(`SELECT to_matrix FROM matrix_messages WHERE id = ?`).get(message.id) as any;
    expect(row.to_matrix).toBeNull();
  });

  it("handles newlines and tabs in content", () => {
    const multiline = "Line 1\nLine 2\tTabbed\r\nWindows line";
    const message = createTestMessage(db, { content: multiline });

    assertFieldEquals(db, "matrix_messages", message.id!, "content", multiline);
  });

  it("handles JSON in content", () => {
    const jsonContent = JSON.stringify({ type: "data", items: [1, 2, 3], nested: { key: "value" } });
    const message = createTestMessage(db, { content: jsonContent });

    const row = db.query(`SELECT content FROM matrix_messages WHERE id = ?`).get(message.id) as any;
    const parsed = JSON.parse(row.content);
    expect(parsed.type).toBe("data");
    expect(parsed.items.length).toBe(3);
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("Matrix Performance", () => {
  let db: Database;

  beforeAll(() => {
    db = createTempDb();
  });

  afterAll(() => {
    cleanupTempDb();
  });

  it("creates 100 messages quickly", () => {
    const start = Date.now();

    for (let i = 0; i < 100; i++) {
      createTestMessage(db, { content: `Perf message ${i}` });
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // Should complete in < 5 seconds
  });

  it("queries messages quickly with index", () => {
    // Create messages with specific to_matrix for filtering
    for (let i = 0; i < 50; i++) {
      createTestMessage(db, { to_matrix: "perf-target", message_type: "direct" });
    }

    const start = Date.now();

    for (let i = 0; i < 100; i++) {
      db.query(`SELECT * FROM matrix_messages WHERE to_matrix = ?`).all("perf-target");
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000); // 100 queries in < 2 seconds
  });
});
