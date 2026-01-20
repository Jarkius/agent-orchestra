#!/usr/bin/env bun
/**
 * /memory-issue - Report issues for awareness and tracking
 *
 * Usage:
 *   bun memory issue "Title" --severity high --component chromadb
 *   bun memory issue "Bug description" -s critical -c memory
 *
 * Severity levels: critical, high, medium, low
 * Components: chromadb, sqlite, memory, mcp, agent, cli, other
 */

import { createLearning } from '../../src/db';

const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low'] as const;
const COMPONENTS = ['chromadb', 'sqlite', 'memory', 'mcp', 'agent', 'cli', 'vector', 'other'] as const;

type Severity = typeof SEVERITY_LEVELS[number];
type Component = typeof COMPONENTS[number];

const SEVERITY_ICONS: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};

function printHelp() {
  console.log(`
🐛 Memory Issue - Report issues for awareness and tracking

Usage:
  bun memory issue "Title" --severity high --component chromadb
  bun memory issue "Bug description" -s critical -c memory --repro "Steps to reproduce"

Options:
  --severity, -s   Severity level: ${SEVERITY_LEVELS.join(', ')} (default: medium)
  --component, -c  Component: ${COMPONENTS.join(', ')} (default: other)
  --repro, -r      Steps to reproduce
  --fix, -f        Known fix or workaround
  --help, -h       Show this help

Examples:
  bun memory issue "Save hangs on slow ChromaDB" -s high -c chromadb
  bun memory issue "Database corruption" -s critical -c sqlite --repro "Run concurrent writes"
  bun memory issue "Vector search not finding recent items" -s medium -c vector --fix "Run reindex"
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  // Parse args
  let title = '';
  let severity: Severity = 'medium';
  let component: Component = 'other';
  let repro = '';
  let fix = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '--severity' || arg === '-s') {
      if (next && SEVERITY_LEVELS.includes(next as Severity)) {
        severity = next as Severity;
        i++;
      }
    } else if (arg === '--component' || arg === '-c') {
      if (next && COMPONENTS.includes(next as Component)) {
        component = next as Component;
        i++;
      }
    } else if (arg === '--repro' || arg === '-r') {
      if (next) {
        repro = next;
        i++;
      }
    } else if (arg === '--fix' || arg === '-f') {
      if (next) {
        fix = next;
        i++;
      }
    } else if (!title && !arg.startsWith('-')) {
      title = arg;
    }
  }

  if (!title) {
    console.error('❌ Issue title is required\n');
    printHelp();
    process.exit(1);
  }

  // Format title with component tag
  const formattedTitle = `[${component}] ${title}`;

  // Build lesson field with severity and repro
  let lesson = `Severity: ${severity}`;
  if (repro) {
    lesson += ` | Repro: ${repro}`;
  }

  // Build prevention field with fix
  let prevention = '';
  if (fix) {
    prevention = `Fix: ${fix}`;
  }

  // Save as learning with category 'debugging'
  const issueId = createLearning({
    category: 'debugging',
    title: formattedTitle,
    confidence: 'low',
    agent_id: null,
    visibility: 'public',
    lesson,
    prevention: prevention || undefined,
  });

  console.log(`
${SEVERITY_ICONS[severity]} Issue #${issueId} reported

  Title:     ${formattedTitle}
  Severity:  ${severity}
  Component: ${component}
  ${repro ? `Repro:     ${repro}` : ''}
  ${fix ? `Fix:       ${fix}` : ''}

Query issues: sqlite3 agents.db "SELECT id, title, lesson FROM learnings WHERE title LIKE '[%' AND category='debugging' ORDER BY id DESC LIMIT 10;"
Or search:    bun memory recall "[${component}]"
`);
}

main().catch(console.error);
