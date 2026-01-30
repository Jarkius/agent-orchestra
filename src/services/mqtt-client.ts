/**
 * MQTT Client for Matrix Browser Bridge
 *
 * Provides a TypeScript interface to control browser tabs via MQTT.
 * Communicates with the Matrix Browser Bridge Chrome extension.
 *
 * @see extensions/matrix-browser-bridge/
 */

import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { createLogger } from '../utils/logger';

const log = createLogger('mqtt-client');

// ============================================================================
// Types
// ============================================================================

export interface MqttConfig {
  brokerUrl: string;
  clientId?: string;
  connectTimeout?: number;
}

export interface BrowserCommand {
  action: string;
  id?: string;
  tabId?: number;
  text?: string;
  url?: string;
  timeout?: number;
  model?: 'fast' | 'thinking' | 'pro';
  mode?: string;
  [key: string]: unknown;
}

export interface BrowserResponse {
  id?: string;
  action: string;
  success?: boolean;
  error?: string;
  tabId?: number;
  timestamp?: number;
  answer?: string;
  tabs?: Array<{
    id: number;
    title: string;
    url: string;
    active: boolean;
  }>;
  count?: number;
  [key: string]: unknown;
}

export interface GeminiTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: MqttConfig = {
  brokerUrl: 'mqtt://localhost:1883',
  connectTimeout: 5000,
};

const TOPICS = {
  COMMAND: 'matrix/browser/command',
  RESPONSE: 'matrix/browser/response',
  STATUS: 'matrix/browser/status',
} as const;

// ============================================================================
// GeminiBrowserClient
// ============================================================================

export class GeminiBrowserClient {
  private client: MqttClient | null = null;
  private config: MqttConfig;
  private pendingRequests: Map<string, {
    resolve: (value: BrowserResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private requestCounter = 0;
  private connected = false;

  constructor(config: Partial<MqttConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // Connection Management
  // --------------------------------------------------------------------------

  /**
   * Connect to the MQTT broker
   */
  async connect(): Promise<void> {
    if (this.connected && this.client) {
      log.debug('Already connected');
      return;
    }

    return new Promise((resolve, reject) => {
      const clientId = this.config.clientId || `gemini-client-${Date.now()}`;

      log.info('Connecting to MQTT broker', { url: this.config.brokerUrl, clientId });

      const options: IClientOptions = {
        clientId,
        keepalive: 30,
        reconnectPeriod: 5000,
        connectTimeout: this.config.connectTimeout,
      };

      this.client = mqtt.connect(this.config.brokerUrl, options);

      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout after ${this.config.connectTimeout}ms`));
      }, this.config.connectTimeout);

      this.client.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        log.info('Connected to MQTT broker');

        // Subscribe to response topic
        this.client!.subscribe(TOPICS.RESPONSE, (err) => {
          if (err) {
            log.error('Failed to subscribe to response topic', { error: err.message });
            reject(err);
          } else {
            log.debug('Subscribed to response topic');
            resolve();
          }
        });
      });

      this.client.on('message', (topic, message) => {
        this.handleMessage(topic, message);
      });

      this.client.on('error', (err) => {
        log.error('MQTT error', { error: err.message });
        clearTimeout(timeout);
        reject(err);
      });

      this.client.on('close', () => {
        this.connected = false;
        log.info('Disconnected from MQTT broker');
      });
    });
  }

  /**
   * Disconnect from the MQTT broker
   */
  disconnect(): void {
    if (this.client) {
      // Reject all pending requests
      for (const [id, req] of this.pendingRequests) {
        clearTimeout(req.timer);
        req.reject(new Error('Client disconnected'));
      }
      this.pendingRequests.clear();

      this.client.end();
      this.client = null;
      this.connected = false;
      log.info('Disconnected');
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------

  private handleMessage(topic: string, message: Buffer): void {
    try {
      const response: BrowserResponse = JSON.parse(message.toString());
      log.debug('Received response', { action: response.action, id: response.id });

      // Check if this is a response to a pending request
      if (response.id && this.pendingRequests.has(response.id)) {
        const pending = this.pendingRequests.get(response.id)!;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    } catch (e) {
      log.warn('Failed to parse MQTT message', { error: (e as Error).message });
    }
  }

  // --------------------------------------------------------------------------
  // Command Execution
  // --------------------------------------------------------------------------

  /**
   * Send a command and wait for response
   */
  private async sendCommand(
    command: BrowserCommand,
    timeout = 10000
  ): Promise<BrowserResponse> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected to MQTT broker');
    }

    const id = `cmd-${++this.requestCounter}-${Date.now()}`;
    const fullCommand = { ...command, id, ts: Date.now() };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command timeout: ${command.action}`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      this.client!.publish(
        TOPICS.COMMAND,
        JSON.stringify(fullCommand),
        { qos: 0 },
        (err) => {
          if (err) {
            clearTimeout(timer);
            this.pendingRequests.delete(id);
            reject(err);
          } else {
            log.debug('Sent command', { action: command.action, id });
          }
        }
      );
    });
  }

  // --------------------------------------------------------------------------
  // Tab Management
  // --------------------------------------------------------------------------

  /**
   * Create a new Gemini tab
   * @returns The tab ID of the newly created tab
   */
  async createTab(url = 'https://gemini.google.com/app'): Promise<number> {
    const response = await this.sendCommand({
      action: 'create_tab',
      url,
    });

    if (response.error) {
      throw new Error(response.error);
    }

    return response.tabId!;
  }

  /**
   * List all Gemini tabs
   */
  async listTabs(): Promise<GeminiTab[]> {
    const response = await this.sendCommand({ action: 'list_tabs' });

    if (response.error) {
      throw new Error(response.error);
    }

    return response.tabs || [];
  }

  /**
   * Focus a specific tab
   */
  async focusTab(tabId: number): Promise<void> {
    const response = await this.sendCommand({
      action: 'focus_tab',
      tabId,
    });

    if (response.error) {
      throw new Error(response.error);
    }
  }

  // --------------------------------------------------------------------------
  // Gemini Interaction
  // --------------------------------------------------------------------------

  /**
   * Send a chat message to Gemini
   */
  async chat(tabId: number, text: string): Promise<void> {
    const response = await this.sendCommand({
      action: 'chat',
      tabId,
      text,
    });

    if (response.error) {
      throw new Error(response.error);
    }
  }

  /**
   * Get the current response from Gemini (immediate, doesn't wait)
   */
  async getResponse(tabId: number): Promise<string | null> {
    const response = await this.sendCommand({
      action: 'get_response',
      tabId,
    });

    if (response.error) {
      throw new Error(response.error);
    }

    return response.answer || null;
  }

  /**
   * Wait for Gemini to respond
   * @param tabId - Tab ID to wait for
   * @param timeout - Max time to wait in ms (default: 30000)
   * @returns The response text
   */
  async waitResponse(tabId: number, timeout = 30000): Promise<string> {
    // The extension's wait_response has its own internal polling
    // We need to give it enough time, so our command timeout should be higher
    const response = await this.sendCommand(
      {
        action: 'wait_response',
        tabId,
        timeout,
      },
      timeout + 5000 // Add buffer for network latency
    );

    if (response.error) {
      throw new Error(response.error);
    }

    return response.answer || '';
  }

  /**
   * Select Gemini model (fast/thinking/pro)
   */
  async selectModel(tabId: number, model: 'fast' | 'thinking' | 'pro'): Promise<void> {
    const response = await this.sendCommand({
      action: 'select_model',
      tabId,
      model,
    });

    if (response.error) {
      throw new Error(response.error);
    }
  }

  /**
   * Select Gemini mode (e.g., "Deep Research")
   */
  async selectMode(tabId: number, mode: string): Promise<void> {
    const response = await this.sendCommand({
      action: 'select_mode',
      tabId,
      mode,
    });

    if (response.error) {
      throw new Error(response.error);
    }
  }

  /**
   * Get current page URL
   */
  async getUrl(tabId?: number): Promise<{ url: string; title: string }> {
    const response = await this.sendCommand({
      action: 'get_url',
      ...(tabId && { tabId }),
    });

    if (response.error) {
      throw new Error(response.error);
    }

    return {
      url: response.url as string,
      title: response.title as string,
    };
  }

  // --------------------------------------------------------------------------
  // Convenience Methods
  // --------------------------------------------------------------------------

  /**
   * Send a query to Gemini and wait for response (convenience method)
   */
  async query(
    tabId: number,
    text: string,
    options: { timeout?: number; model?: 'fast' | 'thinking' | 'pro' } = {}
  ): Promise<string> {
    if (options.model) {
      await this.selectModel(tabId, options.model);
    }

    await this.chat(tabId, text);
    return this.waitResponse(tabId, options.timeout);
  }

  /**
   * Transcribe a YouTube video (creates new tab)
   */
  async transcribe(
    videoUrl: string,
    options: { prompt?: string } = {}
  ): Promise<{ tabId: number; video: string }> {
    const response = await this.sendCommand(
      {
        action: 'transcribe',
        url: videoUrl,
        prompt: options.prompt,
      },
      60000 // Transcription can take a while
    );

    if (response.error) {
      throw new Error(response.error);
    }

    return {
      tabId: response.tabId!,
      video: response.video as string,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const geminiClient = new GeminiBrowserClient();

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Run parallel Gemini queries across multiple tabs
 */
export async function parallelGeminiQueries(
  client: GeminiBrowserClient,
  queries: string[],
  options: {
    model?: 'fast' | 'thinking' | 'pro';
    timeout?: number;
    onTabCreated?: (tabId: number, query: string) => void;
    onQuerySent?: (tabId: number, query: string) => void;
    onResponseReceived?: (tabId: number, query: string, response: string) => void;
  } = {}
): Promise<Array<{ query: string; response: string; tabId: number }>> {
  const { model, timeout = 30000, onTabCreated, onQuerySent, onResponseReceived } = options;

  // Create all tabs in parallel
  log.info('Creating tabs for parallel queries', { count: queries.length });
  const tabIds = await Promise.all(
    queries.map(async (query, i) => {
      const tabId = await client.createTab();
      log.debug('Tab created', { tabId, queryIndex: i });
      onTabCreated?.(tabId, query);
      return tabId;
    })
  );

  // Wait a bit for tabs to fully load
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Set model on all tabs if specified
  if (model) {
    log.debug('Setting model on all tabs', { model });
    await Promise.all(tabIds.map((id) => client.selectModel(id, model)));
  }

  // Send all queries in parallel
  log.info('Sending queries to all tabs');
  await Promise.all(
    queries.map(async (query, i) => {
      await client.chat(tabIds[i], query);
      log.debug('Query sent', { tabId: tabIds[i], queryIndex: i });
      onQuerySent?.(tabIds[i], query);
    })
  );

  // Wait for all responses in parallel
  log.info('Waiting for responses');
  const responses = await Promise.all(
    tabIds.map(async (tabId, i) => {
      const response = await client.waitResponse(tabId, timeout);
      log.debug('Response received', { tabId, queryIndex: i, length: response.length });
      onResponseReceived?.(tabId, queries[i], response);
      return {
        query: queries[i],
        response,
        tabId,
      };
    })
  );

  return responses;
}
