/**
 * Structured Logger
 *
 * Provides structured logging with JSON output for log aggregation.
 * Enable JSON mode via STRUCTURED_LOGS=true environment variable.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  component: string;
  correlationId?: string;
  msg: string;
  data?: any;
}

// Check if structured logging is enabled
const STRUCTURED_LOGS = process.env.STRUCTURED_LOGS === 'true';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as LogLevel;

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return levelPriority[level] >= levelPriority[LOG_LEVEL];
}

function formatEntry(entry: LogEntry): string {
  if (STRUCTURED_LOGS) {
    return JSON.stringify(entry);
  }

  // Human-readable format: [component] msg (data)
  const correlationPart = entry.correlationId ? ` [${entry.correlationId}]` : '';
  const dataPart = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  const levelPrefix = entry.level === 'error' ? '❌ ' :
                      entry.level === 'warn' ? '⚠️ ' : '';

  return `[${entry.component}]${correlationPart} ${levelPrefix}${entry.msg}${dataPart}`;
}

export interface Logger {
  debug: (msg: string, data?: any, correlationId?: string) => void;
  info: (msg: string, data?: any, correlationId?: string) => void;
  warn: (msg: string, data?: any, correlationId?: string) => void;
  error: (msg: string, data?: any, correlationId?: string) => void;
  child: (correlationId: string) => Logger;
}

/**
 * Create a logger for a specific component
 */
export function createLogger(component: string, defaultCorrelationId?: string): Logger {
  const log = (level: LogLevel, msg: string, data?: any, correlationId?: string): void => {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      component,
      correlationId: correlationId || defaultCorrelationId,
      msg,
    };

    if (data !== undefined) {
      // Sanitize data to avoid circular references
      try {
        entry.data = typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data;
      } catch {
        entry.data = String(data);
      }
    }

    const formatted = formatEntry(entry);

    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  };

  return {
    debug: (msg, data, correlationId) => log('debug', msg, data, correlationId),
    info: (msg, data, correlationId) => log('info', msg, data, correlationId),
    warn: (msg, data, correlationId) => log('warn', msg, data, correlationId),
    error: (msg, data, correlationId) => log('error', msg, data, correlationId),
    child: (correlationId: string) => createLogger(component, correlationId),
  };
}

// Pre-created loggers for common components
export const wsLogger = createLogger('WS');
export const rpcLogger = createLogger('RPC');
export const missionLogger = createLogger('MissionQueue');
export const agentLogger = createLogger('Agent');
export const matrixLogger = createLogger('Matrix');
export const dbLogger = createLogger('DB');
