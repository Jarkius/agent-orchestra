/**
 * Gateway Security — Phase C (ADR-013 / ADR-018)
 *
 * Handles:
 * - User allowlist verification
 * - Pairing code flow
 * - Rate limiting
 * - Token budget tracking
 * - Shell command sandboxing
 * - Elevated mode (sudo)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { GatewayConfig, RateLimitEntry, UserSession, PairingSession } from './types';

// ============ Shell Sandbox ============

const SHELL_ALLOWLIST = [
  'git', 'bun', 'cat', 'ls', 'grep', 'head', 'tail', 'wc',
  'echo', 'date', 'pwd', 'basename', 'dirname',
];

const SHELL_BLOCKLIST = [
  'rm', 'mv', 'chmod', 'chown', 'curl', 'wget', 'sudo', 'su',
  'kill', 'pkill', 'dd', 'mkfs', 'fdisk', 'mount', 'umount',
  'ssh', 'scp', 'rsync', 'nc', 'ncat', 'python', 'node', 'eval',
];

const ELEVATED_SHELL_ALLOWLIST = [
  ...SHELL_ALLOWLIST,
  'npm', 'npx', 'python3', 'node', 'mkdir', 'touch', 'cp',
];

export function isShellCommandAllowed(command: string, elevated: boolean): { allowed: boolean; reason?: string } {
  const firstWord = command.trim().split(/\s+/)[0]?.toLowerCase() || '';

  // Always block dangerous commands
  for (const blocked of SHELL_BLOCKLIST) {
    if (firstWord === blocked) {
      return { allowed: false, reason: `Command '${blocked}' is blocked for security` };
    }
  }

  // Check pipes and subshells for blocked commands
  if (/[;&|`$]/.test(command)) {
    const parts = command.split(/[;&|]+/).map(p => p.trim().split(/\s+/)[0]?.toLowerCase() || '');
    for (const part of parts) {
      if (SHELL_BLOCKLIST.includes(part)) {
        return { allowed: false, reason: `Piped command '${part}' is blocked` };
      }
    }
  }

  const allowlist = elevated ? ELEVATED_SHELL_ALLOWLIST : SHELL_ALLOWLIST;

  if (!allowlist.includes(firstWord)) {
    return { allowed: false, reason: `Command '${firstWord}' not in allowlist. Use /sudo for elevated mode.` };
  }

  return { allowed: true };
}

// ============ Rate Limiting ============

const rateLimits = new Map<string, RateLimitEntry>();

export function checkRateLimit(userId: string, maxPerMinute: number): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const windowMs = 60_000;

  let entry = rateLimits.get(userId);
  if (!entry) {
    entry = { userId, timestamps: [] };
    rateLimits.set(userId, entry);
  }

  // Clean old timestamps
  entry.timestamps = entry.timestamps.filter(ts => now - ts < windowMs);

  if (entry.timestamps.length >= maxPerMinute) {
    const oldest = entry.timestamps[0]!;
    return { allowed: false, retryAfterMs: windowMs - (now - oldest) };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}

// ============ User Sessions ============

const sessions = new Map<string, UserSession>();

export function getSession(userId: string, projectRoot: string): UserSession {
  let session = sessions.get(userId);
  if (session) {
    // Reset daily token budget if new day
    const today = new Date().toISOString().slice(0, 10);
    if (session.lastReset !== today) {
      session.tokenUsageToday = 0;
      session.lastReset = today;
    }
    return session;
  }

  // Check persisted sessions
  const sessionsFile = join(projectRoot, 'psi', 'pulse', 'gateway-sessions.json');
  if (existsSync(sessionsFile)) {
    try {
      const data = JSON.parse(readFileSync(sessionsFile, 'utf8'));
      const persisted = data.sessions?.[userId];
      if (persisted) {
        session = persisted;
        sessions.set(userId, session);
        return session;
      }
    } catch { /* ignore */ }
  }

  // New session
  session = {
    userId,
    paired: false,
    elevated: false,
    tokenUsageToday: 0,
    lastReset: new Date().toISOString().slice(0, 10),
  };
  sessions.set(userId, session);
  return session;
}

export function saveSession(userId: string, projectRoot: string): void {
  const session = sessions.get(userId);
  if (!session) return;

  const sessionsFile = join(projectRoot, 'psi', 'pulse', 'gateway-sessions.json');
  let data: Record<string, unknown> = { sessions: {} };

  if (existsSync(sessionsFile)) {
    try {
      data = JSON.parse(readFileSync(sessionsFile, 'utf8'));
    } catch { /* fresh */ }
  }

  (data.sessions as Record<string, UserSession>)[userId] = session;
  writeFileSync(sessionsFile, JSON.stringify(data, null, 2));
}

export function isElevated(session: UserSession): boolean {
  if (!session.elevated) return false;
  if (session.elevatedUntil && Date.now() > session.elevatedUntil) {
    session.elevated = false;
    return false;
  }
  return true;
}

export function elevate(session: UserSession, minutes: number): void {
  session.elevated = true;
  session.elevatedUntil = Date.now() + minutes * 60_000;
}

// ============ Token Budget ============

export function checkTokenBudget(session: UserSession, dailyBudget: number): { allowed: boolean; remaining: number } {
  const remaining = dailyBudget - session.tokenUsageToday;
  return { allowed: remaining > 0, remaining: Math.max(0, remaining) };
}

export function recordTokenUsage(session: UserSession, tokens: number): void {
  session.tokenUsageToday += tokens;
}

// ============ Pairing ============

const pairingSessions = new Map<string, PairingSession>();

export function generatePairingCode(userId: string): string {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  pairingSessions.set(code, {
    code,
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60_000, // 5 minutes
  });
  return code;
}

export function verifyPairingCode(code: string, userId: string): boolean {
  const session = pairingSessions.get(code);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    pairingSessions.delete(code);
    return false;
  }
  if (session.userId !== userId) return false;

  pairingSessions.delete(code);
  return true;
}

// ============ Allowlist ============

export function isUserAllowed(userId: string, config: GatewayConfig): boolean {
  if (!config.security.allowed_users_only) return true;
  return config.channels.telegram.allowed_users.includes(userId);
}

// ============ File Path Sandbox ============

export function isPathAllowed(filePath: string, projectRoot: string, elevated: boolean): boolean {
  const resolved = require('path').resolve(projectRoot, filePath);

  // Must be within project root
  if (!resolved.startsWith(projectRoot)) return false;

  // Block sensitive paths even when elevated
  const blocked = ['.env', '.ssh', 'credentials', 'secrets', '.git/config'];
  for (const b of blocked) {
    if (resolved.includes(b)) return false;
  }

  return true;
}
