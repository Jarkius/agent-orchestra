/**
 * Gateway Conversation Store — Phase I
 *
 * Persists Telegram conversations so agents remember prior chats.
 * Uses JSONL files per user, with automatic rotation.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface ConversationMessage {
  ts: string;
  role: 'user' | 'assistant';
  agent: string;
  provider: string;
  text: string;
  tokensUsed?: number;
}

export interface ConversationContext {
  messages: ConversationMessage[];
  summary?: string;
}

const MAX_MESSAGES_PER_FILE = 200;
const MAX_CONTEXT_MESSAGES = 10; // Load last N messages for context
const CONVERSATIONS_DIR_NAME = 'gateway-conversations';

function getConversationsDir(projectRoot: string): string {
  const dir = join(projectRoot, 'psi', 'pulse', CONVERSATIONS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getUserFile(projectRoot: string, userId: string): string {
  return join(getConversationsDir(projectRoot), `${userId}.jsonl`);
}

/**
 * Append a message to the user's conversation log.
 */
export function saveMessage(
  projectRoot: string,
  userId: string,
  message: ConversationMessage
): void {
  const filePath = getUserFile(projectRoot, userId);
  const line = JSON.stringify(message) + '\n';
  appendFileSync(filePath, line);

  // Rotate if too large
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length > MAX_MESSAGES_PER_FILE) {
      // Keep last half
      const keep = lines.slice(Math.floor(lines.length / 2));
      writeFileSync(filePath, keep.join('\n') + '\n');
    }
  } catch { /* ignore rotation errors */ }
}

/**
 * Load recent conversation context for a user.
 * Returns the last N messages for injection into the system prompt.
 */
export function loadContext(
  projectRoot: string,
  userId: string,
  maxMessages: number = MAX_CONTEXT_MESSAGES
): ConversationContext {
  const filePath = getUserFile(projectRoot, userId);

  if (!existsSync(filePath)) {
    return { messages: [] };
  }

  const messages: ConversationMessage[] = [];

  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Take last N lines
    const recent = lines.slice(-maxMessages);
    for (const line of recent) {
      try {
        messages.push(JSON.parse(line));
      } catch { /* skip malformed */ }
    }
  } catch { /* empty context on error */ }

  return { messages };
}

/**
 * Format conversation context as a string for system prompt injection.
 */
export function formatContextForPrompt(context: ConversationContext): string {
  if (context.messages.length === 0) return '';

  const lines = ['## Recent Conversation History', ''];

  for (const msg of context.messages) {
    const time = msg.ts.slice(11, 16); // HH:MM
    if (msg.role === 'user') {
      lines.push(`**[${time}] Operator**: ${msg.text.slice(0, 200)}`);
    } else {
      lines.push(`**[${time}] ${msg.agent}**: ${msg.text.slice(0, 200)}`);
    }
  }

  lines.push('');
  lines.push('*Use this history to maintain continuity. Do not repeat prior answers.*');

  return lines.join('\n');
}

/**
 * Get conversation stats for a user.
 */
export function getStats(
  projectRoot: string,
  userId: string
): { totalMessages: number; firstMessage?: string; lastMessage?: string } {
  const filePath = getUserFile(projectRoot, userId);

  if (!existsSync(filePath)) {
    return { totalMessages: 0 };
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    if (lines.length === 0) return { totalMessages: 0 };

    const first = JSON.parse(lines[0]!);
    const last = JSON.parse(lines[lines.length - 1]!);

    return {
      totalMessages: lines.length,
      firstMessage: first.ts,
      lastMessage: last.ts,
    };
  } catch {
    return { totalMessages: 0 };
  }
}

/**
 * List all users with conversations.
 */
export function listUsers(projectRoot: string): string[] {
  const dir = getConversationsDir(projectRoot);
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => f.replace('.jsonl', ''));
  } catch {
    return [];
  }
}
