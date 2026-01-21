/**
 * Matrix Client - Hub Connection for Cross-Matrix Communication
 * Used by MCP servers and scripts to connect to the matrix hub
 *
 * Phase 3: Client-side WebSocket connection management
 */

import { basename } from 'path';

// ============ Configuration ============

const DEFAULT_HUB_URL = 'ws://localhost:8081';
const RECONNECT_INTERVAL_MS = 5000;

// ============ Types ============

type MatrixStatus = 'online' | 'offline' | 'away';

interface HubMessage {
  type: 'registered' | 'message' | 'presence' | 'ping' | 'error';
  matrix_id?: string;
  online_matrices?: string[];
  from?: string;
  content?: string;
  timestamp?: string;
  metadata?: Record<string, any>;
  status?: MatrixStatus;
  display_name?: string;
  code?: string;
  message?: string;
}

type MessageHandler = (message: {
  from: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, any>;
}) => void;

type PresenceHandler = (event: {
  matrix_id: string;
  status: MatrixStatus;
  display_name?: string;
}) => void;

type ConnectionHandler = (connected: boolean, onlineMatrices?: string[]) => void;

// ============ State ============

let hubUrl = DEFAULT_HUB_URL;
let matrixId = basename(process.cwd()); // Default to project name
let displayName: string | undefined;
let connection: WebSocket | null = null;
let connected = false;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let token: string | null = null;
let intentionalDisconnect = false; // Prevents auto-reconnect after disconnect()

// Event handlers
const messageHandlers: Set<MessageHandler> = new Set();
const presenceHandlers: Set<PresenceHandler> = new Set();
const connectionHandlers: Set<ConnectionHandler> = new Set();

// Message queue for offline delivery
const pendingMessages: Array<{ to?: string; content: string; metadata?: Record<string, any> }> = [];

// Presence state for debouncing logs
const lastPresenceStatus: Map<string, MatrixStatus> = new Map();

// ============ Token Management ============

/**
 * Get a token from the hub
 */
async function getToken(): Promise<string | null> {
  try {
    const httpUrl = hubUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    const params = new URLSearchParams({ matrix_id: matrixId });
    if (displayName) params.set('display_name', displayName);

    const response = await fetch(`${httpUrl}/register?${params}`);
    if (!response.ok) {
      console.error(`[MatrixClient] Failed to get token: ${response.status}`);
      return null;
    }

    const data = await response.json() as { token: string };
    return data.token;
  } catch (error) {
    console.error(`[MatrixClient] Failed to get token:`, error);
    return null;
  }
}

// ============ Connection Management ============

/**
 * Connect to the matrix hub
 */
export async function connectToHub(url?: string, name?: string): Promise<boolean> {
  if (url) hubUrl = url;
  if (name) displayName = name;
  intentionalDisconnect = false; // Reset flag for new connection

  // Don't reconnect if already connected
  if (connected && connection) {
    return true;
  }

  // Get token first
  token = await getToken();
  if (!token) {
    scheduleReconnect();
    return false;
  }

  return new Promise((resolve) => {
    try {
      const wsUrl = `${hubUrl}?token=${token}${displayName ? `&display_name=${encodeURIComponent(displayName)}` : ''}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log(`[MatrixClient] Connected to hub at ${hubUrl}`);
        connection = ws;
        connected = true;

        // Clear any pending reconnect
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }

        resolve(true);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as HubMessage;
          handleMessage(message);
        } catch (error) {
          console.error(`[MatrixClient] Failed to parse message:`, error);
        }
      };

      ws.onclose = (event) => {
        console.log(`[MatrixClient] Disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`);
        connection = null;
        connected = false;
        token = null;

        // Notify handlers
        connectionHandlers.forEach(handler => handler(false));

        // Schedule reconnection only if not intentionally disconnected
        if (!intentionalDisconnect) {
          scheduleReconnect();
        }

        if (!connected) {
          resolve(false);
        }
      };

      ws.onerror = (error) => {
        console.error(`[MatrixClient] Connection error:`, error);
        connected = false;
        resolve(false);
      };

      // Timeout for initial connection
      setTimeout(() => {
        if (!connected) {
          ws.close();
          resolve(false);
        }
      }, 5000);

    } catch (error) {
      console.error(`[MatrixClient] Failed to create connection:`, error);
      scheduleReconnect();
      resolve(false);
    }
  });
}

/**
 * Schedule a reconnection attempt
 */
function scheduleReconnect(): void {
  if (reconnectTimeout) return; // Already scheduled

  reconnectTimeout = setTimeout(async () => {
    reconnectTimeout = null;
    console.log(`[MatrixClient] Attempting reconnection...`);
    await connectToHub();
  }, RECONNECT_INTERVAL_MS);
}

/**
 * Wait for WebSocket send buffer to flush
 * Returns when all queued messages have been transmitted
 */
export async function waitForFlush(timeoutMs = 5000): Promise<boolean> {
  if (!connection) return true;

  const startTime = Date.now();
  const checkInterval = 10; // Check every 10ms

  while (connection.bufferedAmount > 0) {
    if (Date.now() - startTime > timeoutMs) {
      console.warn(`[MatrixClient] Flush timeout - ${connection.bufferedAmount} bytes still buffered`);
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  return true;
}

/**
 * Disconnect from the hub
 */
export function disconnect(): void {
  intentionalDisconnect = true; // Prevent auto-reconnect

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (connection) {
    try {
      connection.close(1000, 'Client disconnecting');
    } catch {}
    connection = null;
  }
  connected = false;
  token = null;
}

/**
 * Check if connected to hub
 */
export function isConnected(): boolean {
  return connected && connection !== null;
}

/**
 * Get current matrix ID
 */
export function getMatrixId(): string {
  return matrixId;
}

/**
 * Set matrix ID (must be called before connecting)
 */
export function setMatrixId(id: string): void {
  if (connected) {
    console.warn('[MatrixClient] Cannot change matrix ID while connected');
    return;
  }
  matrixId = id;
}

// ============ Message Handling ============

/**
 * Handle incoming messages from hub
 */
function handleMessage(message: HubMessage): void {
  switch (message.type) {
    case 'registered':
      console.log(`[MatrixClient] Registered as ${message.matrix_id}`);
      console.log(`[MatrixClient] Online matrices: ${message.online_matrices?.join(', ') || 'none'}`);
      connectionHandlers.forEach(handler => handler(true, message.online_matrices));

      // Send any pending messages
      flushPendingMessages();
      break;

    case 'message':
      if (message.from && message.content && message.timestamp) {
        console.log(`[MatrixClient] Message from ${message.from}: ${message.content.substring(0, 50)}...`);
        messageHandlers.forEach(handler => handler({
          from: message.from!,
          content: message.content!,
          timestamp: message.timestamp!,
          metadata: message.metadata,
        }));
      }
      break;

    case 'presence':
      if (message.matrix_id && message.status) {
        // Only log if status actually changed (debounce)
        const lastStatus = lastPresenceStatus.get(message.matrix_id);
        if (lastStatus !== message.status) {
          lastPresenceStatus.set(message.matrix_id, message.status);
          console.log(`[MatrixClient] ${message.matrix_id.split('/').pop()} is ${message.status}`);
        }
        presenceHandlers.forEach(handler => handler({
          matrix_id: message.matrix_id!,
          status: message.status!,
          display_name: message.display_name,
        }));
      }
      break;

    case 'ping':
      // Respond with pong
      if (connection) {
        connection.send(JSON.stringify({ type: 'pong', matrix_id: matrixId }));
      }
      break;

    case 'error':
      console.error(`[MatrixClient] Error from hub: ${message.code} - ${message.message}`);
      break;
  }
}

// ============ Messaging ============

/**
 * Send a message via the hub
 * @param content Message content
 * @param to Target matrix ID (undefined for broadcast)
 * @param metadata Optional metadata
 * @returns true if sent, false if queued for later
 */
export function sendMessage(content: string, to?: string, metadata?: Record<string, any>): boolean {
  const message = { to, content, metadata };

  if (!isConnected()) {
    // Queue for later delivery
    pendingMessages.push(message);
    console.log(`[MatrixClient] Queued message (not connected)`);
    return false;
  }

  try {
    connection!.send(JSON.stringify({
      type: 'message',
      to,
      content,
      metadata,
    }));
    return true;
  } catch (error) {
    console.error(`[MatrixClient] Failed to send message:`, error);
    pendingMessages.push(message);
    return false;
  }
}

/**
 * Broadcast a message to all connected matrices
 */
export function broadcast(content: string, metadata?: Record<string, any>): boolean {
  return sendMessage(content, undefined, metadata);
}

/**
 * Send a direct message to a specific matrix
 */
export function sendDirect(to: string, content: string, metadata?: Record<string, any>): boolean {
  return sendMessage(content, to, metadata);
}

/**
 * Flush pending messages after reconnection
 */
function flushPendingMessages(): void {
  while (pendingMessages.length > 0 && isConnected()) {
    const message = pendingMessages.shift()!;
    sendMessage(message.content, message.to, message.metadata);
  }
}

/**
 * Update presence status
 */
export function setPresence(status: 'online' | 'away'): boolean {
  if (!isConnected()) return false;

  try {
    connection!.send(JSON.stringify({
      type: 'presence',
      status,
    }));
    return true;
  } catch {
    return false;
  }
}

// ============ Event Handlers ============

/**
 * Register a handler for incoming messages
 */
export function onMessage(handler: MessageHandler): () => void {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

/**
 * Register a handler for presence updates
 */
export function onPresence(handler: PresenceHandler): () => void {
  presenceHandlers.add(handler);
  return () => presenceHandlers.delete(handler);
}

/**
 * Register a handler for connection state changes
 */
export function onConnection(handler: ConnectionHandler): () => void {
  connectionHandlers.add(handler);
  return () => connectionHandlers.delete(handler);
}

// ============ Utility ============

/**
 * Get hub connection status
 */
export function getStatus(): {
  connected: boolean;
  hubUrl: string;
  matrixId: string;
  displayName?: string;
  pendingMessages: number;
} {
  return {
    connected,
    hubUrl,
    matrixId,
    displayName,
    pendingMessages: pendingMessages.length,
  };
}
