/**
 * Matrix Gateway — Phase C (ADR-013 / ADR-018)
 *
 * Telegram bot that bridges messaging to the Oracle Construct.
 * Multi-provider: Gemini (Google), GPT (OpenAI), Claude (Anthropic).
 * Auto-detects available providers from env vars.
 *
 * Managed by matrix-services.sh.
 *
 * Usage:
 *   bun run src/gateway/matrix-gateway.ts         # Start gateway
 *   bun run src/gateway/matrix-gateway.ts stop     # Stop
 *   bun run src/gateway/matrix-gateway.ts status   # Check status
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN — from BotFather
 *   + at least one LLM provider:
 *     GOOGLE_API_KEY (or GEMINI_API_KEY) — for Gemini
 *     OPENAI_API_KEY — for GPT
 *     ANTHROPIC_API_KEY — for Claude (optional)
 */

import { Bot, type Context } from 'grammy';
import { createServer, type Server } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

import type { GatewayConfig, GatewayResponse } from './types';
import { routeMessage } from './agent-router';
import { GATEWAY_TOOLS, executeTool } from './tools';
import {
  selectProvider, listProviders, getModelForTier,
  type LLMProvider, type ToolDef, type ToolResult, type LLMResponse,
} from './providers';
import {
  isUserAllowed, checkRateLimit, getSession, saveSession,
  checkTokenBudget, recordTokenUsage, isElevated, elevate,
  generatePairingCode, verifyPairingCode,
} from './security';
import { saveMessage, getStats } from './conversation-store';

// ============ Configuration ============

const DAEMON_PORT = parseInt(process.env.GATEWAY_PORT || '8082');
const PID_DIR = join(process.env.HOME || '/tmp', '.matrix-gateway');
const PID_FILE = join(PID_DIR, 'gateway.pid');

function findProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

const PROJECT_ROOT = process.env.PROJECT_ROOT || findProjectRoot();
const CONFIG_PATH = join(PROJECT_ROOT, '.matrix.json');
const EVENT_WRITER = join(PROJECT_ROOT, '.claude', 'hooks', 'pulse-event-writer.sh');

// ============ State ============

let bot: Bot | null = null;
let httpServer: Server | null = null;
let startTime: Date | null = null;
let totalMessages = 0;
let totalTokens = 0;
let activeProvider: LLMProvider | null = null;

// ============ Config Loader ============

function loadConfig(): GatewayConfig {
  const defaults: GatewayConfig = {
    enabled: true,
    port: 8082,
    channels: {
      telegram: {
        enabled: true,
        bot_token_env: 'TELEGRAM_BOT_TOKEN',
        allowed_users: [],
      },
    },
    security: {
      allowed_users_only: true,
      sandbox_shell: true,
      max_tokens_per_message: 4096,
      daily_token_budget: 100000,
      rate_limit_per_minute: 10,
      pairing_required: true,
      elevated_timeout_minutes: 5,
    },
    claude: {
      api_key_env: 'ANTHROPIC_API_KEY',
      default_model: 'claude-sonnet-4-5-20250929',
      opus_model: 'claude-opus-4-6',
      haiku_model: 'claude-haiku-4-5-20251001',
    },
    llm: {
      provider: 'auto',
      gemini: {
        opus: 'gemini-2.0-flash',
        sonnet: 'gemini-2.0-flash',
        haiku: 'gemini-2.0-flash-lite',
      },
      openai: {
        opus: 'gpt-4o',
        sonnet: 'gpt-4o-mini',
        haiku: 'gpt-4o-mini',
      },
      anthropic: {
        opus: 'claude-opus-4-6',
        sonnet: 'claude-sonnet-4-5-20250929',
        haiku: 'claude-haiku-4-5-20251001',
      },
    },
  };

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const gateway = raw.gateway || {};
    return {
      ...defaults,
      ...gateway,
      channels: { ...defaults.channels, ...gateway.channels },
      security: { ...defaults.security, ...gateway.security },
      claude: { ...defaults.claude, ...gateway.claude },
      llm: {
        ...defaults.llm,
        ...gateway.llm,
        gemini: { ...defaults.llm.gemini, ...gateway.llm?.gemini },
        openai: { ...defaults.llm.openai, ...gateway.llm?.openai },
        anthropic: { ...defaults.llm.anthropic, ...gateway.llm?.anthropic },
      },
    };
  } catch {
    return defaults;
  }
}

// ============ Logging ============

function log(msg: string): void {
  console.log(`[gateway ${new Date().toISOString()}] ${msg}`);
}

function writeEvent(type: string, data: Record<string, unknown>): void {
  try {
    execSync(`bash "${EVENT_WRITER}" "${type}" "Gateway" '${JSON.stringify(data).replace(/'/g, "'\\''")}'`, {
      timeout: 5000,
      cwd: PROJECT_ROOT,
    });
  } catch { /* non-blocking */ }
}

// ============ Multi-Provider LLM Bridge ============

async function callLLM(
  provider: LLMProvider,
  systemPrompt: string,
  userMessage: string,
  modelId: string,
  session: ReturnType<typeof getSession>,
  config: GatewayConfig
): Promise<GatewayResponse> {
  const startMs = Date.now();
  let totalTokensUsed = 0;

  const tools: ToolDef[] = GATEWAY_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  // Initial completion
  let response = await provider.createCompletion({
    model: modelId,
    system: systemPrompt,
    userMessage,
    tools,
    maxTokens: config.security.max_tokens_per_message,
  });

  totalTokensUsed += response.tokensUsed;

  // Tool use loop (max 10 iterations)
  let iterations = 0;
  let history: unknown[] = [];

  while (response.stopReason === 'tool_use' && iterations < 10) {
    iterations++;

    // Execute each tool
    const toolResults: ToolResult[] = response.toolCalls.map(tc => ({
      toolCallId: tc.id,
      output: executeTool(tc.name, tc.input, PROJECT_ROOT, session),
    }));

    // Continue conversation with tool results
    const continued = await provider.continueWithToolResults(
      { model: modelId, system: systemPrompt, userMessage, tools, maxTokens: config.security.max_tokens_per_message },
      response,
      toolResults,
      history
    );

    response = continued.response;
    history = continued.history;
    totalTokensUsed += response.tokensUsed;
  }

  return {
    text: response.text || 'No response generated.',
    agent: 'Oracle',
    model: `${provider.name}/${modelId}`,
    tokensUsed: totalTokensUsed,
    durationMs: Date.now() - startMs,
  };
}

// ============ Message Handler ============

async function handleMessage(ctx: Context, config: GatewayConfig): Promise<void> {
  const userId = String(ctx.from?.id || '');
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text || '';

  if (!userId || !chatId || !text) return;

  // Security: allowlist check
  if (!isUserAllowed(userId, config)) {
    log(`Blocked message from unauthorized user ${userId}`);
    return; // Silent reject
  }

  // Security: rate limit
  const rateCheck = checkRateLimit(userId, config.security.rate_limit_per_minute);
  if (!rateCheck.allowed) {
    await ctx.reply(`Rate limited. Try again in ${Math.ceil((rateCheck.retryAfterMs || 0) / 1000)}s.`);
    return;
  }

  // Get/create session
  const session = getSession(userId, PROJECT_ROOT);

  // Special commands
  if (text === '/start') {
    const providers = listProviders();
    const active = providers.filter(p => p.available).map(p => p.name).join(', ');
    await ctx.reply(
      `Oracle Construct Gateway online.\nProvider: ${activeProvider?.name || 'none'} (available: ${active})\n\n` +
      'Commands:\n' +
      '/status — System status\n' +
      '/tasks — Active tasks\n' +
      '/events — Recent events\n' +
      '/health — System health\n' +
      '/sudo — Elevated mode (5 min)\n' +
      '/pair — Pair this device\n' +
      '/provider — Show LLM provider info\n\n' +
      'Or talk to agents:\n' +
      '/neo <task> — Developer\n' +
      '/smith <task> — Debugger\n' +
      '/oracle <task> — Orchestrator\n' +
      '/tank <task> — Internal ops'
    );
    return;
  }

  if (text === '/pair') {
    const code = generatePairingCode(userId);
    await ctx.reply(`Pairing code: ${code}\n\nEnter this at your terminal within 5 minutes.`);
    return;
  }

  if (text === '/sudo') {
    elevate(session, config.security.elevated_timeout_minutes);
    saveSession(userId, PROJECT_ROOT);
    await ctx.reply(`Elevated mode active for ${config.security.elevated_timeout_minutes} minutes.`);
    return;
  }

  if (text === '/provider') {
    const providers = listProviders();
    const lines = providers.map(p => `${p.available ? 'ON' : 'OFF'} ${p.name}`);
    await ctx.reply(`LLM Providers:\n${lines.join('\n')}\n\nActive: ${activeProvider?.name || 'none'}`);
    return;
  }

  if (text === '/history') {
    const stats = getStats(PROJECT_ROOT, userId);
    await ctx.reply(
      `Conversation History:\n` +
      `Messages: ${stats.totalMessages}\n` +
      `First: ${stats.firstMessage || 'never'}\n` +
      `Last: ${stats.lastMessage || 'never'}`
    );
    return;
  }

  // Token budget check
  const budgetCheck = checkTokenBudget(session, config.security.daily_token_budget);
  if (!budgetCheck.allowed) {
    await ctx.reply(`Daily token budget exhausted (${config.security.daily_token_budget} tokens). Resets tomorrow.`);
    return;
  }

  // Route message to agent (with conversation history)
  const route = routeMessage(text, PROJECT_ROOT, config, userId);

  log(`[${userId}] → ${route.agent.agent}: "${text.slice(0, 50)}..." (${route.provider.name}/${route.modelId})`);

  // Log event
  writeEvent('gateway:message', {
    user: userId,
    agent: route.agent.agent,
    provider: route.provider.name,
    model: route.modelId,
    text_length: text.length,
  });

  totalMessages++;

  try {
    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    // Call LLM (provider-agnostic)
    const response = await callLLM(
      route.provider,
      route.systemPrompt,
      route.userMessage,
      route.modelId,
      session,
      config
    );

    // Record token usage
    recordTokenUsage(session, response.tokensUsed);
    saveSession(userId, PROJECT_ROOT);
    totalTokens += response.tokensUsed;

    // Save conversation (Phase I)
    const ts = new Date().toISOString();
    saveMessage(PROJECT_ROOT, userId, { ts, role: 'user', agent: route.agent.agent, provider: route.provider.name, text });
    saveMessage(PROJECT_ROOT, userId, { ts, role: 'assistant', agent: route.agent.agent, provider: route.provider.name, text: response.text, tokensUsed: response.tokensUsed });

    // Send response (split if too long for Telegram)
    const maxLen = 4000;
    if (response.text.length <= maxLen) {
      await ctx.reply(response.text, { parse_mode: undefined });
    } else {
      const chunks = splitMessage(response.text, maxLen);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: undefined });
      }
    }

    // Log response
    writeEvent('gateway:response', {
      agent: route.agent.agent,
      provider: route.provider.name,
      model: response.model,
      tokens: response.tokensUsed,
      duration_ms: response.durationMs,
    });

    log(`[${userId}] ← ${route.agent.agent}: ${response.tokensUsed} tokens, ${response.durationMs}ms (${route.provider.name})`);

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Error: ${errorMsg}`);
    await ctx.reply(`Error: ${errorMsg.slice(0, 200)}`);
    writeEvent('gateway:error', { error: errorMsg.slice(0, 200) });
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Split at last newline before maxLen
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

// ============ HTTP Health Endpoint ============

function startHttpServer(): void {
  httpServer = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${DAEMON_PORT}`);

    if (url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'running',
        pid: process.pid,
        provider: activeProvider?.name || 'none',
        providers: listProviders(),
        startTime: startTime?.toISOString(),
        totalMessages,
        totalTokens,
        uptime_seconds: startTime ? Math.floor((Date.now() - startTime.getTime()) / 1000) : 0,
      }));
    } else if (req.method === 'POST' && url.pathname === '/stop') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'stopping' }));
      shutdown();
    } else if (req.method === 'POST' && url.pathname === '/notify') {
      // Receive heartbeat notifications
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const alert = JSON.parse(body);
          await sendAlert(alert);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'sent' }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ endpoints: ['/status', '/stop', '/notify'] }));
    }
  });

  httpServer.listen(DAEMON_PORT, '127.0.0.1', () => {
    log(`HTTP endpoint on http://127.0.0.1:${DAEMON_PORT}`);
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`Port ${DAEMON_PORT} in use — another gateway may be running`);
      process.exit(1);
    }
  });
}

// ============ Alert Forwarding ============

async function sendAlert(alert: { severity: string; message: string; check: string }): Promise<void> {
  if (!bot) return;

  const config = loadConfig();
  const users = config.channels.telegram.allowed_users;

  const icon = alert.severity === 'critical' ? '!!!' : alert.severity === 'warning' ? '/!\\' : '(i)';
  const text = `${icon} ${alert.severity.toUpperCase()}: ${alert.message}\n\nSource: ${alert.check}`;

  for (const userId of users) {
    try {
      await bot.api.sendMessage(parseInt(userId), text);
    } catch (err) {
      log(`Failed to send alert to ${userId}: ${err}`);
    }
  }
}

// ============ PID Management ============

function writePid(): void {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
}

function readPid(): number | null {
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim());
    if (isNaN(pid)) return null;
    try { process.kill(pid, 0); return pid; } catch { return null; }
  } catch { return null; }
}

function cleanupPid(): void {
  try { unlinkSync(PID_FILE); } catch { /* ok */ }
}

// ============ Lifecycle ============

function shutdown(): void {
  log('Shutting down...');
  writeEvent('gateway:stop', {});
  bot?.stop();
  httpServer?.close();
  cleanupPid();
  setTimeout(() => process.exit(0), 500);
}

async function start(): Promise<void> {
  const existingPid = readPid();
  if (existingPid) {
    log(`Already running (PID ${existingPid}). Stop it first.`);
    process.exit(1);
  }

  const config = loadConfig();
  if (!config.enabled) {
    log('Gateway disabled in config');
    process.exit(0);
  }

  // Init Telegram bot
  const botToken = process.env[config.channels.telegram.bot_token_env];
  if (!botToken) {
    log(`Missing ${config.channels.telegram.bot_token_env} env var. Get one from @BotFather.`);
    log('Set it: export TELEGRAM_BOT_TOKEN="your-token-here"');
    process.exit(1);
  }

  // Init LLM provider (auto-detect)
  try {
    activeProvider = selectProvider(config.llm?.provider);
    log(`LLM provider: ${activeProvider.name}`);
  } catch (err) {
    log(`No LLM provider available: ${err}`);
    log('Set one of: GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY');
    process.exit(1);
  }

  // Show all providers
  const providers = listProviders();
  for (const p of providers) {
    log(`  ${p.name}: ${p.available ? 'available' : 'not configured'}`);
  }

  bot = new Bot(botToken);
  startTime = new Date();

  // Register handlers
  bot.on('message:text', (ctx) => handleMessage(ctx, config));

  // Error handler
  bot.catch((err) => {
    log(`Bot error: ${err.message}`);
    writeEvent('gateway:error', { error: err.message.slice(0, 200) });
  });

  writePid();
  startHttpServer();

  writeEvent('gateway:start', {
    port: DAEMON_PORT,
    telegram: true,
    provider: activeProvider.name,
    providers_available: providers.filter(p => p.available).map(p => p.name),
    allowed_users: config.channels.telegram.allowed_users.length,
  });

  log('Starting Telegram bot...');
  log(`Provider: ${activeProvider.name}`);
  log(`Allowed users: ${config.channels.telegram.allowed_users.length || 'NONE (open access!)'}`);
  log(`Daily token budget: ${config.security.daily_token_budget}`);

  // Start bot (long polling)
  await bot.start({
    onStart: () => {
      log('Telegram bot online. Listening for messages.');
      writeEvent('gateway:connect', { channel: 'telegram', provider: activeProvider?.name });
    },
  });
}

function stop(): void {
  const pid = readPid();
  if (!pid) {
    console.log('[gateway] Not running');
    process.exit(0);
  }
  try {
    execSync(`curl -s -X POST http://127.0.0.1:${DAEMON_PORT}/stop`, { timeout: 3000 });
    console.log('[gateway] Stop signal sent');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  cleanupPid();
}

function status(): void {
  const pid = readPid();
  if (!pid) {
    console.log('[gateway] Status: stopped');
    process.exit(1);
  }
  try {
    const output = execSync(`curl -s http://127.0.0.1:${DAEMON_PORT}/status`, {
      encoding: 'utf8',
      timeout: 3000,
    });
    const info = JSON.parse(output);
    console.log(`[gateway] Running (PID ${info.pid}, provider: ${info.provider}, ${info.totalMessages} msgs, ${info.totalTokens} tokens, uptime ${info.uptime_seconds}s)`);
  } catch {
    console.log(`[gateway] Running (PID ${pid}) — API not responding`);
  }
}

// ============ CLI ============

const command = process.argv[2] || 'start';

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

switch (command) {
  case 'start':
    start().catch(err => {
      log(`Fatal: ${err}`);
      cleanupPid();
      process.exit(1);
    });
    break;
  case 'stop':
    stop();
    break;
  case 'status':
    status();
    break;
  default:
    console.log('Usage: bun run src/gateway/matrix-gateway.ts [start|stop|status]');
    process.exit(1);
}
