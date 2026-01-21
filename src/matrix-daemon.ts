/**
 * Matrix Daemon - Persistent WebSocket connection manager
 *
 * Runs as background process, maintains single persistent connection to hub.
 * CLI commands communicate with daemon via local HTTP API.
 *
 * Usage:
 *   bun run src/matrix-daemon.ts start   # Start daemon
 *   bun run src/matrix-daemon.ts stop    # Stop daemon
 *   bun run src/matrix-daemon.ts status  # Check status
 */

import { WebSocket } from 'ws';
import { createServer, type Server } from 'http';
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ============ Configuration ============

const DAEMON_PORT = parseInt(process.env.MATRIX_DAEMON_PORT || '37888');
const HUB_URL = process.env.MATRIX_HUB_URL || 'ws://localhost:8081';
const RECONNECT_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 30000;

// Use home directory for persistence across reboots
const DAEMON_DIR = join(process.env.HOME || '/tmp', '.matrix-daemon');
const PID_FILE = join(DAEMON_DIR, 'daemon.pid');
const SOCKET_FILE = join(DAEMON_DIR, 'daemon.sock');

// Determine matrix ID from project path
const PROJECT_PATH = process.cwd();
const MATRIX_ID = PROJECT_PATH.replace(/.*\//, ''); // Last path component

// ============ State ============

let ws: WebSocket | null = null;
let connected = false;
let token: string | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let httpServer: Server | null = null;

const messageQueue: Array<{ type: 'broadcast' | 'direct'; content: string; to?: string }> = [];
const receivedMessages: Array<{ from: string; content: string; timestamp: string; type: string }> = [];

// ============ Hub Connection ============

async function getToken(): Promise<string | null> {
  try {
    const httpUrl = HUB_URL.replace('ws://', 'http://').replace('wss://', 'https://');
    const params = new URLSearchParams({
      matrix_id: MATRIX_ID,
      display_name: MATRIX_ID,
      project_path: PROJECT_PATH,
    });

    const response = await fetch(`${httpUrl}/register?${params}`);

    if (!response.ok) {
      console.error(`[Daemon] Failed to get token: ${response.status}`);
      return null;
    }

    const data = await response.json() as { token: string };
    return data.token;
  } catch (error) {
    console.error(`[Daemon] Token request failed:`, error);
    return null;
  }
}

async function connectToHub(): Promise<boolean> {
  if (ws && connected) return true;

  token = await getToken();
  if (!token) {
    scheduleReconnect();
    return false;
  }

  return new Promise((resolve) => {
    try {
      ws = new WebSocket(`${HUB_URL}?token=${token}`);

      ws.on('open', () => {
        console.log(`[Daemon] Connected to hub at ${HUB_URL}`);
        connected = true;
        startHeartbeat();
        flushMessageQueue();
        resolve(true);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          handleMessage(msg);
        } catch (e) {
          console.error('[Daemon] Invalid message:', e);
        }
      });

      ws.on('close', (code, reason) => {
        console.log(`[Daemon] Disconnected: ${code} ${reason}`);
        connected = false;
        ws = null;
        stopHeartbeat();
        scheduleReconnect();
      });

      ws.on('error', (error) => {
        console.error('[Daemon] WebSocket error:', error);
        connected = false;
      });

      // Timeout for connection
      setTimeout(() => {
        if (!connected) {
          ws?.close();
          resolve(false);
        }
      }, 10000);

    } catch (error) {
      console.error('[Daemon] Connection failed:', error);
      scheduleReconnect();
      resolve(false);
    }
  });
}

function scheduleReconnect(): void {
  if (reconnectTimeout) return;

  reconnectTimeout = setTimeout(async () => {
    reconnectTimeout = null;
    console.log('[Daemon] Attempting reconnection...');
    await connectToHub();
  }, RECONNECT_INTERVAL);
}

function startHeartbeat(): void {
  if (heartbeatInterval) return;

  heartbeatInterval = setInterval(() => {
    if (ws && connected) {
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ============ Message Handling ============

function handleMessage(msg: any): void {
  if (msg.type === 'message' || msg.type === 'broadcast' || msg.type === 'direct') {
    const received = {
      from: msg.from || 'unknown',
      content: msg.content || '',
      timestamp: new Date().toISOString(),
      type: msg.type,
    };
    receivedMessages.unshift(received);

    // Keep only last 100 messages
    if (receivedMessages.length > 100) {
      receivedMessages.pop();
    }

    console.log(`[Daemon] 📬 Message from ${received.from}: ${received.content.substring(0, 50)}...`);
  } else if (msg.type === 'presence') {
    console.log(`[Daemon] 👤 ${msg.matrixId} is now ${msg.status}`);
  } else if (msg.type === 'pong') {
    // Heartbeat response
  }
}

function sendMessage(type: 'broadcast' | 'direct', content: string, to?: string): boolean {
  if (!ws || !connected) {
    // Queue for later
    messageQueue.push({ type, content, to });
    console.log(`[Daemon] Queued message (not connected)`);
    return false;
  }

  try {
    const payload = type === 'broadcast'
      ? { type: 'broadcast', content }
      : { type: 'direct', to, content };

    ws.send(JSON.stringify(payload));
    console.log(`[Daemon] Sent ${type}: ${content.substring(0, 50)}...`);
    return true;
  } catch (error) {
    console.error('[Daemon] Send failed:', error);
    messageQueue.push({ type, content, to });
    return false;
  }
}

function flushMessageQueue(): void {
  while (messageQueue.length > 0 && connected) {
    const msg = messageQueue.shift()!;
    sendMessage(msg.type, msg.content, msg.to);
  }
}

// ============ HTTP API Server ============

function startHttpServer(): void {
  httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${DAEMON_PORT}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    // Health check
    if (url.pathname === '/health' || url.pathname === '/status') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'running',
        connected,
        matrixId: MATRIX_ID,
        hubUrl: HUB_URL,
        queuedMessages: messageQueue.length,
        receivedMessages: receivedMessages.length,
      }));
      return;
    }

    // Send broadcast
    if (url.pathname === '/broadcast' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const sent = sendMessage('broadcast', data.content);
          res.writeHead(sent ? 200 : 202);
          res.end(JSON.stringify({ sent, queued: !sent }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Send direct message
    if (url.pathname === '/send' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const sent = sendMessage('direct', data.content, data.to);
          res.writeHead(sent ? 200 : 202);
          res.end(JSON.stringify({ sent, queued: !sent }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Get inbox
    if (url.pathname === '/inbox') {
      const limit = parseInt(url.searchParams.get('limit') || '20');
      res.writeHead(200);
      res.end(JSON.stringify({
        messages: receivedMessages.slice(0, limit),
        total: receivedMessages.length,
      }));
      return;
    }

    // Get connected matrices (if supported by hub)
    if (url.pathname === '/matrices') {
      res.writeHead(200);
      res.end(JSON.stringify({ note: 'Query hub directly for matrices list' }));
      return;
    }

    // Reconnect
    if (url.pathname === '/reconnect' && req.method === 'POST') {
      if (ws) ws.close();
      connected = false;
      await connectToHub();
      res.writeHead(200);
      res.end(JSON.stringify({ connected }));
      return;
    }

    // Stop daemon
    if (url.pathname === '/stop' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'stopping' }));
      shutdown();
      return;
    }

    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(DAEMON_PORT, () => {
    console.log(`[Daemon] HTTP API listening on port ${DAEMON_PORT}`);
  });
}

// ============ Daemon Lifecycle ============

function writePidFile(): void {
  const pidDir = dirname(PID_FILE);
  if (!existsSync(pidDir)) {
    mkdirSync(pidDir, { recursive: true });
  }
  writeFileSync(PID_FILE, `${process.pid}\n${DAEMON_PORT}\n${MATRIX_ID}`);
}

function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {}
}

function isRunning(): { running: boolean; pid?: number; port?: number } {
  if (!existsSync(PID_FILE)) {
    return { running: false };
  }

  try {
    const content = readFileSync(PID_FILE, 'utf-8').trim().split('\n');
    const pid = parseInt(content[0] || '0');
    const port = parseInt(content[1] || '0');

    // Check if process is running
    try {
      process.kill(pid, 0);
      return { running: true, pid, port };
    } catch {
      // Process not running, clean up stale PID file
      removePidFile();
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

async function start(): Promise<void> {
  const status = isRunning();
  if (status.running) {
    console.log(`[Daemon] Already running (PID: ${status.pid}, Port: ${status.port})`);
    process.exit(0);
  }

  console.log(`[Daemon] Starting matrix daemon for ${MATRIX_ID}`);
  console.log(`[Daemon] PID: ${process.pid}`);
  console.log(`[Daemon] API Port: ${DAEMON_PORT}`);
  console.log(`[Daemon] Hub URL: ${HUB_URL}`);

  writePidFile();
  startHttpServer();
  await connectToHub();

  // Handle shutdown signals
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function shutdown(): void {
  console.log('[Daemon] Shutting down...');

  stopHeartbeat();

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  if (ws) {
    ws.close(1000, 'Daemon shutdown');
  }

  if (httpServer) {
    httpServer.close();
  }

  removePidFile();
  process.exit(0);
}

async function stop(): Promise<void> {
  const status = isRunning();
  if (!status.running) {
    console.log('[Daemon] Not running');
    process.exit(0);
  }

  try {
    // Try graceful shutdown via API
    const response = await fetch(`http://localhost:${status.port}/stop`, { method: 'POST' });
    if (response.ok) {
      console.log('[Daemon] Stopped gracefully');
    }
  } catch {
    // Force kill
    try {
      process.kill(status.pid!, 'SIGTERM');
      console.log(`[Daemon] Sent SIGTERM to PID ${status.pid}`);
    } catch (e) {
      console.error('[Daemon] Failed to stop:', e);
    }
  }

  removePidFile();
}

function showStatus(): void {
  const status = isRunning();
  if (!status.running) {
    console.log('[Daemon] Status: Not running');
    process.exit(1);
  }

  console.log(`[Daemon] Status: Running`);
  console.log(`  PID: ${status.pid}`);
  console.log(`  Port: ${status.port}`);

  // Try to get detailed status from API
  fetch(`http://localhost:${status.port}/status`)
    .then(res => res.json())
    .then((data: any) => {
      console.log(`  Connected: ${data.connected}`);
      console.log(`  Matrix ID: ${data.matrixId}`);
      console.log(`  Hub URL: ${data.hubUrl}`);
      console.log(`  Queued: ${data.queuedMessages}`);
      console.log(`  Inbox: ${data.receivedMessages}`);
    })
    .catch(() => {
      console.log('  (Could not fetch detailed status)');
    });
}

// ============ CLI Entry Point ============

const command = process.argv[2];

switch (command) {
  case 'start':
    start();
    break;
  case 'stop':
    stop();
    break;
  case 'status':
    showStatus();
    break;
  case 'restart':
    stop().then(() => setTimeout(start, 1000));
    break;
  default:
    console.log(`
Matrix Daemon - Persistent hub connection

Usage:
  bun run src/matrix-daemon.ts start    Start daemon
  bun run src/matrix-daemon.ts stop     Stop daemon
  bun run src/matrix-daemon.ts status   Check status
  bun run src/matrix-daemon.ts restart  Restart daemon

Environment:
  MATRIX_DAEMON_PORT  Local API port (default: 37888)
  MATRIX_HUB_URL      Hub WebSocket URL (default: ws://localhost:8081)
`);
}
