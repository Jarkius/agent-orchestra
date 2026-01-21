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
import { exec } from 'child_process';
import {
  saveIncomingMessage,
  saveMatrixMessage,
  markMessageSent,
  markMessageFailed,
  incrementMessageRetry,
  getPendingMessages,
  getUnreadCount,
  getInboxMessages,
  markMessagesRead,
  type MatrixMessageRecord
} from './db';

// ============ Configuration ============

// Load .matrix.json config if it exists
const CONFIG_FILE = join(process.cwd(), '.matrix.json');
const matrixConfig = existsSync(CONFIG_FILE)
  ? JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  : {};

const DAEMON_PORT = parseInt(process.env.MATRIX_DAEMON_PORT || matrixConfig.daemon_port || '37888');
const HUB_URL = process.env.MATRIX_HUB_URL || matrixConfig.hub_url || 'ws://localhost:8081';
const RECONNECT_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 15000; // Must be less than hub's 30s timeout
const RETRY_INTERVAL = 10000; // Retry failed messages every 10s
const MAX_RETRIES = 3;
const ENABLE_BELL = process.env.MATRIX_BELL !== 'false'; // Terminal bell
const ENABLE_MACOS_NOTIFY = process.env.MATRIX_MACOS_NOTIFY === 'true'; // macOS notification center

// Use home directory for persistence across reboots
const DEFAULT_DAEMON_DIR = join(process.env.HOME || '/tmp', '.matrix-daemon');
const DAEMON_DIR = process.env.MATRIX_DAEMON_DIR ||
  (matrixConfig.daemon_dir ? matrixConfig.daemon_dir.replace('~', process.env.HOME || '') : DEFAULT_DAEMON_DIR);
const PID_FILE = join(DAEMON_DIR, 'daemon.pid');
const SOCKET_FILE = join(DAEMON_DIR, 'daemon.sock');

// Determine matrix ID from config or project path
const PROJECT_PATH = process.cwd();
const MATRIX_ID = matrixConfig.matrix_id || PROJECT_PATH.replace(/.*\//, ''); // Last path component

// ============ State ============

let ws: WebSocket | null = null;
let connected = false;
let token: string | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let retryInterval: ReturnType<typeof setInterval> | null = null;
let httpServer: Server | null = null;

const messageQueue: Array<{ type: 'broadcast' | 'direct'; content: string; to?: string; id?: string }> = [];
const receivedMessages: Array<{ from: string; content: string; timestamp: string; type: string; id?: string }> = [];

// SSE clients for real-time streaming
import type { ServerResponse } from 'http';
const sseClients = new Set<ServerResponse>();

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
        startRetryLoop();
        flushMessageQueue();
        retryPendingMessages(); // Retry any pending from DB immediately
        resolve(true);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          console.log(`[Daemon] WS received: ${msg.type} from ${msg.from || 'hub'}`);
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
        stopRetryLoop();
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
      // Send JSON ping (hub expects this format, not WebSocket ping frames)
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ============ Notification Helpers ============

function sendTerminalBell(): void {
  if (ENABLE_BELL) {
    process.stderr.write('\x07'); // BEL character
  }
}

function sendMacOSNotification(title: string, message: string): void {
  if (ENABLE_MACOS_NOTIFY && process.platform === 'darwin') {
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedMsg = message.replace(/"/g, '\\"').substring(0, 100);
    exec(`osascript -e 'display notification "${escapedMsg}" with title "${escapedTitle}"'`);
  }
}

// ============ Message Handling ============

function handleMessage(msg: any): void {
  if (msg.type === 'message' || msg.type === 'broadcast' || msg.type === 'direct') {
    const fromMatrix = msg.from || 'unknown';
    const content = msg.content || '';
    const msgType = msg.type === 'direct' ? 'direct' : 'broadcast';

    // Generate unique message ID
    const messageId = msg.id || `${fromMatrix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Persist to SQLite
    try {
      saveIncomingMessage({
        messageId,
        fromMatrix,
        toMatrix: msg.to || MATRIX_ID,
        content,
        messageType: msgType,
      });
    } catch (e) {
      console.error('[Daemon] Failed to persist message:', e);
    }

    // In-memory cache for fast API access
    const received = {
      from: fromMatrix,
      content,
      timestamp: new Date().toISOString(),
      type: msg.type,
      id: messageId,
    };
    receivedMessages.unshift(received);

    // Keep only last 100 messages in memory
    if (receivedMessages.length > 100) {
      receivedMessages.pop();
    }

    // Notify user
    sendTerminalBell();
    sendMacOSNotification(`Matrix: ${fromMatrix}`, content);

    // Log with unread count
    const unreadCount = getUnreadCount(MATRIX_ID);
    console.log(`[Daemon] 📬 [${unreadCount} unread] Message from ${fromMatrix}: ${content.substring(0, 50)}...`);

    // Push to all SSE clients for real-time updates
    for (const client of sseClients) {
      try {
        client.write(`data: ${JSON.stringify(received)}\n\n`);
      } catch {
        // Client disconnected, will be cleaned up on close
      }
    }

  } else if (msg.type === 'presence') {
    const presenceId = msg.matrix_id || msg.matrixId; // Handle both formats
    if (presenceId) {
      console.log(`[Daemon] 👤 ${presenceId} is now ${msg.status}`);
    }
  } else if (msg.type === 'ping') {
    // Respond to hub's ping with pong
    if (ws && connected) {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  } else if (msg.type === 'pong') {
    // Heartbeat response from hub
  }
}

function sendMessage(type: 'broadcast' | 'direct', content: string, to?: string, existingId?: string): boolean {
  // Generate message ID for tracking
  const messageId = existingId || `${MATRIX_ID}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Persist outgoing message (if new)
  if (!existingId) {
    try {
      saveMatrixMessage({
        messageId,
        fromMatrix: MATRIX_ID,
        toMatrix: to,
        content,
        messageType: type,
        maxRetries: MAX_RETRIES,
      });
    } catch (e) {
      console.error('[Daemon] Failed to persist outgoing message:', e);
    }
  }

  if (!ws || !connected) {
    // Queue for later retry
    messageQueue.push({ type, content, to, id: messageId });
    console.log(`[Daemon] Queued message (not connected)`);
    return false;
  }

  try {
    // Hub expects type: 'message' for both direct and broadcast
    // Direct: { type: 'message', to: 'target', content }
    // Broadcast: { type: 'message', content } (no 'to' field)
    const payload = type === 'broadcast'
      ? { type: 'message', content, id: messageId }
      : { type: 'message', to, content, id: messageId };

    ws.send(JSON.stringify(payload));

    // Mark as sent
    markMessageSent(messageId);
    console.log(`[Daemon] Sent ${type}: ${content.substring(0, 50)}...`);
    return true;
  } catch (error) {
    console.error('[Daemon] Send failed:', error);
    messageQueue.push({ type, content, to, id: messageId });
    return false;
  }
}

// Retry failed messages from SQLite
function retryPendingMessages(): void {
  if (!connected) return;

  const pending = getPendingMessages(MAX_RETRIES);
  for (const msg of pending) {
    const retryCount = incrementMessageRetry(msg.message_id);

    if (retryCount >= MAX_RETRIES) {
      markMessageFailed(msg.message_id, `Max retries (${MAX_RETRIES}) exceeded`);
      console.log(`[Daemon] Message ${msg.message_id} failed after ${MAX_RETRIES} retries`);
      continue;
    }

    console.log(`[Daemon] Retrying message ${msg.message_id} (attempt ${retryCount}/${MAX_RETRIES})`);
    sendMessage(msg.message_type, msg.content, msg.to_matrix || undefined, msg.message_id);
  }
}

function startRetryLoop(): void {
  if (retryInterval) return;

  retryInterval = setInterval(() => {
    retryPendingMessages();
  }, RETRY_INTERVAL);
}

function stopRetryLoop(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
}

function flushMessageQueue(): void {
  while (messageQueue.length > 0 && connected) {
    const msg = messageQueue.shift()!;
    sendMessage(msg.type, msg.content, msg.to, msg.id);
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

    // Get inbox (from SQLite for persistence)
    if (url.pathname === '/inbox') {
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const unreadOnly = url.searchParams.get('unread') === 'true';

      try {
        const messages = getInboxMessages(MATRIX_ID, limit);
        const unreadCount = getUnreadCount(MATRIX_ID);

        res.writeHead(200);
        res.end(JSON.stringify({
          messages: messages.map(m => ({
            id: m.message_id,
            from: m.from_matrix,
            to: m.to_matrix,
            content: m.content,
            type: m.message_type,
            timestamp: m.created_at,
            read: m.read_at !== null,
          })),
          total: messages.length,
          unread: unreadCount,
        }));
      } catch (e) {
        // Fallback to in-memory
        res.writeHead(200);
        res.end(JSON.stringify({
          messages: receivedMessages.slice(0, limit),
          total: receivedMessages.length,
          unread: receivedMessages.length,
        }));
      }
      return;
    }

    // Mark messages as read
    if (url.pathname === '/read' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const messageIds = data.ids || [];
          markMessagesRead(messageIds);
          res.writeHead(200);
          res.end(JSON.stringify({ marked: messageIds.length }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Get unread count
    if (url.pathname === '/unread') {
      const count = getUnreadCount(MATRIX_ID);
      res.writeHead(200);
      res.end(JSON.stringify({ unread: count }));
      return;
    }

    // SSE Stream for real-time message updates
    if (url.pathname === '/stream') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);

      // Send connection event
      res.write(`data: ${JSON.stringify({ type: 'connected', matrix: MATRIX_ID, timestamp: new Date().toISOString() })}\n\n`);

      // Send recent messages for context
      try {
        const recent = getInboxMessages(MATRIX_ID, 5);
        for (const msg of recent.reverse()) {
          res.write(`data: ${JSON.stringify({
            from: msg.from_matrix,
            content: msg.content,
            timestamp: msg.created_at,
            type: msg.message_type,
            id: msg.message_id,
            historical: true,
          })}\n\n`);
        }
      } catch {
        // Ignore errors fetching history
      }

      // Register this client
      sseClients.add(res);
      console.log(`[Daemon] SSE client connected (${sseClients.size} total)`);

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          res.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      // Cleanup on disconnect
      req.on('close', () => {
        sseClients.delete(res);
        clearInterval(heartbeat);
        console.log(`[Daemon] SSE client disconnected (${sseClients.size} remaining)`);
      });

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
  stopRetryLoop();

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
