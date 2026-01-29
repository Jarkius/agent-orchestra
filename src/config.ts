/**
 * Centralized Configuration
 *
 * All environment variables and configuration settings in one place.
 * Import this instead of using process.env directly.
 *
 * Usage:
 *   import { config } from './config';
 *   const port = config.websocket.port;
 */

import { basename } from 'path';

// ============================================================================
// Helper Functions
// ============================================================================

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function getEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseFloat(value) : defaultValue;
}

// ============================================================================
// Configuration Object
// ============================================================================

export const config = {
  // Project identification
  project: {
    root: getEnv('PROJECT_ROOT', process.cwd()),
    name: getEnv('PROJECT_NAME', basename(process.cwd())),
    matrixId: getEnv('MATRIX_ID', basename(process.cwd())),
    matrixPath: getEnv('MATRIX_PATH', process.cwd()),
  },

  // WebSocket server (agent communication)
  websocket: {
    port: getEnvInt('WS_PORT', 8080),
    url: getEnv('WS_URL', 'ws://localhost:8080'),
    skip: getEnvBool('SKIP_WEBSOCKET', false),
  },

  // Matrix Hub (cross-matrix communication)
  matrixHub: {
    port: getEnvInt('MATRIX_HUB_PORT', 8081),
    host: getEnv('MATRIX_HUB_HOST', 'localhost'),
    url: getEnv('MATRIX_HUB_URL', 'ws://localhost:8081'),
    secret: getEnv('MATRIX_HUB_SECRET', 'default-hub-secret-change-me'),
    pin: getEnv('MATRIX_HUB_PIN', ''),
    pinDisabled: getEnv('MATRIX_HUB_PIN', '') === 'disabled',
    tokenExpiryHours: getEnvInt('MATRIX_TOKEN_EXPIRY_HOURS', 2),
    skip: getEnvBool('SKIP_MATRIX_HUB', false),
    tls: {
      cert: process.env.MATRIX_HUB_TLS_CERT,
      key: process.env.MATRIX_HUB_TLS_KEY,
      passphrase: process.env.MATRIX_HUB_TLS_PASSPHRASE,
    },
  },

  // Matrix Daemon
  matrixDaemon: {
    port: getEnvInt('MATRIX_DAEMON_PORT', 37888),
    dir: getEnv('MATRIX_DAEMON_DIR', `${process.env.HOME}/.matrix-daemon`),
  },

  // ChromaDB (vector database)
  chromaDb: {
    url: getEnv('CHROMA_URL', 'http://localhost:8100'),
    port: getEnvInt('CHROMA_PORT', 8100),
    skip: getEnvBool('SKIP_VECTORDB', false),
  },

  // Embeddings
  embeddings: {
    model: getEnv('EMBEDDING_MODEL', 'bge-m3'),
    dims: getEnvInt('EMBEDDING_DIMS', 1024),
  },

  // Search weights
  search: {
    vectorWeight: getEnvFloat('VECTOR_WEIGHT', 0.7),
    keywordWeight: getEnvFloat('KEYWORD_WEIGHT', 0.3),
  },

  // Code Indexer
  indexer: {
    port: getEnvInt('INDEXER_DAEMON_PORT', 37889),
    dir: getEnv('INDEXER_DAEMON_DIR', `${process.env.HOME}/.indexer-daemon`),
    rootPath: getEnv('INDEXER_ROOT_PATH', process.cwd()),
  },

  // Mission Queue
  missionQueue: {
    maxSize: getEnvInt('MAX_QUEUE_SIZE', 1000),
  },

  // External LLM APIs
  llm: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
  },

  // Agent Spawning
  agent: {
    tmuxSession: getEnv('TMUX_SESSION', 'claude-agents'),
  },

  // Claude Code Integration
  claudeCode: {
    taskListId: process.env.CLAUDE_CODE_TASK_LIST_ID,
  },

  // Logging
  logging: {
    level: getEnv('LOG_LEVEL', 'info'),
    structured: getEnvBool('STRUCTURED_LOGS', false),
  },

  // Notifications (macOS)
  notifications: {
    bell: getEnvBool('MATRIX_BELL', true),
    macosNotify: getEnvBool('MATRIX_MACOS_NOTIFY', false),
  },

  // System paths
  paths: {
    home: process.env.HOME || '/tmp',
  },
} as const;

// ============================================================================
// Type Exports
// ============================================================================

export type Config = typeof config;
export type WebSocketConfig = typeof config.websocket;
export type MatrixHubConfig = typeof config.matrixHub;
export type ChromaDbConfig = typeof config.chromaDb;
export type EmbeddingsConfig = typeof config.embeddings;
export type LlmConfig = typeof config.llm;

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate required configuration for a specific feature
 * Returns list of missing/invalid config items
 */
export function validateConfig(feature: 'matrix-hub' | 'chromadb' | 'llm'): string[] {
  const errors: string[] = [];

  switch (feature) {
    case 'matrix-hub':
      if (config.matrixHub.tls.cert && !config.matrixHub.tls.key) {
        errors.push('MATRIX_HUB_TLS_KEY required when MATRIX_HUB_TLS_CERT is set');
      }
      if (config.matrixHub.tls.key && !config.matrixHub.tls.cert) {
        errors.push('MATRIX_HUB_TLS_CERT required when MATRIX_HUB_TLS_KEY is set');
      }
      break;

    case 'chromadb':
      // ChromaDB is optional, no required config
      break;

    case 'llm':
      if (!config.llm.anthropicApiKey && !config.llm.openaiApiKey && !config.llm.geminiApiKey) {
        errors.push('At least one LLM API key required (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY)');
      }
      break;
  }

  return errors;
}

/**
 * Check if TLS is properly configured for Matrix Hub
 */
export function isMatrixHubTlsConfigured(): boolean {
  return !!(config.matrixHub.tls.cert && config.matrixHub.tls.key);
}

/**
 * Get the Matrix Hub URL with correct protocol
 */
export function getMatrixHubUrl(): string {
  const protocol = isMatrixHubTlsConfigured() ? 'wss' : 'ws';
  return `${protocol}://${config.matrixHub.host}:${config.matrixHub.port}`;
}

// ============================================================================
// Debug Export
// ============================================================================

/**
 * Get sanitized config for logging (hides secrets)
 */
export function getSanitizedConfig(): Record<string, unknown> {
  return {
    ...config,
    matrixHub: {
      ...config.matrixHub,
      secret: config.matrixHub.secret ? '***' : undefined,
      pin: config.matrixHub.pin ? '***' : undefined,
    },
    llm: {
      anthropicApiKey: config.llm.anthropicApiKey ? '***' : undefined,
      openaiApiKey: config.llm.openaiApiKey ? '***' : undefined,
      geminiApiKey: config.llm.geminiApiKey ? '***' : undefined,
    },
  };
}
