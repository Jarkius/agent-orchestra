/**
 * Matrix Hub - Cross-Matrix WebSocket Communication Server
 * Provides real-time messaging between multiple matrix instances (Claude clones)
 *
 * Phase 3: Dedicated hub process for matrix-to-matrix communication
 * Follows the same patterns as ws-server.ts but for matrices instead of agents
 *
 * TLS Support:
 *   Enable secure WebSocket (wss://) by setting:
 *   - MATRIX_HUB_TLS_CERT: Path to PEM certificate file
 *   - MATRIX_HUB_TLS_KEY: Path to PEM private key file
 *   - MATRIX_HUB_TLS_PASSPHRASE: (optional) Passphrase for encrypted key
 *
 *   Or programmatically via startHub({ tls: { cert, key, passphrase } })
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
const HUB_HOST = process.env.MATRIX_HUB_HOST || 'localhost'; // Use '0.0.0.0' for LAN access
const HUB_SECRET = process.env.MATRIX_HUB_SECRET || 'default-hub-secret-change-me';
const TOKEN_EXPIRY_MS = parseInt(process.env.MATRIX_TOKEN_EXPIRY_HOURS || '2') * 60 * 60 * 1000; // Default 2 hours
const HEARTBEAT_INTERVAL_MS = 10000; // 10 seconds
const HEARTBEAT_TIMEOUT_MS = 30000; // 30 seconds

// TLS Configuration - enables wss:// secure WebSocket connections
// Set both MATRIX_HUB_TLS_CERT and MATRIX_HUB_TLS_KEY to enable TLS
const TLS_CERT_PATH = process.env.MATRIX_HUB_TLS_CERT;
const TLS_KEY_PATH = process.env.MATRIX_HUB_TLS_KEY;
const TLS_PASSPHRASE = process.env.MATRIX_HUB_TLS_PASSPHRASE; // Optional passphrase for encrypted key

// PIN Authentication - like WiFi password for the hub
// These are read at startup but can be overridden by startHub config for testing
let pinDisabled = process.env.MATRIX_HUB_PIN === 'disabled';
let hubPin = pinDisabled ? '' : (process.env.MATRIX_HUB_PIN || generateRandomPin());

function generateRandomPin(): string {
  // Generate 6-character alphanumeric PIN (uppercase for readability)
  return randomBytes(4).toString('hex').substring(0, 6).toUpperCase();
}

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
  | { type: 'ping' }  // Client-initiated heartbeat (hub responds with ping)
  | { type: 'presence'; status: 'online' | 'away' };

// ============ State ============

const connectedMatrices = new Map<string, MatrixConnection>();
const matrixTokens = new Map<string, MatrixToken>();
let server: ReturnType<typeof Bun.serve> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

// ============ Token Management ============

// Grace period for old tokens during reconnection (30 seconds)
const TOKEN_GRACE_PERIOD_MS = 30000;

/**
 * Generate a token for a matrix to connect
 * Token is derived from matrix_id + hub secret for deterministic auth
 */
export function generateMatrixToken(matrixId: string): string {
  const now = new Date();

  // Keep old tokens valid for grace period instead of immediate deletion
  // This helps with reconnection race conditions
  for (const [existingToken, data] of matrixTokens.entries()) {
    if (data.matrixId === matrixId) {
      const tokenAge = now.getTime() - data.createdAt.getTime();
      if (tokenAge > TOKEN_GRACE_PERIOD_MS) {
        // Old token - delete it
        matrixTokens.delete(existingToken);
      }
      // Recent tokens kept valid during grace period
    }
  }

  // Generate deterministic token based on matrix ID and secret
  // This allows reconnection with same token if matrix ID is known
  const token = createHash('sha256')
    .update(matrixId + HUB_SECRET)
    .digest('hex');

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

export interface TlsConfig {
  cert: string;  // Path to certificate file (PEM format)
  key: string;   // Path to private key file (PEM format)
  passphrase?: string;  // Optional passphrase for encrypted private key
}

export interface HubConfig {
  port?: number;
  hostname?: string;
  disablePin?: boolean; // For testing - disable PIN authentication
  tls?: TlsConfig;      // TLS/SSL configuration for secure connections (wss://)
}

/**
 * Start the matrix hub server
 */
export function startHub(portOrConfig?: number | HubConfig, hostname?: string): void {
  // Handle both legacy (port, hostname) and new (config) signatures
  let port = HUB_PORT;
  let host = HUB_HOST;
  let tlsConfig: TlsConfig | undefined;

  if (typeof portOrConfig === 'object') {
    port = portOrConfig.port ?? HUB_PORT;
    host = portOrConfig.hostname ?? HUB_HOST;
    if (portOrConfig.disablePin) {
      pinDisabled = true;
    }
    tlsConfig = portOrConfig.tls;
  } else if (typeof portOrConfig === 'number') {
    port = portOrConfig;
    host = hostname ?? HUB_HOST;
  }

  // Check for TLS config from environment if not provided in config
  if (!tlsConfig && TLS_CERT_PATH && TLS_KEY_PATH) {
    tlsConfig = {
      cert: TLS_CERT_PATH,
      key: TLS_KEY_PATH,
      passphrase: TLS_PASSPHRASE,
    };
  }

  if (server) {
    console.log('[Hub] Server already running');
    return;
  }

  // Build TLS options for Bun.serve if configured
  const tlsOptions = tlsConfig ? {
    tls: {
      cert: Bun.file(tlsConfig.cert),
      key: Bun.file(tlsConfig.key),
      passphrase: tlsConfig.passphrase,
    },
  } : {};

  server = Bun.serve({
    port,
    hostname: host,
    ...tlsOptions,

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
        const pin = url.searchParams.get('pin');

        // Validate PIN if enabled
        if (!pinDisabled) {
          if (!pin || pin !== hubPin) {
            return new Response(JSON.stringify({
              error: 'Invalid or missing PIN',
              hint: 'Check the hub console for the PIN, or set MATRIX_HUB_PIN in your environment'
            }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }

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

        // Close existing connection for this matrix with grace period
        const existing = connectedMatrices.get(matrixId);
        if (existing && existing.ws !== ws) {
          // Grace period: wait 2 seconds before closing old connection
          // This allows reconnection attempts to stabilize
          console.log(`[Hub] Matrix ${matrixId} reconnecting, closing old connection after grace period`);
          const oldWs = existing.ws;
          setTimeout(() => {
            try {
              // Only close if this old connection is still around
              if (oldWs.readyState === 1) { // OPEN
                oldWs.close(1000, 'Replaced by new connection');
              }
            } catch {}
          }, 2000);
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

            case 'ping':
              // Client-initiated ping, respond with ping
              sendToMatrix(matrixId, { type: 'ping' });
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

  console.log(`[Hub] Server started on ${hostname}:${port}`);

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

/**
 * Check if TLS/SSL is enabled for secure WebSocket connections
 * Returns true if both cert and key paths are configured
 */
export function isTlsEnabled(): boolean {
  return !!(TLS_CERT_PATH && TLS_KEY_PATH);
}

/**
 * Get the hub URL with correct protocol (ws:// or wss://)
 */
export function getHubUrl(): string {
  const protocol = isTlsEnabled() ? 'wss' : 'ws';
  return `${protocol}://${HUB_HOST}:${HUB_PORT}`;
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

  const displayHost = HUB_HOST === '0.0.0.0' ? 'all interfaces' : HUB_HOST;
  const tlsEnabled = !!(TLS_CERT_PATH && TLS_KEY_PATH);
  const protocol = tlsEnabled ? 'wss' : 'ws';
  console.log(`Matrix Hub running on ${protocol}://${HUB_HOST}:${HUB_PORT}`);
  console.log(`  Binding: ${displayHost}`);
  if (tlsEnabled) {
    console.log(`  🔒 TLS enabled (secure WebSocket)`);
  }
  if (HUB_HOST === 'localhost') {
    console.log(`  Tip: Use MATRIX_HUB_HOST=0.0.0.0 for LAN access`);
  }

  // Display PIN authentication info
  if (pinDisabled) {
    console.log();
    console.log('  ⚠️  PIN authentication DISABLED (open hub)');
  } else {
    console.log();
    console.log(`  🔐 Hub PIN: ${hubPin}`);
    console.log(`     Share this PIN with matrices that need to connect.`);
    console.log(`     Set MATRIX_HUB_PIN=disabled for open access.`);
  }

  // TLS configuration hints
  if (!tlsEnabled) {
    console.log();
    console.log('  💡 TLS disabled. To enable secure connections:');
    console.log('     MATRIX_HUB_TLS_CERT=/path/to/cert.pem');
    console.log('     MATRIX_HUB_TLS_KEY=/path/to/key.pem');
  }

  console.log();
  console.log('Endpoints:');
  console.log(`  GET /health - Health check`);
  console.log(`  GET /register?matrix_id=X&display_name=Y&pin=XXX - Register and get token`);
  console.log(`  GET /matrices - List online matrices`);
  console.log(`  WS /?token=XXX - WebSocket connection`);
  console.log();
}
