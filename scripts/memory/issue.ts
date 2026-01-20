#!/usr/bin/env bun
/**
 * /memory-issue - Report issues for awareness and tracking
 *
 * Usage:
 *   bun memory issue "Title" --severity high --component chromadb
 *   bun memory issue "Bug description" -s critical -c memory --github
 *
 * Severity levels: critical, high, medium, low
 * Components: chromadb, sqlite, memory, mcp, agent, cli, other
 */

import { createLearning, updateLearning, db } from '../../src/db';
import { $ } from 'bun';

interface IssueRecord {
  id: number;
  title: string;
  lesson: string;
  prevention: string | null;
  source_url: string | null;
  created_at: string;
}

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

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'bug,priority:critical',
  high: 'bug,priority:high',
  medium: 'bug',
  low: 'bug,priority:low',
};

function listPendingIssues(): IssueRecord[] {
  const rows = db.query(`
    SELECT id, title, lesson, prevention, source_url, created_at
    FROM learnings
    WHERE category = 'debugging' AND title LIKE '[%]%' AND (source_url IS NULL OR source_url = '')
    ORDER BY id DESC
    LIMIT 50
  `).all() as IssueRecord[];
  return rows;
}

function getIssueById(id: number): IssueRecord | null {
  const row = db.query(`
    SELECT id, title, lesson, prevention, source_url, created_at
    FROM learnings
    WHERE id = ? AND category = 'debugging'
  `).get(id) as IssueRecord | null;
  return row;
}

async function promoteToGithub(issue: IssueRecord): Promise<string | null> {
  // Parse severity and component from lesson field
  const severityMatch = issue.lesson?.match(/Severity:\s*(\w+)/);
  const severity = (severityMatch?.[1] || 'medium') as Severity;

  // Parse component from title [component]
  const componentMatch = issue.title.match(/^\[(\w+)\]/);
  const component = componentMatch?.[1] || 'other';

  // Parse repro from lesson
  const reproMatch = issue.lesson?.match(/Repro:\s*(.+?)(?:\||$)/);
  const repro = reproMatch?.[1]?.trim() || '';

  // Parse fix from prevention
  const fix = issue.prevention?.replace(/^Fix:\s*/, '') || '';

  const body = `## Issue Details

**Severity:** ${severity}
**Component:** ${component}
**Memory Issue ID:** #${issue.id}
**Reported:** ${issue.created_at}

${repro ? `## Steps to Reproduce\n${repro}\n` : ''}
${fix ? `## Known Fix/Workaround\n${fix}\n` : ''}

---
*Promoted from memory issue tracking system*
`;

  try {
    // Try with labels first, fall back to no labels
    let result: string;
    try {
      const labels = `${SEVERITY_LABELS[severity]},component:${component}`;
      result = await $`gh issue create --title ${issue.title} --body ${body} --label ${labels} 2>&1`.text();
    } catch {
      result = await $`gh issue create --title ${issue.title} --body ${body} 2>&1`.text();
    }

    const urlMatch = result.match(/(https:\/\/github\.com\/[^\s]+)/);
    if (urlMatch) {
      updateLearning(issue.id, { source_url: urlMatch[1] });
      return urlMatch[1];
    }
    return result.trim();
  } catch (error: any) {
    return null;
  }
}

function printHelp() {
  console.log(`
🐛 Memory Issue - Report issues for awareness and tracking

Usage:
  bun memory issue "Title" --severity high --component chromadb
  bun memory issue "Bug description" -s critical -c memory --repro "Steps to reproduce"
  bun memory issue "Title" --github              # Also create GitHub issue
  bun memory issue --list                        # List issues not yet on GitHub
  bun memory issue --promote <id>                # Promote existing issue to GitHub

Options:
  --severity, -s   Severity level: ${SEVERITY_LEVELS.join(', ')} (default: medium)
  --component, -c  Component: ${COMPONENTS.join(', ')} (default: other)
  --repro, -r      Steps to reproduce
  --fix, -f        Known fix or workaround
  --github, -g     Also create GitHub issue (requires gh CLI)
  --list, -l       List issues not yet promoted to GitHub
  --promote, -p    Promote existing issue to GitHub by ID
  --help, -h       Show this help

Examples:
  bun memory issue "Save hangs on slow ChromaDB" -s high -c chromadb
  bun memory issue "Database corruption" -s critical -c sqlite --repro "Run concurrent writes"
  bun memory issue "Vector search not finding recent items" -s medium -c vector --fix "Run reindex"
  bun memory issue "Critical bug" -s critical -c memory --github
  bun memory issue --list                        # See pending issues from other clones
  bun memory issue --promote 1510                # Promote issue #1510 to GitHub
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  // Handle --list
  if (args[0] === '--list' || args[0] === '-l') {
    const issues = listPendingIssues();
    if (issues.length === 0) {
      console.log('\n✅ No pending issues (all promoted to GitHub)\n');
      return;
    }
    console.log(`\n🐛 Pending Issues (not yet on GitHub)\n`);
    console.log('─'.repeat(80));
    for (const issue of issues) {
      const severityMatch = issue.lesson?.match(/Severity:\s*(\w+)/);
      const severity = (severityMatch?.[1] || 'medium') as Severity;
      console.log(`  ${SEVERITY_ICONS[severity]} #${issue.id} ${issue.title}`);
      console.log(`     ${issue.lesson || ''}`);
      if (issue.prevention) console.log(`     ${issue.prevention}`);
      console.log('');
    }
    console.log(`Promote with: bun memory issue --promote <id>\n`);
    return;
  }

  // Handle --promote
  if (args[0] === '--promote' || args[0] === '-p') {
    const id = parseInt(args[1]);
    if (!id) {
      console.error('❌ Issue ID required: bun memory issue --promote <id>\n');
      process.exit(1);
    }
    const issue = getIssueById(id);
    if (!issue) {
      console.error(`❌ Issue #${id} not found\n`);
      process.exit(1);
    }
    if (issue.source_url) {
      console.log(`\n⚠️  Issue #${id} already on GitHub: ${issue.source_url}\n`);
      return;
    }
    console.log(`\n📤 Promoting issue #${id} to GitHub...`);
    const url = await promoteToGithub(issue);
    if (url) {
      console.log(`✅ Created: ${url}\n`);
    } else {
      console.log(`❌ Failed to create GitHub issue. Check gh CLI.\n`);
    }
    return;
  }

  // Parse args for new issue
  let title = '';
  let severity: Severity = 'medium';
  let component: Component = 'other';
  let repro = '';
  let fix = '';
  let createGithub = false;

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
    } else if (arg === '--github' || arg === '-g') {
      createGithub = true;
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
`);

  // Create GitHub issue if requested
  if (createGithub) {
    console.log('  Creating GitHub issue...');

    // Build issue body
    const body = `## Issue Details

**Severity:** ${severity}
**Component:** ${component}
**Memory Issue ID:** #${issueId}

${repro ? `## Steps to Reproduce\n${repro}\n` : ''}
${fix ? `## Known Fix/Workaround\n${fix}\n` : ''}

---
*Auto-created from memory issue tracking system*
`;

    try {
      // Try with labels first, fall back to no labels if they don't exist
      let result: string;
      try {
        const labels = `${SEVERITY_LABELS[severity]},component:${component}`;
        result = await $`gh issue create --title ${formattedTitle} --body ${body} --label ${labels} 2>&1`.text();
      } catch {
        // Labels might not exist, try without them
        result = await $`gh issue create --title ${formattedTitle} --body ${body} 2>&1`.text();
      }

      // Extract GitHub issue URL from result
      const urlMatch = result.match(/(https:\/\/github\.com\/[^\s]+)/);
      if (urlMatch) {
        const ghUrl = urlMatch[1];
        console.log(`  ✅ GitHub issue created: ${ghUrl}`);

        // Update the learning with the GitHub URL
        updateLearning(issueId, { source_url: ghUrl });
      } else {
        console.log(`  ✅ GitHub issue created`);
        console.log(`     ${result.trim()}`);
      }
    } catch (error: any) {
      console.log(`  ⚠️  GitHub issue creation failed: ${error.message || error}`);
      console.log(`     Make sure 'gh' CLI is installed and authenticated`);
    }
  }

  console.log(`Query issues: sqlite3 agents.db "SELECT id, title, lesson FROM learnings WHERE title LIKE '[%' AND category='debugging' ORDER BY id DESC LIMIT 10;"
Or search:    bun memory recall "[${component}]"
`);
}

main().catch(console.error);
