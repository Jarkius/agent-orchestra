/**
 * Matrix Communication Integration Tests
 * Tests hub, client, and message flow
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { startHub, stopHub } from '../matrix-hub';
import * as client from '../matrix-client';

const TEST_PORT = 18081; // Use different port to avoid conflicts
const TEST_HUB_URL = `ws://localhost:${TEST_PORT}`;

/**
 * Wait for hub to be ready by polling health endpoint
 */
async function waitForHubReady(port: number, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) return true;
    } catch {
      // Hub not ready yet
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

/**
 * Wait for a condition to be true
 */
async function waitFor(condition: () => Promise<boolean> | boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// Single hub instance for all tests
beforeAll(async () => {
  // Start test hub with PIN disabled for testing
  startHub({ port: TEST_PORT, disablePin: true });
  // Wait for hub to be ready
  const ready = await waitForHubReady(TEST_PORT);
  if (!ready) throw new Error('Hub failed to start');
});

afterAll(() => {
  // Stop test hub
  stopHub();
});

describe('Matrix Communication', () => {
  afterEach(() => {
    // Disconnect client after each test
    client.disconnect();
  });

  describe('Hub Health', () => {
    it('should respond to health check', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/health`);
      expect(response.ok).toBe(true);

      const data = await response.json() as { status: string; connectedMatrices: number };
      expect(data.status).toBe('healthy');
      expect(typeof data.connectedMatrices).toBe('number');
    });

    it('should provide matrix list endpoint', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/matrices`);
      expect(response.ok).toBe(true);

      const data = await response.json() as { online: string[] };
      expect(Array.isArray(data.online)).toBe(true);
    });
  });

  describe('Token Registration', () => {
    it('should issue token for valid matrix_id', async () => {
      const matrixId = `test-matrix-${Date.now()}`;
      const response = await fetch(`http://localhost:${TEST_PORT}/register?matrix_id=${matrixId}`);
      expect(response.ok).toBe(true);

      const data = await response.json() as { token: string; matrix_id: string };
      expect(data.token).toBeDefined();
      expect(data.matrix_id).toBe(matrixId);
    });

    it('should reject registration without matrix_id', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/register`);
      expect(response.status).toBe(400);
    });
  });

  describe('Client Connection', () => {
    it('should connect to hub successfully', async () => {
      client.setMatrixId(`test-client-${Date.now()}`);
      const connected = await client.connectToHub(TEST_HUB_URL);
      expect(connected).toBe(true);
      expect(client.isConnected()).toBe(true);
    });

    it('should disconnect cleanly', async () => {
      client.setMatrixId(`test-client-${Date.now()}`);
      await client.connectToHub(TEST_HUB_URL);
      expect(client.isConnected()).toBe(true);

      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should report correct status', async () => {
      client.setMatrixId(`test-client-${Date.now()}`);
      await client.connectToHub(TEST_HUB_URL);

      const status = client.getStatus();
      expect(status.connected).toBe(true);
      expect(status.hubUrl).toBe(TEST_HUB_URL);
    });
  });

  describe('Messaging', () => {
    it('should broadcast message when connected', async () => {
      client.setMatrixId(`test-broadcaster-${Date.now()}`);
      await client.connectToHub(TEST_HUB_URL);

      const sent = client.broadcast('Test broadcast message');
      expect(sent).toBe(true);
    });

    it('should send direct message when connected', async () => {
      client.setMatrixId(`test-sender-${Date.now()}`);
      await client.connectToHub(TEST_HUB_URL);

      const sent = client.sendDirect('other-matrix', 'Test direct message');
      expect(sent).toBe(true);
    });

    it('should fail to send when disconnected', () => {
      client.disconnect();
      const sent = client.broadcast('Should fail');
      expect(sent).toBe(false);
    });
  });

  describe('Message Handlers', () => {
    it('should register and unregister message handler', async () => {
      const messages: string[] = [];
      const handler = (msg: { content: string }) => messages.push(msg.content);

      const unregister = client.onMessage(handler);
      expect(typeof unregister).toBe('function');

      // Unregister should work without error
      unregister();
    });

    it('should register connection handler', async () => {
      let connectionState = false;
      const handler = (connected: boolean) => { connectionState = connected; };

      const unregister = client.onConnection(handler);
      expect(typeof unregister).toBe('function');

      unregister();
    });
  });
});

describe('Multi-Client Communication', () => {
  // For multi-client tests, we need to create separate client modules
  // This is a simplified test that verifies the hub handles multiple connections
  // Note: Uses the shared hub instance from top-level beforeAll

  afterEach(() => {
    client.disconnect();
  });

  it('should handle multiple matrix registrations', async () => {
    const registrations = await Promise.all([
      fetch(`http://localhost:${TEST_PORT}/register?matrix_id=matrix-a-${Date.now()}`),
      fetch(`http://localhost:${TEST_PORT}/register?matrix_id=matrix-b-${Date.now()}`),
      fetch(`http://localhost:${TEST_PORT}/register?matrix_id=matrix-c-${Date.now()}`),
    ]);

    for (const response of registrations) {
      expect(response.ok).toBe(true);
      const data = await response.json() as { token: string };
      expect(data.token).toBeDefined();
    }
  });

  it('should track connected matrices in health endpoint', async () => {
    // Connect a client
    const matrixId = `health-test-matrix-${Date.now()}`;
    client.setMatrixId(matrixId);
    await client.connectToHub(TEST_HUB_URL);

    // Wait for hub to register the connection
    const registered = await waitFor(async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/health`);
      const data = await response.json() as { connectedMatrices: number };
      return data.connectedMatrices >= 1;
    });
    expect(registered).toBe(true);

    // Check health
    const response = await fetch(`http://localhost:${TEST_PORT}/health`);
    const data = await response.json() as { connectedMatrices: number; online: string[] };

    expect(data.connectedMatrices).toBeGreaterThanOrEqual(1);
  });
});
