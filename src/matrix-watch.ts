#!/usr/bin/env bun
/**
 * Matrix Watch - Live message feed for real-time duplex communication
 *
 * Connects to the matrix daemon's SSE stream and displays messages
 * as they arrive. Designed to run in a dedicated tmux pane alongside
 * Claude sessions for true duplex visibility.
 *
 * Usage:
 *   bun run src/matrix-watch.ts
 *   bun memory watch
 *
 * Environment:
 *   MATRIX_DAEMON_PORT - Daemon port to connect to (default: 37888)
 *
 * Note: Automatically included in spawn script tmux layout
 */

import { basename } from 'path';

// Configuration
const DAEMON_PORT = parseInt(process.env.MATRIX_DAEMON_PORT || '37888');
const MATRIX_ID = basename(process.cwd());
const RECONNECT_DELAY = 3000;

// ANSI color codes
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  // Colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  // Bright colors
  brightCyan: '\x1b[96m',
  brightMagenta: '\x1b[95m',
  brightYellow: '\x1b[93m',
};

// Format timestamp
function formatTime(timestamp?: string): string {
  const date = timestamp ? new Date(timestamp) : new Date();
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Extract short name from matrix path
function shortName(path: string): string {
  return path.split('/').pop() || path;
}

// Format a message for display
function formatMessage(msg: any): string {
  const time = `${C.gray}[${formatTime(msg.timestamp)}]${C.reset}`;
  const from = shortName(msg.from || 'unknown');
  const historical = msg.historical ? `${C.dim}(history)${C.reset} ` : '';
  const outbound = msg.outbound ? `${C.green}>>>${C.reset} ` : '';

  if (msg.type === 'broadcast') {
    const tag = msg.outbound ? `${C.green}[sent]${C.reset}` : `${C.cyan}[broadcast]${C.reset}`;
    return `${time} ${tag} ${C.bold}${from}${C.reset}: ${outbound}${historical}${msg.content}`;
  } else if (msg.type === 'direct') {
    const tag = msg.outbound ? `${C.green}[sent→${shortName(msg.to)}]${C.reset}` : `${C.magenta}[DM]${C.reset}`;
    return `${time} ${tag} ${C.bold}${from}${C.reset}: ${outbound}${historical}${msg.content}`;
  } else if (msg.type === 'connected') {
    return `${time} ${C.green}[system]${C.reset} Connected to matrix: ${msg.matrix}`;
  } else {
    return `${time} ${C.yellow}[${msg.type || 'unknown'}]${C.reset} ${JSON.stringify(msg)}`;
  }
}

// Print header
function printHeader(): void {
  console.clear();
  const width = process.stdout.columns || 80;
  const title = ` MATRIX WATCH - ${MATRIX_ID} `;
  const padding = Math.max(0, Math.floor((width - title.length) / 2));

  console.log();
  console.log(`${C.bold}${C.cyan}${'='.repeat(width)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${' '.repeat(padding)}${title}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${'='.repeat(width)}${C.reset}`);
  console.log();
  console.log(`${C.dim}Listening for messages on port ${DAEMON_PORT}...${C.reset}`);
  console.log(`${C.dim}Press Ctrl+C to exit${C.reset}`);
  console.log();
  console.log(`${C.gray}${'─'.repeat(width)}${C.reset}`);
  console.log();
}

// Connect to SSE stream
async function connectToStream(): Promise<void> {
  printHeader();

  while (true) {
    try {
      console.log(`${C.dim}[${formatTime()}] Connecting to daemon...${C.reset}`);

      const response = await fetch(`http://localhost:${DAEMON_PORT}/stream`, {
        headers: { 'Accept': 'text/event-stream' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log(`${C.yellow}[${formatTime()}] Stream ended${C.reset}`);
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              console.log(formatMessage(data));
            } catch {
              // Ignore malformed JSON
            }
          } else if (line.startsWith(': heartbeat')) {
            // Silent heartbeat - don't log
          }
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.log(`${C.red}[${formatTime()}] Connection error: ${errMsg}${C.reset}`);
      console.log(`${C.dim}[${formatTime()}] Retrying in ${RECONNECT_DELAY / 1000}s...${C.reset}`);
    }

    // Wait before reconnecting
    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n${C.yellow}[${formatTime()}] Shutting down...${C.reset}`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n${C.yellow}[${formatTime()}] Terminated${C.reset}`);
  process.exit(0);
});

// Start
connectToStream();
