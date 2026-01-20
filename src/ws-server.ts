/**
 * WebSocket Server for Agent Communication
 * Provides real-time task delivery with token-based authentication
 *
 * Phase 1: Run alongside file-based IPC as primary delivery method
 * File IPC remains as fallback for agents not connected via WebSocket
 */

import { randomBytes } from 'crypto';

// ============ Configuration ============

const WS_PORT = parseInt(process.env.WS_PORT || '8080');
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============ Types ============

interface AgentConnection {
  ws: any; // Bun WebSocket type
  agentId: number;
  connectedAt: Date;
  lastPing: Date;
}

interface AgentToken {
  token: string;
  agentId: number;
  createdAt: Date;
  expiresAt: Date;
}

interface TaskMessage {
  type: 'task';
  id: string;
  prompt: string;
  context?: string;
  priority?: 'low' | 'normal' | 'high';
  session_id?: string;
  auto_save_session?: boolean;
  assigned_at: string;
}

interface ResultMessage {
  type: 'result';
  taskId: string;
  status: 'completed' | 'error';
  output: string;
  duration_ms: number;
}

interface PingMessage {
  type: 'ping';
}

interface PongMessage {
  type: 'pong';
  agentId: number;
}

type IncomingMessage = ResultMessage | PongMessage;
type OutgoingMessage = TaskMessage | PingMessage;

// ============ State ============

const connectedAgents = new Map<number, AgentConnection>();
const agentTokens = new Map<string, AgentToken>();
let server: ReturnType<typeof Bun.serve> | null = null;
let resultHandler: ((agentId: number, result: ResultMessage) => void) | null = null;

// ============ Token Management ============

/**
 * Generate a token for an agent to connect
 * Called by spawn script or MCP tools
 */
export function generateAgentToken(agentId: number): string {
  // Revoke any existing token for this agent
  for (const [token, data] of agentTokens.entries()) {
    if (data.agentId === agentId) {
      agentTokens.delete(token);
    }
  }

  const token = randomBytes(32).toString('hex');
  const now = new Date();

  agentTokens.set(token, {
    token,
    agentId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TOKEN_EXPIRY_MS),
  });

  return token;
}

/**
 * Validate a token and return the agent ID if valid
 */
function validateToken(token: string): number | null {
  const data = agentTokens.get(token);
  if (!data) return null;

  if (new Date() > data.expiresAt) {
    agentTokens.delete(token);
    return null;
  }

  return data.agentId;
}

// ============ Connection Management ============

/**
 * Check if an agent is connected via WebSocket
 */
export function isAgentConnected(agentId: number): boolean {
  return connectedAgents.has(agentId);
}

/**
 * Get all connected agent IDs
 */
export function getConnectedAgents(): number[] {
  return Array.from(connectedAgents.keys());
}

/**
 * Get connection stats
 */
export function getConnectionStats(): {
  connectedCount: number;
  agents: Array<{ id: number; connectedAt: Date; lastPing: Date }>;
} {
  const agents = Array.from(connectedAgents.entries()).map(([id, conn]) => ({
    id,
    connectedAt: conn.connectedAt,
    lastPing: conn.lastPing,
  }));

  return {
    connectedCount: connectedAgents.size,
    agents,
  };
}

// ============ Task Delivery ============

/**
 * Send a task to an agent via WebSocket
 * Returns true if delivered, false if agent not connected
 */
export function sendTaskToAgent(agentId: number, task: Omit<TaskMessage, 'type'>): boolean {
  const conn = connectedAgents.get(agentId);
  if (!conn) return false;

  try {
    const message: TaskMessage = { type: 'task', ...task };
    conn.ws.send(JSON.stringify(message));
    console.log(`[WS] Task ${task.id} sent to Agent ${agentId}`);
    return true;
  } catch (error) {
    console.error(`[WS] Failed to send task to Agent ${agentId}:`, error);
    connectedAgents.delete(agentId);
    return false;
  }
}

/**
 * Broadcast a task to all connected agents
 * Returns list of agent IDs that received the task
 */
export function broadcastTask(task: Omit<TaskMessage, 'type'>): number[] {
  const delivered: number[] = [];

  for (const [agentId] of connectedAgents) {
    if (sendTaskToAgent(agentId, task)) {
      delivered.push(agentId);
    }
  }

  return delivered;
}

/**
 * Set handler for incoming results from agents
 */
export function onResult(handler: (agentId: number, result: ResultMessage) => void): void {
  resultHandler = handler;
}

// ============ WebSocket Server ============

/**
 * Start the WebSocket server
 */
export function startServer(port = WS_PORT): void {
  if (server) {
    console.log('[WS] Server already running');
    return;
  }

  server = Bun.serve({
    port,

    fetch(req, server) {
      const url = new URL(req.url);

      // Health check endpoint
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({
          status: 'healthy',
          connectedAgents: connectedAgents.size,
          uptime: process.uptime(),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Token endpoint for agents to get their token
      if (url.pathname === '/token') {
        const agentId = parseInt(url.searchParams.get('agent_id') || '0');
        if (!agentId) {
          return new Response('Missing agent_id', { status: 400 });
        }
        const token = generateAgentToken(agentId);
        return new Response(JSON.stringify({ token }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // WebSocket upgrade
      const token = url.searchParams.get('token');
      if (!token) {
        return new Response('Missing token', { status: 401 });
      }

      const agentId = validateToken(token);
      if (agentId === null) {
        return new Response('Invalid or expired token', { status: 401 });
      }

      // Upgrade to WebSocket
      const upgraded = server.upgrade(req, {
        data: { agentId, token },
      });

      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      return undefined;
    },

    websocket: {
      open(ws) {
        const { agentId } = ws.data as { agentId: number };

        // Close existing connection for this agent
        const existing = connectedAgents.get(agentId);
        if (existing) {
          try {
            existing.ws.close(1000, 'Replaced by new connection');
          } catch {}
        }

        const now = new Date();
        connectedAgents.set(agentId, {
          ws,
          agentId,
          connectedAt: now,
          lastPing: now,
        });

        console.log(`[WS] Agent ${agentId} connected (total: ${connectedAgents.size})`);
      },

      message(ws, message) {
        const { agentId } = ws.data as { agentId: number };

        try {
          const data = JSON.parse(String(message)) as IncomingMessage;

          if (data.type === 'pong') {
            const conn = connectedAgents.get(agentId);
            if (conn) {
              conn.lastPing = new Date();
            }
          } else if (data.type === 'result') {
            console.log(`[WS] Result from Agent ${agentId}: task ${data.taskId} ${data.status}`);
            resultHandler?.(agentId, data);
          }
        } catch (error) {
          console.error(`[WS] Invalid message from Agent ${agentId}:`, error);
        }
      },

      close(ws, code, reason) {
        const { agentId } = ws.data as { agentId: number };
        connectedAgents.delete(agentId);
        console.log(`[WS] Agent ${agentId} disconnected (code: ${code}, reason: ${reason || 'none'})`);
      },

      error(ws, error) {
        const { agentId } = ws.data as { agentId: number };
        console.error(`[WS] Error for Agent ${agentId}:`, error);
      },
    },
  });

  console.log(`[WS] Server started on port ${port}`);

  // Start ping interval to detect dead connections
  setInterval(() => {
    const now = new Date();
    const timeout = 30000; // 30 seconds

    for (const [agentId, conn] of connectedAgents) {
      // Check for dead connections
      if (now.getTime() - conn.lastPing.getTime() > timeout) {
        console.log(`[WS] Agent ${agentId} timed out, disconnecting`);
        try {
          conn.ws.close(1000, 'Ping timeout');
        } catch {}
        connectedAgents.delete(agentId);
        continue;
      }

      // Send ping
      try {
        conn.ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        connectedAgents.delete(agentId);
      }
    }
  }, 10000); // Every 10 seconds
}

/**
 * Stop the WebSocket server
 */
export function stopServer(): void {
  if (!server) return;

  // Close all connections
  for (const [, conn] of connectedAgents) {
    try {
      conn.ws.close(1000, 'Server shutting down');
    } catch {}
  }
  connectedAgents.clear();

  server.stop();
  server = null;
  console.log('[WS] Server stopped');
}

/**
 * Check if server is running
 */
export function isServerRunning(): boolean {
  return server !== null;
}

// ============ Auto-start if run directly ============

if (import.meta.main) {
  console.log('Starting WebSocket server...');
  startServer();

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stopServer();
    process.exit(0);
  });

  console.log(`WebSocket server running on ws://localhost:${WS_PORT}`);
  console.log('Endpoints:');
  console.log(`  GET /health - Health check`);
  console.log(`  GET /token?agent_id=N - Get token for agent`);
  console.log(`  WS /?token=XXX - WebSocket connection`);
}
