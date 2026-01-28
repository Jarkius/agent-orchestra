#!/usr/bin/env bun
/**
 * sync-to-psi.ts - Export high-confidence learnings to The Matrix psi/memory/
 *
 * Usage:
 *   bun memory sync-to-psi              # Export all high+ confidence learnings
 *   bun memory sync-to-psi --proven     # Export only proven learnings
 *   bun memory sync-to-psi --all        # Export all learnings (any confidence)
 *   bun memory sync-to-psi --dry-run    # Show what would be exported
 *
 * Exports to: ~/workspace/The-matrix/psi/memory/learnings/{category}/
 */

import { getAllLearnings, type Learning } from '../../src/db';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';

// Configuration
const PSI_PATHS = [
  '/Users/jarkius/workspace/The-matrix/psi/memory/learnings',
  `${process.env.HOME}/workspace/The-matrix/psi/memory/learnings`,
];

const VOICE_BRIDGE = join(dirname(import.meta.path), 'voice-bridge.sh');

// Find psi learnings directory
function findPsiLearningsDir(): string | null {
  for (const path of PSI_PATHS) {
    if (existsSync(dirname(path))) {
      return path;
    }
  }
  return null;
}

// Format learning as markdown
function formatLearningAsMarkdown(learning: Learning): string {
  const date = new Date(learning.createdAt).toISOString().split('T')[0];
  const icon = getCategoryIcon(learning.category);

  return `# ${icon} ${learning.title}

> **Category**: ${learning.category}
> **Confidence**: ${learning.confidence}
> **Created**: ${date}
> **Source**: Agent Orchestra (matrix-memory-agents)

## Content

${learning.content}

${learning.context ? `## Context\n\n${learning.context}\n` : ''}
${learning.source ? `## Source\n\n${learning.source}\n` : ''}

---

*Synced from Agent Orchestra SQLite on ${new Date().toISOString()}*
*Learning ID: ${learning.id}*
`;
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    performance: '⚡',
    architecture: '🏛️',
    tooling: '🔧',
    debugging: '🔍',
    security: '🔒',
    testing: '🧪',
    process: '📋',
    philosophy: '🌟',
    principle: '⚖️',
    insight: '💡',
    pattern: '🔄',
    retrospective: '📖',
  };
  return icons[category] || '📝';
}

// Generate filename from learning
function generateFilename(learning: Learning): string {
  const date = new Date(learning.createdAt).toISOString().split('T')[0];
  const slug = learning.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return `${date}_${slug}.md`;
}

// Check if learning already exported
function isAlreadyExported(psiDir: string, learning: Learning): boolean {
  const categoryDir = join(psiDir, learning.category);
  const filename = generateFilename(learning);
  const filepath = join(categoryDir, filename);

  if (!existsSync(filepath)) return false;

  // Check if content matches (by learning ID)
  const content = readFileSync(filepath, 'utf-8');
  return content.includes(`Learning ID: ${learning.id}`);
}

// Voice announcement
function announce(message: string, agent: string = 'Scribe') {
  if (existsSync(VOICE_BRIDGE)) {
    try {
      execSync(`sh "${VOICE_BRIDGE}" "${message}" "${agent}"`, { stdio: 'inherit' });
    } catch {
      // Silently fail voice - not critical
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const provenOnly = args.includes('--proven');
  const exportAll = args.includes('--all');
  const dryRun = args.includes('--dry-run');

  console.log('🔄 Sync to psi/ - Export learnings to The Matrix\n');

  // Find psi directory
  const psiDir = findPsiLearningsDir();
  if (!psiDir) {
    console.error('❌ Could not find psi/memory/learnings directory');
    console.error('   Expected: ~/workspace/The-matrix/psi/memory/learnings/');
    process.exit(1);
  }

  console.log(`📁 Target: ${psiDir}`);

  // Get learnings from SQLite
  const allLearnings = await getAllLearnings();

  // Filter by confidence
  let learnings: Learning[];
  if (provenOnly) {
    learnings = allLearnings.filter(l => l.confidence === 'proven');
    console.log(`🎯 Filter: proven only`);
  } else if (exportAll) {
    learnings = allLearnings;
    console.log(`🎯 Filter: all learnings`);
  } else {
    learnings = allLearnings.filter(l =>
      l.confidence === 'high' || l.confidence === 'proven'
    );
    console.log(`🎯 Filter: high + proven confidence`);
  }

  console.log(`📊 Found ${learnings.length} learnings to consider\n`);

  if (learnings.length === 0) {
    console.log('No learnings to export.');
    return;
  }

  // Export each learning
  let exported = 0;
  let skipped = 0;

  for (const learning of learnings) {
    const categoryDir = join(psiDir, learning.category);
    const filename = generateFilename(learning);
    const filepath = join(categoryDir, filename);

    // Check if already exported
    if (isAlreadyExported(psiDir, learning)) {
      skipped++;
      if (dryRun) {
        console.log(`  ⏭️  Skip (exists): ${learning.category}/${filename}`);
      }
      continue;
    }

    if (dryRun) {
      console.log(`  📝 Would export: ${learning.category}/${filename}`);
      console.log(`     Title: ${learning.title}`);
      console.log(`     Confidence: ${learning.confidence}`);
      exported++;
      continue;
    }

    // Create category directory if needed
    if (!existsSync(categoryDir)) {
      mkdirSync(categoryDir, { recursive: true });
    }

    // Write markdown file
    const content = formatLearningAsMarkdown(learning);
    writeFileSync(filepath, content);

    console.log(`  ✅ Exported: ${learning.category}/${filename}`);
    exported++;
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Exported: ${exported}`);
  console.log(`   Skipped:  ${skipped} (already exist)`);

  if (!dryRun && exported > 0) {
    announce(`Exported ${exported} learnings to psi memory.`, 'Scribe');

    console.log(`\n💡 Next steps:`);
    console.log(`   cd ~/workspace/The-matrix`);
    console.log(`   git add psi/memory/learnings/`);
    console.log(`   git commit -m "feat(memory): Sync learnings from Agent Orchestra"`);
  }
}

main().catch(console.error);
