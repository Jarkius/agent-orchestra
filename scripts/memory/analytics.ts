#!/usr/bin/env bun
/**
 * Memory Analytics - View behavioral logging statistics
 *
 * Usage:
 *   bun memory analytics              # Show overview dashboard
 *   bun memory analytics search       # Search query analytics
 *   bun memory analytics consult      # Oracle consultation analytics
 *   bun memory analytics decisions    # Active decisions list
 *   bun memory analytics access       # Resource access analytics
 *   bun memory analytics learnings    # Learning event analytics
 */

import { parseArgs } from 'util';
import {
  getSearchAnalytics,
  getRecentSearches,
  getConsultAnalytics,
  getConsultHistory,
  listAllDecisions,
  getMostAccessedResources,
  getRecentLearningEvents,
} from '../../src/db/behavioral-logs';

// Parse command line arguments
const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h' },
    json: { type: 'boolean', short: 'j' },
    limit: { type: 'string', short: 'n' },
  },
  allowPositionals: true,
});

const subcommand = positionals[0] || 'overview';
const asJson = values.json;
const limit = values.limit ? parseInt(values.limit, 10) : 10;

function printHelp() {
  console.log(`
📊 Memory Analytics - Behavioral Logging Statistics

Usage:
  bun memory analytics [subcommand] [options]

Subcommands:
  overview       Show dashboard with all stats (default)
  search         Search query analytics
  consult        Oracle consultation analytics
  decisions      Active decisions list
  access         Resource access analytics
  learnings      Learning event analytics

Options:
  -j, --json     Output as JSON
  -n, --limit    Limit results (default: 10)
  -h, --help     Show this help

Examples:
  bun memory analytics                 # Full dashboard
  bun memory analytics search          # Search stats
  bun memory analytics decisions       # List active decisions
  bun memory analytics --json          # JSON output
`);
}

function formatOverview() {
  const searchStats = getSearchAnalytics();
  const consultStats = getConsultAnalytics();
  const decisions = listAllDecisions(false);
  const topResources = getMostAccessedResources(undefined, 5);

  if (asJson) {
    console.log(JSON.stringify({
      search: searchStats,
      consult: consultStats,
      decisions: { count: decisions.length, items: decisions.slice(0, 5) },
      access: { topResources },
    }, null, 2));
    return;
  }

  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│       📊 Memory Analytics Dashboard     │');
  console.log('└─────────────────────────────────────────┘\n');

  // Search Stats
  console.log('\x1b[36m━━━ Search Queries ━━━\x1b[0m');
  console.log(`  Total queries: ${searchStats.totalQueries}`);
  console.log(`  Avg latency: ${searchStats.avgLatency?.toFixed(1) || 'N/A'}ms`);
  if (searchStats.queryTypeBreakdown.length > 0) {
    console.log('  By type:');
    for (const { query_type, count } of searchStats.queryTypeBreakdown) {
      console.log(`    ${query_type || 'unknown'}: ${count}`);
    }
  }
  console.log('');

  // Consult Stats
  console.log('\x1b[36m━━━ Oracle Consultations ━━━\x1b[0m');
  console.log(`  Total consults: ${consultStats.totalConsults}`);
  console.log(`  Escalation rate: ${(consultStats.escalationRate * 100).toFixed(1)}%`);
  if (consultStats.questionTypeBreakdown.length > 0) {
    console.log('  By type:');
    for (const { question_type, count } of consultStats.questionTypeBreakdown) {
      console.log(`    ${question_type || 'unknown'}: ${count}`);
    }
  }
  console.log('');

  // Decisions
  console.log('\x1b[36m━━━ Active Decisions ━━━\x1b[0m');
  console.log(`  Total active: ${decisions.length}`);
  if (decisions.length > 0) {
    console.log('  Recent:');
    for (const d of decisions.slice(0, 3)) {
      console.log(`    • ${d.title}`);
    }
  }
  console.log('');

  // Access Stats
  console.log('\x1b[36m━━━ Most Accessed Resources ━━━\x1b[0m');
  if (topResources.length > 0) {
    for (const r of topResources) {
      console.log(`  ${r.access_count}x ${r.resource_type}: ${r.resource_id}`);
    }
  } else {
    console.log('  No access data yet');
  }
  console.log('');
}

function formatSearchAnalytics() {
  const stats = getSearchAnalytics();
  const recent = getRecentSearches(limit);

  if (asJson) {
    console.log(JSON.stringify({ stats, recentSearches: recent }, null, 2));
    return;
  }

  console.log('\n\x1b[36m━━━ Search Analytics ━━━\x1b[0m\n');
  console.log(`Total queries: ${stats.totalQueries}`);
  console.log(`Avg latency: ${stats.avgLatency?.toFixed(1) || 'N/A'}ms`);

  if (stats.queryTypeBreakdown.length > 0) {
    console.log('\nBy query type:');
    for (const { query_type, count } of stats.queryTypeBreakdown) {
      const pct = ((count / stats.totalQueries) * 100).toFixed(1);
      console.log(`  ${query_type || 'unknown'}: ${count} (${pct}%)`);
    }
  }

  if (stats.topQueries.length > 0) {
    console.log('\nTop queries:');
    for (const { query, count, avg_results } of stats.topQueries) {
      console.log(`  ${count}x "${query.slice(0, 40)}${query.length > 40 ? '...' : ''}" (avg ${avg_results?.toFixed(1) || '?'} results)`);
    }
  }

  if (recent.length > 0) {
    console.log('\nRecent searches:');
    for (const s of recent.slice(0, 5)) {
      const latency = s.latency_ms ? `${s.latency_ms}ms` : '?';
      console.log(`  [${s.query_type || '?'}] "${s.query.slice(0, 35)}${s.query.length > 35 ? '...' : ''}" → ${s.result_count ?? '?'} results (${latency})`);
    }
  }
  console.log('');
}

function formatConsultAnalytics() {
  const stats = getConsultAnalytics();
  const recent = getConsultHistory(undefined, limit);

  if (asJson) {
    console.log(JSON.stringify({ stats, recentConsults: recent }, null, 2));
    return;
  }

  console.log('\n\x1b[36m━━━ Oracle Consultation Analytics ━━━\x1b[0m\n');
  console.log(`Total consultations: ${stats.totalConsults}`);
  console.log(`Escalation rate: ${(stats.escalationRate * 100).toFixed(1)}%`);

  if (stats.questionTypeBreakdown.length > 0) {
    console.log('\nBy question type:');
    for (const { question_type, count } of stats.questionTypeBreakdown) {
      const pct = ((count / stats.totalConsults) * 100).toFixed(1);
      console.log(`  ${question_type}: ${count} (${pct}%)`);
    }
  }

  if (stats.commonStuckPoints.length > 0) {
    console.log('\nCommon stuck points:');
    for (const { question, count } of stats.commonStuckPoints.slice(0, 5)) {
      console.log(`  ${count}x "${question.slice(0, 50)}${question.length > 50 ? '...' : ''}"`);
    }
  }

  if (recent.length > 0) {
    console.log('\nRecent consultations:');
    for (const c of recent.slice(0, 5)) {
      const escalated = c.escalated ? ' [ESCALATED]' : '';
      console.log(`  [${c.question_type}] Agent ${c.agent_id || '?'}: "${c.question.slice(0, 40)}${c.question.length > 40 ? '...' : ''}"${escalated}`);
    }
  }
  console.log('');
}

function formatDecisions() {
  const decisions = listAllDecisions(false);

  if (asJson) {
    console.log(JSON.stringify({ decisions }, null, 2));
    return;
  }

  console.log('\n\x1b[36m━━━ Active Decisions ━━━\x1b[0m\n');
  console.log(`Total active decisions: ${decisions.length}\n`);

  if (decisions.length === 0) {
    console.log('No decisions recorded yet.');
    console.log('Use the record_decision MCP tool to capture architectural decisions.\n');
    return;
  }

  for (const d of decisions.slice(0, limit)) {
    console.log(`📋 \x1b[1m${d.title}\x1b[0m`);
    console.log(`   ${d.decision}`);
    if (d.rationale) {
      console.log(`   \x1b[2mRationale: ${d.rationale.slice(0, 80)}${d.rationale.length > 80 ? '...' : ''}\x1b[0m`);
    }
    if (d.alternatives && d.alternatives.length > 0) {
      console.log(`   \x1b[2mAlternatives: ${d.alternatives.join(', ')}\x1b[0m`);
    }
    console.log(`   \x1b[2mCreated: ${d.created_at}\x1b[0m`);
    console.log('');
  }
}

function formatAccessAnalytics() {
  const topResources = getMostAccessedResources(undefined, limit);

  if (asJson) {
    console.log(JSON.stringify({ topResources }, null, 2));
    return;
  }

  console.log('\n\x1b[36m━━━ Resource Access Analytics ━━━\x1b[0m\n');

  if (topResources.length === 0) {
    console.log('No access data yet.\n');
    return;
  }

  console.log('Most accessed resources:');
  for (const r of topResources) {
    console.log(`  ${r.access_count}x [${r.resource_type}] ${r.resource_id}`);
  }
  console.log('');

  // Show by type
  const learningAccess = getMostAccessedResources('learning', 5);
  if (learningAccess.length > 0) {
    console.log('\nTop learnings:');
    for (const r of learningAccess) {
      console.log(`  ${r.access_count}x Learning #${r.resource_id}`);
    }
  }

  const sessionAccess = getMostAccessedResources('session', 5);
  if (sessionAccess.length > 0) {
    console.log('\nTop sessions:');
    for (const r of sessionAccess) {
      console.log(`  ${r.access_count}x ${r.resource_id}`);
    }
  }
  console.log('');
}

function formatLearningEvents() {
  const recent = getRecentLearningEvents(limit);

  if (asJson) {
    console.log(JSON.stringify({ recentEvents: recent }, null, 2));
    return;
  }

  console.log('\n\x1b[36m━━━ Learning Event Analytics ━━━\x1b[0m\n');

  if (recent.length === 0) {
    console.log('No learning events yet.\n');
    return;
  }

  console.log('Recent learning events:');
  for (const e of recent) {
    const change = e.previous_value && e.new_value
      ? `${e.previous_value} → ${e.new_value}`
      : e.new_value || e.previous_value || '';
    console.log(`  [${e.event_type}] Learning #${e.learning_id}: ${change}`);
    if (e.source_event) {
      console.log(`    \x1b[2mSource: ${e.source_event}\x1b[0m`);
    }
  }
  console.log('');
}

async function main() {
  if (values.help) {
    printHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'overview':
    case 'dashboard':
      formatOverview();
      break;
    case 'search':
      formatSearchAnalytics();
      break;
    case 'consult':
    case 'consultations':
      formatConsultAnalytics();
      break;
    case 'decisions':
    case 'decision':
      formatDecisions();
      break;
    case 'access':
      formatAccessAnalytics();
      break;
    case 'learnings':
    case 'learning':
    case 'events':
      formatLearningEvents();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

main().catch(console.error);
