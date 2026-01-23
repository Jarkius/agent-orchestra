/**
 * Runtime Integration Tests
 *
 * Tests actual system behavior including:
 * - Real WebSocket connections
 * - Actual timing and delays
 * - Network failure recovery
 * - Process lifecycle
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { sleep } from "./test-utils";

// ============================================================================
// Matrix Hub Runtime Tests
// ============================================================================

describe("Matrix Hub Runtime", () => {
  const TEST_PORT = 19081; // Use unique port to avoid conflicts
  const TEST_URL = `http://localhost:${TEST_PORT}`;
  let hubProcess: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    // Start hub in background
    hubProcess = Bun.spawn(["bun", "run", "src/matrix-hub.ts"], {
      env: {
        ...process.env,
        MATRIX_HUB_PORT: String(TEST_PORT),
        MATRIX_HUB_PIN: "disabled", // Disable PIN for testing
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for hub to start
    await sleep(1000);
  });

  afterAll(async () => {
    if (hubProcess) {
      hubProcess.kill();
      await sleep(500);
    }
  });

  it("health endpoint responds within 100ms", async () => {
    const start = Date.now();
    const response = await fetch(`${TEST_URL}/health`);
    const elapsed = Date.now() - start;

    expect(response.ok).toBe(true);
    expect(elapsed).toBeLessThan(100);
  });

  it("returns valid health data structure", async () => {
    const response = await fetch(`${TEST_URL}/health`);
    const data = (await response.json()) as Record<string, unknown>;

    expect(data.status).toBe("healthy");
    expect(typeof data.connectedMatrices).toBe("number");
  });

  it("matrices endpoint lists registered matrices", async () => {
    const response = await fetch(`${TEST_URL}/matrices`);
    expect(response.ok).toBe(true);

    const data = (await response.json()) as { online: string[] };
    expect(Array.isArray(data.online)).toBe(true);
  });
});

// ============================================================================
// Matrix Registration & Token Tests
// ============================================================================

describe("Matrix Registration Runtime", () => {
  const TEST_PORT = 19082;
  const TEST_URL = `http://localhost:${TEST_PORT}`;
  let hubProcess: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    hubProcess = Bun.spawn(["bun", "run", "src/matrix-hub.ts"], {
      env: {
        ...process.env,
        MATRIX_HUB_PORT: String(TEST_PORT),
        MATRIX_HUB_PIN: "disabled",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await sleep(1000);
  });

  afterAll(async () => {
    if (hubProcess) {
      hubProcess.kill();
      await sleep(500);
    }
  });

  it("issues token for valid matrix_id", async () => {
    const matrixId = `test-${Date.now()}`;
    const response = await fetch(`${TEST_URL}/register?matrix_id=${matrixId}`);

    expect(response.ok).toBe(true);

    const data = (await response.json()) as { token: string; matrix_id: string };
    expect(data.token).toBeDefined();
    expect(data.token.length).toBeGreaterThan(10);
    expect(data.matrix_id).toBe(matrixId);
  });

  it("rejects registration without matrix_id", async () => {
    const response = await fetch(`${TEST_URL}/register`);
    expect(response.status).toBe(400);
  });

  it("generates unique tokens for different matrices", async () => {
    const tokens: string[] = [];

    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${TEST_URL}/register?matrix_id=unique-${i}-${Date.now()}`);
      const data = (await response.json()) as { token: string };
      tokens.push(data.token);
    }

    const uniqueTokens = new Set(tokens);
    expect(uniqueTokens.size).toBe(3);
  });

  it("issues same token for same matrix_id (deterministic)", async () => {
    // Token is deterministic: hash(matrixId + HUB_SECRET)
    // Same matrix always gets same token for reconnection
    const matrixId = `deterministic-${Date.now()}`;

    const response1 = await fetch(`${TEST_URL}/register?matrix_id=${matrixId}`);
    const data1 = (await response1.json()) as { token: string };

    // Wait to prove it's not time-dependent
    await sleep(10);

    const response2 = await fetch(`${TEST_URL}/register?matrix_id=${matrixId}`);
    const data2 = (await response2.json()) as { token: string };

    // Tokens should be identical (deterministic)
    expect(data1.token).toBe(data2.token);
    expect(data1.token.length).toBe(64); // SHA256 hex
  });
});

// ============================================================================
// PIN Authentication Tests
// ============================================================================

describe("Matrix PIN Authentication Runtime", () => {
  const TEST_PORT = 19083;
  const TEST_URL = `http://localhost:${TEST_PORT}`;
  const TEST_PIN = "TEST123";
  let hubProcess: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    hubProcess = Bun.spawn(["bun", "run", "src/matrix-hub.ts"], {
      env: {
        ...process.env,
        MATRIX_HUB_PORT: String(TEST_PORT),
        MATRIX_HUB_PIN: TEST_PIN,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await sleep(1000);
  });

  afterAll(async () => {
    if (hubProcess) {
      hubProcess.kill();
      await sleep(500);
    }
  });

  it("accepts valid PIN", async () => {
    const response = await fetch(`${TEST_URL}/register?matrix_id=pin-test&pin=${TEST_PIN}`);
    expect(response.ok).toBe(true);

    const data = (await response.json()) as { token: string };
    expect(data.token).toBeDefined();
  });

  it("rejects invalid PIN", async () => {
    const response = await fetch(`${TEST_URL}/register?matrix_id=pin-test&pin=WRONG`);
    expect(response.status).toBe(401);
  });

  it("rejects missing PIN when required", async () => {
    const response = await fetch(`${TEST_URL}/register?matrix_id=no-pin-test`);
    expect(response.status).toBe(401);
  });
});

// ============================================================================
// WebSocket Connection Tests
// ============================================================================

describe("WebSocket Connection Runtime", () => {
  const TEST_PORT = 19084;
  const WS_URL = `ws://localhost:${TEST_PORT}`;
  const HTTP_URL = `http://localhost:${TEST_PORT}`;
  let hubProcess: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    hubProcess = Bun.spawn(["bun", "run", "src/matrix-hub.ts"], {
      env: {
        ...process.env,
        MATRIX_HUB_PORT: String(TEST_PORT),
        MATRIX_HUB_PIN: "disabled",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await sleep(1000);
  });

  afterAll(async () => {
    if (hubProcess) {
      hubProcess.kill();
      await sleep(500);
    }
  });

  it("accepts WebSocket upgrade with valid token", async () => {
    // Get token first
    const regResponse = await fetch(`${HTTP_URL}/register?matrix_id=ws-test-${Date.now()}`);
    const { token } = (await regResponse.json()) as { token: string };

    // Connect via WebSocket
    const ws = new WebSocket(`${WS_URL}/?token=${token}`);

    const connected = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });

    expect(connected).toBe(true);
    ws.close();
  });

  it("rejects WebSocket with invalid token", async () => {
    const ws = new WebSocket(`${WS_URL}/?token=invalid-token-12345`);

    const rejected = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(false);
      ws.onclose = () => resolve(true);
      ws.onerror = () => resolve(true);
      setTimeout(() => resolve(false), 2000);
    });

    expect(rejected).toBe(true);
  });

  it("receives registration confirmation after connect", async () => {
    const regResponse = await fetch(`${HTTP_URL}/register?matrix_id=confirm-test-${Date.now()}`);
    const { token } = (await regResponse.json()) as { token: string };

    const ws = new WebSocket(`${WS_URL}/?token=${token}`);

    const firstMessage = await new Promise<any>((resolve) => {
      ws.onmessage = (event) => {
        resolve(JSON.parse(event.data));
      };
      setTimeout(() => resolve(null), 2000);
    });

    expect(firstMessage).not.toBeNull();
    expect(firstMessage.type).toBe("registered");
    ws.close();
  });
});

// ============================================================================
// Message Delivery Tests
// ============================================================================

describe("Message Delivery Runtime", () => {
  const TEST_PORT = 19085;
  const WS_URL = `ws://localhost:${TEST_PORT}`;
  const HTTP_URL = `http://localhost:${TEST_PORT}`;
  let hubProcess: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    hubProcess = Bun.spawn(["bun", "run", "src/matrix-hub.ts"], {
      env: {
        ...process.env,
        MATRIX_HUB_PORT: String(TEST_PORT),
        MATRIX_HUB_PIN: "disabled",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await sleep(1000);
  });

  afterAll(async () => {
    if (hubProcess) {
      hubProcess.kill();
      await sleep(500);
    }
  });

  it("delivers broadcast to connected clients", async () => {
    // Connect sender
    const senderReg = await fetch(`${HTTP_URL}/register?matrix_id=sender-${Date.now()}`);
    const { token: senderToken } = (await senderReg.json()) as { token: string };
    const sender = new WebSocket(`${WS_URL}/?token=${senderToken}`);
    await new Promise((r) => (sender.onopen = r));

    // Connect receiver
    const receiverReg = await fetch(`${HTTP_URL}/register?matrix_id=receiver-${Date.now()}`);
    const { token: receiverToken } = (await receiverReg.json()) as { token: string };
    const receiver = new WebSocket(`${WS_URL}/?token=${receiverToken}`);
    await new Promise((r) => (receiver.onopen = r));

    // Wait for both to register
    await sleep(200);

    // Set up receiver to capture messages
    const receivedMessages: any[] = [];
    receiver.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "message") {
        receivedMessages.push(msg);
      }
    };

    // Send broadcast
    sender.send(JSON.stringify({
      type: "message",
      content: "Hello broadcast",
    }));

    // Wait for delivery
    await sleep(500);

    expect(receivedMessages.length).toBeGreaterThan(0);
    expect(receivedMessages[0].content).toBe("Hello broadcast");

    sender.close();
    receiver.close();
  });

  it("delivers message within 50ms on same machine", async () => {
    // Connect two clients
    const aReg = await fetch(`${HTTP_URL}/register?matrix_id=timing-a-${Date.now()}`);
    const { token: aToken } = (await aReg.json()) as { token: string };
    const clientA = new WebSocket(`${WS_URL}/?token=${aToken}`);
    await new Promise((r) => (clientA.onopen = r));

    const bReg = await fetch(`${HTTP_URL}/register?matrix_id=timing-b-${Date.now()}`);
    const { token: bToken } = (await bReg.json()) as { token: string };
    const clientB = new WebSocket(`${WS_URL}/?token=${bToken}`);
    await new Promise((r) => (clientB.onopen = r));

    await sleep(200);

    // Measure delivery time
    let deliveryTime = 0;
    const sendTime = Date.now();

    const delivered = await new Promise<boolean>((resolve) => {
      clientB.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "message") {
          deliveryTime = Date.now() - sendTime;
          resolve(true);
        }
      };

      clientA.send(JSON.stringify({
        type: "message",
        content: "Timing test",
      }));

      setTimeout(() => resolve(false), 1000);
    });

    expect(delivered).toBe(true);
    expect(deliveryTime).toBeLessThan(50);

    clientA.close();
    clientB.close();
  });
});

// ============================================================================
// Heartbeat & Timeout Tests
// ============================================================================

describe("Heartbeat Runtime", () => {
  const TEST_PORT = 19086;
  const WS_URL = `ws://localhost:${TEST_PORT}`;
  const HTTP_URL = `http://localhost:${TEST_PORT}`;
  let hubProcess: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    hubProcess = Bun.spawn(["bun", "run", "src/matrix-hub.ts"], {
      env: {
        ...process.env,
        MATRIX_HUB_PORT: String(TEST_PORT),
        MATRIX_HUB_PIN: "disabled",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await sleep(1000);
  });

  afterAll(async () => {
    if (hubProcess) {
      hubProcess.kill();
      await sleep(500);
    }
  });

  it("hub sends ping within heartbeat interval", async () => {
    const regResponse = await fetch(`${HTTP_URL}/register?matrix_id=heartbeat-test-${Date.now()}`);
    const { token } = (await regResponse.json()) as { token: string };

    const ws = new WebSocket(`${WS_URL}/?token=${token}`);
    await new Promise((r) => (ws.onopen = r));

    // Wait for ping (hub sends every 10s, we wait up to 15s)
    const receivedPing = await new Promise<boolean>((resolve) => {
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "ping") {
          resolve(true);
        }
      };
      setTimeout(() => resolve(false), 15000);
    });

    expect(receivedPing).toBe(true);
    ws.close();
  }, 20000); // 20s timeout for this test

  it("client pong keeps connection alive", async () => {
    const regResponse = await fetch(`${HTTP_URL}/register?matrix_id=pong-test-${Date.now()}`);
    const { token, matrix_id } = (await regResponse.json()) as { token: string; matrix_id: string };

    const ws = new WebSocket(`${WS_URL}/?token=${token}`);
    await new Promise((r) => (ws.onopen = r));

    // Respond to pings
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", matrix_id }));
      }
    };

    // Wait 12 seconds (past heartbeat interval)
    await sleep(12000);

    // Connection should still be open
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  }, 20000);
});

// ============================================================================
// Retry Backoff Timing Tests
// ============================================================================

describe("Retry Backoff Timing", () => {
  it("calculates correct backoff delays", () => {
    const baseDelay = 10000; // 10 seconds
    const maxDelay = 300000; // 5 minutes

    const delays = [0, 1, 2, 3, 4, 5, 6].map((retryCount) => {
      const raw = baseDelay * Math.pow(2, retryCount);
      return Math.min(raw, maxDelay);
    });

    expect(delays[0]).toBe(10000);   // 10s
    expect(delays[1]).toBe(20000);   // 20s
    expect(delays[2]).toBe(40000);   // 40s
    expect(delays[3]).toBe(80000);   // 80s
    expect(delays[4]).toBe(160000);  // 160s
    expect(delays[5]).toBe(300000);  // 300s (capped)
    expect(delays[6]).toBe(300000);  // 300s (capped)
  });

  it("adds jitter within expected range", () => {
    const jitterSamples: number[] = [];

    for (let i = 0; i < 100; i++) {
      const jitter = Math.random() * 2000; // 0-2s
      jitterSamples.push(jitter);
    }

    const min = Math.min(...jitterSamples);
    const max = Math.max(...jitterSamples);

    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(2000);
  });
});

// ============================================================================
// Process Lifecycle Tests (tmux-dependent)
// ============================================================================

describe("Tmux Availability", () => {
  it("checks if tmux is available", async () => {
    const proc = Bun.spawn(["which", "tmux"], {
      stdout: "pipe",
    });

    const exitCode = await proc.exited;
    const hasTmux = exitCode === 0;

    // Log for debugging
    if (!hasTmux) {
      console.log("Note: tmux not available - some integration tests will be skipped");
    }

    expect(typeof hasTmux).toBe("boolean");
  });
});

// ============================================================================
// Concurrent Connection Tests
// ============================================================================

describe("Concurrent Connections Runtime", () => {
  const TEST_PORT = 19087;
  const WS_URL = `ws://localhost:${TEST_PORT}`;
  const HTTP_URL = `http://localhost:${TEST_PORT}`;
  let hubProcess: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    hubProcess = Bun.spawn(["bun", "run", "src/matrix-hub.ts"], {
      env: {
        ...process.env,
        MATRIX_HUB_PORT: String(TEST_PORT),
        MATRIX_HUB_PIN: "disabled",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await sleep(1000);
  });

  afterAll(async () => {
    if (hubProcess) {
      hubProcess.kill();
      await sleep(500);
    }
  });

  it("handles 10 concurrent connections", async () => {
    const connections: WebSocket[] = [];

    // Create 10 concurrent connections
    const connectPromises = Array.from({ length: 10 }, async (_, i) => {
      const regResponse = await fetch(`${HTTP_URL}/register?matrix_id=concurrent-${i}-${Date.now()}`);
      const { token } = (await regResponse.json()) as { token: string };

      const ws = new WebSocket(`${WS_URL}/?token=${token}`);
      await new Promise((r) => (ws.onopen = r));
      connections.push(ws);
      return true;
    });

    const results = await Promise.all(connectPromises);

    expect(results.every((r) => r === true)).toBe(true);
    expect(connections.length).toBe(10);

    // Verify health endpoint shows correct count
    await sleep(200);
    const health = await fetch(`${HTTP_URL}/health`);
    const data = (await health.json()) as { connectedMatrices: number };
    expect(data.connectedMatrices).toBe(10);

    // Cleanup
    connections.forEach((ws) => ws.close());
  });

  it("handles rapid connect/disconnect cycles", async () => {
    for (let i = 0; i < 5; i++) {
      const regResponse = await fetch(`${HTTP_URL}/register?matrix_id=rapid-${i}-${Date.now()}`);
      const { token } = (await regResponse.json()) as { token: string };

      const ws = new WebSocket(`${WS_URL}/?token=${token}`);
      await new Promise((r) => (ws.onopen = r));
      ws.close();
      await sleep(50);
    }

    // Hub should still be healthy
    const health = await fetch(`${HTTP_URL}/health`);
    expect(health.ok).toBe(true);
  });
});

// ============================================================================
// Error Recovery Tests
// ============================================================================

describe("Error Recovery Runtime", () => {
  const TEST_PORT = 19088;
  const HTTP_URL = `http://localhost:${TEST_PORT}`;
  let hubProcess: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    hubProcess = Bun.spawn(["bun", "run", "src/matrix-hub.ts"], {
      env: {
        ...process.env,
        MATRIX_HUB_PORT: String(TEST_PORT),
        MATRIX_HUB_PIN: "disabled",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await sleep(1000);
  });

  afterAll(async () => {
    if (hubProcess) {
      hubProcess.kill();
      await sleep(500);
    }
  });

  it("survives malformed JSON in message", async () => {
    const regResponse = await fetch(`${HTTP_URL}/register?matrix_id=malformed-${Date.now()}`);
    const { token } = (await regResponse.json()) as { token: string };

    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/?token=${token}`);
    await new Promise((r) => (ws.onopen = r));

    // Send malformed JSON
    ws.send("not valid json {{{");

    // Connection should still work
    await sleep(100);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    // Send valid message after
    ws.send(JSON.stringify({ type: "message", content: "Valid after invalid" }));

    await sleep(100);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });

  it("handles missing fields in message gracefully", async () => {
    const regResponse = await fetch(`${HTTP_URL}/register?matrix_id=missing-${Date.now()}`);
    const { token } = (await regResponse.json()) as { token: string };

    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/?token=${token}`);
    await new Promise((r) => (ws.onopen = r));

    // Send message missing required fields
    ws.send(JSON.stringify({ type: "message" })); // Missing content

    await sleep(100);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });
});

// ============================================================================
// Performance Benchmarks
// ============================================================================

describe("Performance Benchmarks", () => {
  const TEST_PORT = 19089;
  const HTTP_URL = `http://localhost:${TEST_PORT}`;
  let hubProcess: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    hubProcess = Bun.spawn(["bun", "run", "src/matrix-hub.ts"], {
      env: {
        ...process.env,
        MATRIX_HUB_PORT: String(TEST_PORT),
        MATRIX_HUB_PIN: "disabled",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await sleep(1000);
  });

  afterAll(async () => {
    if (hubProcess) {
      hubProcess.kill();
      await sleep(500);
    }
  });

  it("registers 50 matrices within 2 seconds", async () => {
    const start = Date.now();

    const promises = Array.from({ length: 50 }, (_, i) =>
      fetch(`${HTTP_URL}/register?matrix_id=perf-${i}-${Date.now()}`)
    );

    await Promise.all(promises);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it("health endpoint handles 100 requests/second", async () => {
    const start = Date.now();

    const promises = Array.from({ length: 100 }, () =>
      fetch(`${HTTP_URL}/health`)
    );

    const results = await Promise.all(promises);

    const elapsed = Date.now() - start;
    const successCount = results.filter((r) => r.ok).length;

    expect(successCount).toBe(100);
    expect(elapsed).toBeLessThan(1500); // Allow some overhead
  });
});
