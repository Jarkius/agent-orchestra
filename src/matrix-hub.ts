/**
 * Matrix Hub - Cross-Matrix WebSocket Communication Server
 * Provides real-time messaging between multiple matrix instances (Claude clones)
 *
 * Phase 3: Dedicated hub process for matrix-to-matrix communication
 * Follows the same patterns as ws-server.ts but for matrices instead of agents
 */

import { randomBytes, createHash } from 'crypto';
import {
  registerMatrix,
  updateMatrixStatus,
  getOnlineMatrices,
  touchMatrix,
  markStaleMatricesOffline,
  type MatrixStatus,
} from './db';

// ============ Configuration ============

const HUB_PORT = parseInt(process.env.MATRIX_HUB_PORT || '8081');
const HUB_SECRET = process.env.MATRIX_HUB_SECRET || 'default-hub-secret-change-me';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const HEARTBEAT_INTERVAL_MS = 10000; // 10 seconds
const HEARTBEAT_TIMEOUT_MS = 30000; // 30 seconds

// ============ Types ============

interface MatrixConnection {
  ws: any; // Bun WebSocket type
  matrixId: string;
  displayName?: string;
  connectedAt: Date;
  lastPing: Date;
}

interface MatrixToken {
  token: string;
  matrixId: string;
  createdAt: Date;
  expiresAt: Date;
}

// Hub → Matrix messages
type HubToMatrixMessage =
  | { type: 'registered'; matrix_id: string; online_matrices: string[] }
  | { type: 'message'; from: string; content: string; timestamp: string; metadata?: Record<string, any> }
  | { type: 'presence'; matrix_id: string; status: MatrixStatus; display_name?: string }
  | { type: 'ping' }
  | { type: 'error'; code: string; message: string };

// Matrix → Hub messages
type MatrixToHubMessage =
  | { type: 'message'; to?: string; content: string; metadata?: Record<string, any> }  // to=undefined for broadcast
  | { type: 'pong'; matrix_id: string }
  | { type: 'presence'; status: 'online' | 'away' };

// ============ State ============

const connectedMatrices = new Map<string, MatrixConnection>();
const matrixTokens = new Map<string, MatrixToken>();
let server: ReturnType<typeof Bun.serve> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

// ============ Token Management ============

/**
 * Generate a token for a matrix to connect
 * Token is derived from matrix_id + hub secret for deterministic auth
 */
export function generateMatrixToken(matrixId: string): string {
  // Revoke any existing token for this matrix
  for (const [token, data] of matrixTokens.entries()) {
    if (data.matrixId === matrixId) {
      matrixTokens.delete(token);
    }
  }

  // Generate deterministic token based on matrix ID and secret
  // This allows reconnection with same token if matrix ID is known
  const token = createHash('sha256')
    .update(matrixId + HUB_SECRET + Date.now())
    .digest('hex');

  const now = new Date();
  matrixTokens.set(token, {
    token,
    matrixId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TOKEN_EXPIRY_MS),
  });

  return token;
}

/**
 * Validate a token and return the matrix ID if valid
 */
function validateToken(token: string): string | null {
  const data = matrixTokens.get(token);
  if (!data) return null;

  if (new Date() > data.expiresAt) {
    matrixTokens.delete(token);
    return null;
  }

  return data.matrixId;
}

// ============ Connection Management ============

/**
 * Check if a matrix is connected via WebSocket
 */
export function isMatrixConnected(matrixId: string): boolean {
  return connectedMatrices.has(matrixId);
}

/**
 * Get all connected matrix IDs
 */
export function getConnectedMatrixIds(): string[] {
  return Array.from(connectedMatrices.keys());
}

/**
 * Get connection stats
 */
export function getConnectionStats(): {
  connectedCount: number;
  matrices: Array<{ id: string; displayName?: string; connectedAt: Date; lastPing: Date }>;
} {
  const matrices = Array.from(connectedMatrices.entries()).map(([id, conn]) => ({
    id,
    displayName: conn.displayName,
    connectedAt: conn.connectedAt,
    lastPing: conn.lastPing,
  }));

  return {
    connectedCount: connectedMatrices.size,
    matrices,
  };
}

// ============ Message Delivery ============

/**
 * Send a message to a specific matrix via WebSocket
 * Returns true if delivered, false if matrix not connected
 */
export function sendToMatrix(matrixId: string, message: HubToMatrixMessage): boolean {
  const conn = connectedMatrices.get(matrixId);
  if (!conn) return false;

  try {
    conn.ws.send(JSON.stringify(message));
    return true;
  } catch (error) {
    console.error(`[Hub] Failed to send to matrix ${matrixId}:`, error);
    connectedMatrices.delete(matrixId);
    updateMatrixStatus(matrixId, 'offline');
    return false;
  }
}

/**
 * Broadcast a message to all connected matrices
 * Returns list of matrix IDs that received the message
 */
export function broadcastToMatrices(message: HubToMatrixMessage, excludeMatrixId?: string): string[] {
  const delivered: string[] = [];

  for (const [matrixId] of connectedMatrices) {
    if (matrixId === excludeMatrixId) continue;
    if (sendToMatrix(matrixId, message)) {
      delivered.push(matrixId);
    }
  }

  return delivered;
}

/**
 * Notify all matrices of a presence change
 */
function notifyPresenceChange(matrixId: string, status: MatrixStatus, displayName?: string): void {
  broadcastToMatrices({
    type: 'presence',
    matrix_id: matrixId,
    status,
    display_name: displayName,
  }, matrixId);
}

// ============ WebSocket Hub Server ============

/**
 * Start the matrix hub server
 */
export function startHub(port = HUB_PORT): void {
  if (server) {
    console.log('[Hub] Server already running');
    return;
  }

  server = Bun.serve({
    port,

    fetch(req, server) {
      const url = new URL(req.url);

      // Health check endpoint
      if (url.pathname === '/health') {
        // Mark stale matrices as offline
        const staleCount = markStaleMatricesOffline(HEARTBEAT_TIMEOUT_MS / 1000);
        if (staleCount > 0) {
          console.log(`[Hub] Marked ${staleCount} stale matrices as offline`);
        }

        return new Response(JSON.stringify({
          status: 'healthy',
          connectedMatrices: connectedMatrices.size,
          uptime: process.uptime(),
          online: getConnectedMatrixIds(),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Token endpoint for matrices to get their token
      if (url.pathname === '/register') {
        const matrixId = url.searchParams.get('matrix_id');
        const displayName = url.searchParams.get('display_name');

        if (!matrixId) {
          return new Response(JSON.stringify({ error: 'Missing matrix_id' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Register matrix in SQLite
        registerMatrix(matrixId, displayName || undefined);

        // Generate connection token
        const token = generateMatrixToken(matrixId);

        return new Response(JSON.stringify({ token, matrix_id: matrixId }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // List online matrices endpoint
      if (url.pathname === '/matrices') {
        return new Response(JSON.stringify({
          online: getConnectedMatrixIds(),
          all: getOnlineMatrices(),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // WebSocket upgrade
      const token = url.searchParams.get('token');
      if (!token) {
        return new Response('Missing token', { status: 401 });
      }

      const matrixId = validateToken(token);
      if (matrixId === null) {
        return new Response('Invalid or expired token', { status: 401 });
      }

      const displayName = url.searchParams.get('display_name');

      // Upgrade to WebSocket
      const upgraded = server.upgrade(req, {
        data: { matrixId, token, displayName },
      });

      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      return undefined;
    },

    websocket: {
      open(ws) {
        const { matrixId, displayName } = ws.data as { matrixId: string; displayName?: string };

        // Close existing connection for this matrix
        const existing = connectedMatrices.get(matrixId);
        if (existing) {
          try {
            existing.ws.close(1000, 'Replaced by new connection');
          } catch {}
        }

        const now = new Date();
        connectedMatrices.set(matrixId, {
          ws,
          matrixId,
          displayName,
          connectedAt: now,
          lastPing: now,
        });

        // Update SQLite registry
        registerMatrix(matrixId, displayName);
        updateMatrixStatus(matrixId, 'online');

        console.log(`[Hub] Matrix ${matrixId} connected (total: ${connectedMatrices.size})`);

        // Send registration confirmation with list of online matrices
        const onlineMatrices = getConnectedMatrixIds().filter(id => id !== matrixId);
        sendToMatrix(matrixId, {
          type: 'registered',
          matrix_id: matrixId,
          online_matrices: onlineMatrices,
        });

        // Notify other matrices of new connection
        notifyPresenceChange(matrixId, 'online', displayName);
      },

      message(ws, rawMessage) {
        const { matrixId } = ws.data as { matrixId: string };

        try {
          const message = JSON.parse(String(rawMessage)) as MatrixToHubMessage;

          // Update heartbeat
          const conn = connectedMatrices.get(matrixId);
          if (conn) {
            conn.lastPing = new Date();
          }
          touchMatrix(matrixId);

          switch (message.type) {
            case 'pong':
              // Heartbeat response, already handled above
              break;

            case 'presence':
              // Matrix updating its presence status
              const status = message.status === 'away' ? 'away' : 'online';
              updateMatrixStatus(matrixId, status);
              notifyPresenceChange(matrixId, status, conn?.displayName);
              break;

            case 'message':
              // Cross-matrix message
              const timestamp = new Date().toISOString();
              const outgoingMessage: HubToMatrixMessage = {
                type: 'message',
                from: matrixId,
                content: message.content,
                timestamp,
                metadata: message.metadata,
              };

              if (message.to) {
                // Direct message to specific matrix
                const delivered = sendToMatrix(message.to, outgoingMessage);
                if (!delivered) {
                  sendToMatrix(matrixId, {
                    type: 'error',
                    code: 'DELIVERY_FAILED',
                    message: `Matrix ${message.to} is not connected`,
                  });
                }
                console.log(`[Hub] Message from ${matrixId} to ${message.to}: ${delivered ? 'delivered' : 'failed'}`);
              } else {
                // Broadcast to all other matrices
                const delivered = broadcastToMatrices(outgoingMessage, matrixId);
                console.log(`[Hub] Broadcast from ${matrixId} to ${delivered.length} matrices`);
              }
              break;

            default:
              console.warn(`[Hub] Unknown message type from ${matrixId}:`, message);
          }
        } catch (error) {
          console.error(`[Hub] Invalid message from matrix ${matrixId}:`, error);
          sendToMatrix(matrixId, {
            type: 'error',
            code: 'INVALID_MESSAGE',
            message: 'Failed to parse message',
          });
        }
      },

      close(ws, code, reason) {
        const { matrixId, displayName } = ws.data as { matrixId: string; displayName?: string };
        connectedMatrices.delete(matrixId);
        updateMatrixStatus(matrixId, 'offline');

        console.log(`[Hub] Matrix ${matrixId} disconnected (code: ${code}, reason: ${reason || 'none'})`);

        // Notify other matrices
        notifyPresenceChange(matrixId, 'offline', displayName);
      },

      error(ws, error) {
        const { matrixId } = ws.data as { matrixId: string };
        console.error(`[Hub] Error for matrix ${matrixId}:`, error);
      },
    },
  });

  console.log(`[Hub] Server started on port ${port}`);

  // Start heartbeat interval to detect dead connections
  heartbeatInterval = setInterval(() => {
    const now = new Date();

    for (const [matrixId, conn] of connectedMatrices) {
      // Check for dead connections
      if (now.getTime() - conn.lastPing.getTime() > HEARTBEAT_TIMEOUT_MS) {
        console.log(`[Hub] Matrix ${matrixId} timed out, disconnecting`);
        try {
          conn.ws.close(1000, 'Ping timeout');
        } catch {}
        connectedMatrices.delete(matrixId);
        updateMatrixStatus(matrixId, 'offline');
        notifyPresenceChange(matrixId, 'offline', conn.displayName);
        continue;
      }

      // Send ping
      try {
        conn.ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        connectedMatrices.delete(matrixId);
        updateMatrixStatus(matrixId, 'offline');
      }
    }

    // Also clean up stale entries in SQLite
    markStaleMatricesOffline(HEARTBEAT_TIMEOUT_MS / 1000);
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the hub server
 */
export function stopHub(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (!server) return;

  // Mark all connected matrices as offline
  for (const [matrixId, conn] of connectedMatrices) {
    try {
      conn.ws.close(1000, 'Server shutting down');
    } catch {}
    updateMatrixStatus(matrixId, 'offline');
  }
  connectedMatrices.clear();

  server.stop();
  server = null;
  console.log('[Hub] Server stopped');
}

/**
 * Check if hub is running
 */
export function isHubRunning(): boolean {
  return server !== null;
}

// ============ Auto-start if run directly ============

if (import.meta.main) {
  console.log('╔══════════════════════════════════════╗');
  console.log('║      MATRIX HUB SERVER               ║');
  console.log('║   Cross-Matrix Communication         ║');
  console.log('╚══════════════════════════════════════╝');
  console.log();

  startHub();

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stopHub();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    stopHub();
    process.exit(0);
  });

  console.log(`Matrix Hub running on ws://localhost:${HUB_PORT}`);
  console.log('Endpoints:');
  console.log(`  GET /health - Health check`);
  console.log(`  GET /register?matrix_id=X&display_name=Y - Register and get token`);
  console.log(`  GET /matrices - List online matrices`);
  console.log(`  WS /?token=XXX - WebSocket connection`);
  console.log();
}
