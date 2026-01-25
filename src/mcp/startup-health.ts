/**
 * MCP Startup Health Check
 * Detects fresh clone state and outputs guidance without blocking startup
 */

import { existsSync } from 'fs';
import { getSystemStateQuick } from '../db';

const DB_PATH = './agents.db';

export interface FreshCloneIndicators {
  dbMissing: boolean;
  dbEmpty: boolean;
  noSessions: boolean;
  noLearnings: boolean;
  noCodeIndex: boolean;
  chromadbDown: boolean;
  hubDown: boolean;
  daemonDown: boolean;
}

export interface StartupHealth {
  isFreshClone: boolean;
  indicators: FreshCloneIndicators;
  severity: 'healthy' | 'needs_setup' | 'degraded';
  guidance: string[];
  stats: {
    agents: number;
    sessions: number;
    learnings: number;
    codeFiles: number;
  };
}

async function checkService(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

export async function checkStartupHealth(): Promise<StartupHealth> {
  const indicators: FreshCloneIndicators = {
    dbMissing: false,
    dbEmpty: false,
    noSessions: false,
    noLearnings: false,
    noCodeIndex: false,
    chromadbDown: false,
    hubDown: false,
    daemonDown: false,
  };

  let stats = { agents: 0, sessions: 0, learnings: 0, codeFiles: 0 };

  // Check database existence
  indicators.dbMissing = !existsSync(DB_PATH);

  if (!indicators.dbMissing) {
    // Check database content
    try {
      const state = getSystemStateQuick();
      stats = {
        agents: state.agentCount,
        sessions: state.sessionCount,
        learnings: state.learningCount,
        codeFiles: state.codeFileCount,
      };

      indicators.dbEmpty = !state.hasAgents;
      indicators.noSessions = !state.hasSessions;
      indicators.noLearnings = !state.hasLearnings;
      indicators.noCodeIndex = !state.hasCodeIndex;
    } catch {
      indicators.dbEmpty = true;
    }
  }

  // Check services (parallel with short timeout)
  const chromaPort = process.env.CHROMA_PORT || '8100';
  const hubPort = process.env.MATRIX_HUB_PORT || '8081';
  const daemonPort = process.env.MATRIX_DAEMON_PORT || '37888';

  const [chromaOk, hubOk, daemonOk] = await Promise.all([
    checkService(`http://localhost:${chromaPort}/api/v2/heartbeat`),
    checkService(`http://localhost:${hubPort}/health`),
    checkService(`http://localhost:${daemonPort}/status`),
  ]);

  indicators.chromadbDown = !chromaOk;
  indicators.hubDown = !hubOk;
  indicators.daemonDown = !daemonOk;

  // Determine severity and build guidance
  const guidance: string[] = [];
  let severity: 'healthy' | 'needs_setup' | 'degraded' = 'healthy';

  // Fresh clone detection: DB missing or empty with no sessions/learnings
  const isFreshClone = indicators.dbMissing ||
    (indicators.dbEmpty && indicators.noSessions && indicators.noLearnings);

  if (isFreshClone) {
    severity = 'needs_setup';
    guidance.push('Run setup for full functionality:');
    guidance.push('  ./scripts/setup.sh');
    guidance.push('');
    guidance.push('Or quick init:');
    guidance.push('  bun memory init');
  } else {
    // Check individual components
    if (indicators.chromadbDown) {
      severity = 'degraded';
      guidance.push('ChromaDB not running - semantic search disabled');
      guidance.push('  Start: docker start chromadb');
    }

    if (indicators.noCodeIndex) {
      if (severity !== 'needs_setup') severity = 'degraded';
      guidance.push('Code index empty - fast search unavailable');
      guidance.push('  Index: bun memory index once');
    }

    if (indicators.hubDown || indicators.daemonDown) {
      // Not critical - just informational
      guidance.push('Matrix communication not available');
      guidance.push('  Start: bun memory init');
    }
  }

  return {
    isFreshClone,
    indicators,
    severity,
    guidance,
    stats,
  };
}

export function formatStartupWarning(health: StartupHealth): string {
  if (health.severity === 'healthy') {
    return '';
  }

  const lines: string[] = [];

  if (health.severity === 'needs_setup') {
    lines.push('');
    lines.push('╔════════════════════════════════════════════════════════════════╗');
    lines.push('║  ⚠️  FRESH CLONE DETECTED - Setup Required                      ║');
    lines.push('╠════════════════════════════════════════════════════════════════╣');
    lines.push('║                                                                ║');
    lines.push('║  Run setup for full functionality:                             ║');
    lines.push('║    ./scripts/setup.sh                                          ║');
    lines.push('║                                                                ║');
    lines.push('║  Or quick init:                                                ║');
    lines.push('║    bun memory init                                             ║');
    lines.push('║                                                                ║');
    lines.push('╚════════════════════════════════════════════════════════════════╝');
    lines.push('');
  } else {
    lines.push('');
    lines.push('[MCP] ⚠️  System Health Issues:');
    for (const line of health.guidance) {
      lines.push(`[MCP]   ${line}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
