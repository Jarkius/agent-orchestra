/**
 * Heartbeat Daemon — Phase 10 (ADR-012)
 *
 * Lightweight daemon that runs between sessions, periodically checking:
 * - Overdue reminders
 * - CI/CD status (GitHub Actions via gh CLI)
 * - PR review requests
 * - Stale tasks (no updates in configured hours)
 * - Error spikes in event queue
 *
 * Managed by matrix-services.sh. HTTP health endpoint on port 37892.
 *
 * Usage:
 *   bun run src/heartbeat/heartbeat-daemon.ts         # Start daemon
 *   bun run src/heartbeat/heartbeat-daemon.ts stop     # Stop daemon
 *   bun run src/heartbeat/heartbeat-daemon.ts status   # Check status
 */

import { createServer, type Server } from 'http';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';

// ============ Configuration ============

const DAEMON_PORT = parseInt(process.env.HEARTBEAT_PORT || '37892');
const PID_DIR = join(process.env.HOME || '/tmp', '.matrix-heartbeat');
const PID_FILE = join(PID_DIR, 'heartbeat.pid');

// Find project root (git root or cwd)
function findProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

const PROJECT_ROOT = process.env.PROJECT_ROOT || findProjectRoot();
const CONFIG_PATH = join(PROJECT_ROOT, 'psi', 'pulse', 'heartbeat.json');
const EVENTS_PATH = join(PROJECT_ROOT, 'psi', 'pulse', 'events.jsonl');
const REMINDERS_PATH = join(PROJECT_ROOT, 'psi', 'pulse', 'reminders.json');
const TASKS_PATH = join(PROJECT_ROOT, 'psi', 'memory', 'tasks', 'active.json');
const EVENT_WRITER = join(PROJECT_ROOT, '.claude', 'hooks', 'pulse-event-writer.sh');
const LOG_DIR = join(PROJECT_ROOT, 'psi', 'pulse', 'daemon-logs');

// ============ Types ============

interface HeartbeatConfig {
  enabled: boolean;
  interval_minutes: number;
  checks: {
    reminders: boolean;
    ci_status: boolean;
    pr_reviews: boolean;
    stale_tasks: boolean;
    error_spikes: boolean;
  };
  stale_task_hours: number;
  error_spike_threshold: number;
  error_spike_window_hours: number;
  notify: {
    gateway: string;
    fallback: string;
  };
  auto_evolve: boolean;
}

interface Alert {
  check: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data?: Record<string, unknown>;
}

interface CheckResult {
  check: string;
  status: 'ok' | 'alert';
  alerts: Alert[];
  duration_ms: number;
}

// ============ State ============

let httpServer: Server | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let startTime: Date | null = null;
let lastCheck: Date | null = null;
let lastResults: CheckResult[] = [];
let totalChecks = 0;
let totalAlerts = 0;

// ============ Config Loader ============

function loadConfig(): HeartbeatConfig {
  const defaults: HeartbeatConfig = {
    enabled: true,
    interval_minutes: 30,
    checks: {
      reminders: true,
      ci_status: true,
      pr_reviews: true,
      stale_tasks: true,
      error_spikes: true,
    },
    stale_task_hours: 48,
    error_spike_threshold: 3,
    error_spike_window_hours: 1,
    notify: { gateway: 'ws://localhost:8082', fallback: 'log' },
    auto_evolve: false,
  };

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return { ...defaults, ...raw, checks: { ...defaults.checks, ...raw.checks }, notify: { ...defaults.notify, ...raw.notify } };
  } catch {
    return defaults;
  }
}

// ============ Check Implementations ============

async function checkReminders(): Promise<CheckResult> {
  const start = Date.now();
  const alerts: Alert[] = [];

  try {
    const data = JSON.parse(readFileSync(REMINDERS_PATH, 'utf8'));
    const now = new Date();

    for (const r of data.reminders || []) {
      if (r.status !== 'pending') continue;
      try {
        const due = new Date(r.due);
        if (due < now) {
          alerts.push({
            check: 'reminders',
            severity: 'warning',
            message: `Overdue reminder: ${r.message} (due ${r.due})`,
            data: { reminder_id: r.id, due: r.due },
          });
        }
      } catch { /* skip malformed dates */ }
    }
  } catch { /* file missing or malformed */ }

  return {
    check: 'reminders',
    status: alerts.length > 0 ? 'alert' : 'ok',
    alerts,
    duration_ms: Date.now() - start,
  };
}

async function checkCIStatus(): Promise<CheckResult> {
  const start = Date.now();
  const alerts: Alert[] = [];

  try {
    const output = execSync('gh pr list --state open --json number,title,statusCheckRollup --limit 10 2>/dev/null', {
      encoding: 'utf8',
      timeout: 15000,
      cwd: PROJECT_ROOT,
    });

    const prs = JSON.parse(output);
    for (const pr of prs) {
      const checks = pr.statusCheckRollup || [];
      const failures = checks.filter((c: { conclusion: string }) => c.conclusion === 'FAILURE');
      if (failures.length > 0) {
        alerts.push({
          check: 'ci_status',
          severity: 'critical',
          message: `PR #${pr.number} has ${failures.length} failing check(s): ${pr.title}`,
          data: { pr_number: pr.number, failures: failures.length },
        });
      }
    }
  } catch {
    // gh not available or no repo — silent skip
  }

  return {
    check: 'ci_status',
    status: alerts.length > 0 ? 'alert' : 'ok',
    alerts,
    duration_ms: Date.now() - start,
  };
}

async function checkPRReviews(): Promise<CheckResult> {
  const start = Date.now();
  const alerts: Alert[] = [];

  try {
    const output = execSync('gh pr list --search "review-requested:@me" --json number,title --limit 10 2>/dev/null', {
      encoding: 'utf8',
      timeout: 15000,
      cwd: PROJECT_ROOT,
    });

    const prs = JSON.parse(output);
    if (prs.length > 0) {
      alerts.push({
        check: 'pr_reviews',
        severity: 'info',
        message: `${prs.length} PR(s) awaiting your review`,
        data: { count: prs.length, prs: prs.map((p: { number: number; title: string }) => `#${p.number}: ${p.title}`) },
      });
    }
  } catch {
    // gh not available — silent skip
  }

  return {
    check: 'pr_reviews',
    status: alerts.length > 0 ? 'alert' : 'ok',
    alerts,
    duration_ms: Date.now() - start,
  };
}

async function checkStaleTasks(config: HeartbeatConfig): Promise<CheckResult> {
  const start = Date.now();
  const alerts: Alert[] = [];
  const cutoff = new Date(Date.now() - config.stale_task_hours * 60 * 60 * 1000);

  try {
    const data = JSON.parse(readFileSync(TASKS_PATH, 'utf8'));

    for (const task of data.tasks || []) {
      if (task.status === 'completed') continue;
      const updated = new Date(task.updated || task.created);
      if (updated < cutoff) {
        alerts.push({
          check: 'stale_tasks',
          severity: 'warning',
          message: `Stale task: "${task.task}" (last updated ${task.updated || task.created})`,
          data: { task_id: task.id, status: task.status, assignee: task.assignee },
        });
      }
    }
  } catch { /* file missing */ }

  return {
    check: 'stale_tasks',
    status: alerts.length > 0 ? 'alert' : 'ok',
    alerts,
    duration_ms: Date.now() - start,
  };
}

async function checkErrorSpikes(config: HeartbeatConfig): Promise<CheckResult> {
  const start = Date.now();
  const alerts: Alert[] = [];
  const windowMs = config.error_spike_window_hours * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs);

  try {
    const lines = readFileSync(EVENTS_PATH, 'utf8').trim().split('\n').filter(Boolean);
    let recentErrors = 0;

    // Read from end for efficiency
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        let line = lines[i]!;
        // Fix double-closing brace issue from event writer
        while (line.endsWith('}}') && !line.endsWith('"}}')) {
          line = line.slice(0, -1);
        }
        const event = JSON.parse(line);
        const ts = new Date(event.ts);

        if (ts < cutoff) break; // Events are chronological

        if (event.type === 'ci:fail' || event.type === 'heartbeat:alert') {
          recentErrors++;
        }
      } catch { continue; }
    }

    if (recentErrors >= config.error_spike_threshold) {
      alerts.push({
        check: 'error_spikes',
        severity: 'critical',
        message: `Error spike: ${recentErrors} failure(s) in last ${config.error_spike_window_hours}h (threshold: ${config.error_spike_threshold})`,
        data: { errors: recentErrors, window_hours: config.error_spike_window_hours },
      });
    }
  } catch { /* file missing */ }

  return {
    check: 'error_spikes',
    status: alerts.length > 0 ? 'alert' : 'ok',
    alerts,
    duration_ms: Date.now() - start,
  };
}

// ============ Run All Checks ============

async function runChecks(): Promise<CheckResult[]> {
  const config = loadConfig();

  if (!config.enabled) {
    log('Heartbeat disabled in config — skipping checks');
    return [];
  }

  const results: CheckResult[] = [];

  if (config.checks.reminders) results.push(await checkReminders());
  if (config.checks.ci_status) results.push(await checkCIStatus());
  if (config.checks.pr_reviews) results.push(await checkPRReviews());
  if (config.checks.stale_tasks) results.push(await checkStaleTasks(config));
  if (config.checks.error_spikes) results.push(await checkErrorSpikes(config));

  const allAlerts = results.flatMap(r => r.alerts);
  totalChecks++;
  totalAlerts += allAlerts.length;
  lastCheck = new Date();
  lastResults = results;

  // Log check event
  writeEvent('heartbeat:check', JSON.stringify({
    checks_run: results.length,
    alerts: allAlerts.length,
    status: allAlerts.length > 0 ? 'ALERTS' : 'OK',
  }));

  // Log individual alerts
  for (const alert of allAlerts) {
    writeEvent('heartbeat:alert', JSON.stringify({
      check: alert.check,
      severity: alert.severity,
      message: alert.message,
    }));
    log(`ALERT [${alert.severity}] ${alert.message}`);
  }

  if (allAlerts.length === 0) {
    log(`Check complete — all ${results.length} checks OK`);
  } else {
    log(`Check complete — ${allAlerts.length} alert(s) from ${results.length} checks`);
    await notify(allAlerts, config);
    // Phase A: Trigger event dispatcher after alerts are logged
    await triggerDispatcher(allAlerts);
  }

  return results;
}

// ============ Notification ============

async function notify(alerts: Alert[], config: HeartbeatConfig): Promise<void> {
  // Gateway notification (future — Track B)
  if (config.notify.gateway && config.notify.fallback !== 'log') {
    // TODO: Send via WebSocket to gateway when Track B is implemented
  }

  // Fallback: log to file
  const logPath = join(LOG_DIR, 'heartbeat-alerts.log');
  const timestamp = new Date().toISOString();
  const lines = alerts.map(a => `[${timestamp}] [${a.severity.toUpperCase()}] [${a.check}] ${a.message}`);
  try {
    const existing = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    writeFileSync(logPath, existing + lines.join('\n') + '\n');
  } catch { /* log dir might not exist */ }
}

// ============ Event Dispatcher Integration (Phase A / ADR-016) ============

async function triggerDispatcher(alerts: Alert[]): Promise<void> {
  const dispatcherPath = join(PROJECT_ROOT, '.claude', 'hooks', 'pulse-event-dispatcher.sh');

  if (!existsSync(dispatcherPath)) {
    log('Event dispatcher not found — skipping dispatch');
    return;
  }

  const hasCritical = alerts.some(a => a.severity === 'critical');
  if (!hasCritical) {
    log('No critical alerts — dispatcher will run at next session boot');
    return;
  }

  try {
    const output = execSync(`bash "${dispatcherPath}" --check-only`, {
      encoding: 'utf8',
      timeout: 10000,
      cwd: PROJECT_ROOT,
      env: { ...process.env, PROJECT_ROOT },
    });
    log(`Dispatcher: ${output.trim()}`);

    // Write dispatch-ready event so next session picks it up
    writeEvent('dispatch:ready', JSON.stringify({
      critical_alerts: alerts.filter(a => a.severity === 'critical').length,
      source: 'heartbeat',
      message: 'Critical alerts detected — dispatches queued for next session',
    }));
  } catch (err) {
    log(`Dispatcher check failed: ${err}`);
  }
}

// ============ Event Writer ============

function writeEvent(type: string, dataJson: string): void {
  try {
    execSync(`bash "${EVENT_WRITER}" "${type}" "Heartbeat" '${dataJson.replace(/'/g, "'\\''")}'`, {
      timeout: 5000,
      cwd: PROJECT_ROOT,
    });
  } catch {
    // Fallback: write directly
    try {
      const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const event = `{"ts":"${ts}","type":"${type}","agent":"Heartbeat","session":"heartbeat-daemon","data":${dataJson}}\n`;
      const existing = existsSync(EVENTS_PATH) ? readFileSync(EVENTS_PATH, 'utf8') : '';
      writeFileSync(EVENTS_PATH, existing + event);
    } catch { /* give up */ }
  }
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
        startTime: startTime?.toISOString(),
        lastCheck: lastCheck?.toISOString(),
        totalChecks,
        totalAlerts,
        uptime_seconds: startTime ? Math.floor((Date.now() - startTime.getTime()) / 1000) : 0,
      }));
    } else if (url.pathname === '/last-check') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        lastCheck: lastCheck?.toISOString(),
        results: lastResults,
      }));
    } else if (url.pathname === '/check') {
      // Trigger immediate check
      runChecks().then(results => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      }).catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      });
      return; // async response
    } else if (req.method === 'POST' && url.pathname === '/stop') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'stopping' }));
      shutdown();
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', endpoints: ['/status', '/last-check', '/check', '/stop'] }));
    }
  });

  httpServer.listen(DAEMON_PORT, '127.0.0.1', () => {
    log(`HTTP health endpoint on http://127.0.0.1:${DAEMON_PORT}`);
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`Port ${DAEMON_PORT} already in use — another heartbeat may be running`);
      process.exit(1);
    }
  });
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
    // Check if alive
    try { process.kill(pid, 0); return pid; } catch { return null; }
  } catch { return null; }
}

function cleanupPid(): void {
  try { unlinkSync(PID_FILE); } catch { /* ok */ }
}

// ============ Lifecycle ============

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[heartbeat ${ts}] ${msg}`);
}

function shutdown(): void {
  log('Shutting down...');
  writeEvent('heartbeat:stop', '{}');

  if (intervalHandle) clearInterval(intervalHandle);
  if (httpServer) httpServer.close();
  cleanupPid();

  setTimeout(() => process.exit(0), 500);
}

async function start(): Promise<void> {
  // Check for existing daemon
  const existingPid = readPid();
  if (existingPid) {
    log(`Already running (PID ${existingPid}). Use 'stop' to stop it first.`);
    process.exit(1);
  }

  const config = loadConfig();
  startTime = new Date();

  log(`Starting — interval: ${config.interval_minutes}min, port: ${DAEMON_PORT}`);
  log(`Project: ${PROJECT_ROOT}`);
  log(`Checks: ${Object.entries(config.checks).filter(([, v]) => v).map(([k]) => k).join(', ')}`);

  // Write PID
  writePid();

  // Start HTTP server
  startHttpServer();

  // Log start event
  writeEvent('heartbeat:start', JSON.stringify({
    interval_minutes: config.interval_minutes,
    port: DAEMON_PORT,
    checks: config.checks,
  }));

  // Run initial check
  await runChecks();

  // Schedule periodic checks
  const intervalMs = config.interval_minutes * 60 * 1000;
  intervalHandle = setInterval(() => {
    runChecks().catch(err => log(`Check error: ${err}`));
  }, intervalMs);

  // Graceful shutdown
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  log('Running. Press Ctrl+C or POST /stop to exit.');
}

function stop(): void {
  const pid = readPid();
  if (!pid) {
    console.log('[heartbeat] Not running');
    process.exit(0);
  }

  console.log(`[heartbeat] Stopping PID ${pid}...`);

  // Try HTTP stop first
  try {
    execSync(`curl -s -X POST http://127.0.0.1:${DAEMON_PORT}/stop`, { timeout: 3000 });
    console.log('[heartbeat] Stop signal sent');
  } catch {
    // Fallback to SIGTERM
    try {
      process.kill(pid, 'SIGTERM');
      console.log('[heartbeat] SIGTERM sent');
    } catch {
      console.log('[heartbeat] Process already gone');
    }
  }

  cleanupPid();
}

function status(): void {
  const pid = readPid();
  if (!pid) {
    console.log('[heartbeat] Status: stopped');
    process.exit(1);
  }

  try {
    const output = execSync(`curl -s http://127.0.0.1:${DAEMON_PORT}/status`, {
      encoding: 'utf8',
      timeout: 3000,
    });
    const info = JSON.parse(output);
    console.log(`[heartbeat] Status: running (PID ${info.pid}, uptime ${info.uptime_seconds}s, ${info.totalChecks} checks, ${info.totalAlerts} alerts)`);
  } catch {
    console.log(`[heartbeat] Status: running (PID ${pid}) — API not responding`);
  }
}

// ============ CLI ============

const command = process.argv[2] || 'start';

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
    console.log(`Usage: bun run src/heartbeat/heartbeat-daemon.ts [start|stop|status]`);
    process.exit(1);
}
