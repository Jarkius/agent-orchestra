#!/usr/bin/env bun
/**
 * sync-from-psi.ts - Import retrospectives from The Matrix psi/memory/ into SQLite
 *
 * Usage:
 *   bun memory sync-from-psi              # Import new retrospectives
 *   bun memory sync-from-psi --all        # Re-import all (overwrite)
 *   bun memory sync-from-psi --dry-run    # Show what would be imported
 *
 * Imports from: ~/workspace/The-matrix/psi/memory/retrospectives/
 */

import { createSession, getSessionById, type SessionRecord } from '../../src/db';
import { initVectorDB, saveSession as saveSessionToVector } from '../../src/vector-db';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { execSync } from 'child_process';

// Configuration
const PSI_RETROSPECTIVE_PATHS = [
  '/Users/jarkius/workspace/The-matrix/psi/memory/retrospectives',
  `${process.env.HOME}/workspace/The-matrix/psi/memory/retrospectives`,
];

const VOICE_BRIDGE = join(dirname(import.meta.path), 'voice-bridge.sh');

// Find psi retrospectives directory
function findPsiRetrospectivesDir(): string | null {
  for (const path of PSI_RETROSPECTIVE_PATHS) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

// Recursively find all .md files
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

// Parse retrospective markdown into session data
function parseRetrospective(filepath: string, content: string): SessionRecord | null {
  // Extract title from first heading
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : basename(filepath, '.md');

  // Extract summary section
  const summaryMatch = content.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##|$)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : '';

  // Extract date from filename or content
  const dateMatch = filepath.match(/(\d{4}-\d{2}-\d{2})/);
  const timeMatch = filepath.match(/(\d{2}\.\d{2})/);

  let startedAt: string;
  if (dateMatch) {
    const date = dateMatch[1];
    const time = timeMatch ? timeMatch[1].replace('.', ':') : '12:00';
    startedAt = `${date}T${time}:00Z`;
  } else {
    // Use file mtime as fallback
    const stat = statSync(filepath);
    startedAt = stat.mtime.toISOString();
  }

  // Extract challenges/decisions
  const challengesMatch = content.match(/##\s*(?:Challenges|Key Decisions|Decisions)\s*\n([\s\S]*?)(?=\n##|$)/i);
  const challenges = challengesMatch ? challengesMatch[1].trim().split('\n').filter(l => l.trim()) : [];

  // Extract next steps
  const nextStepsMatch = content.match(/##\s*(?:Next Steps|Action Items)\s*\n([\s\S]*?)(?=\n##|$)/i);
  const nextSteps = nextStepsMatch ? nextStepsMatch[1].trim().split('\n').filter(l => l.trim()) : [];

  // Generate unique ID from filepath
  const relativePath = filepath.split('retrospectives/')[1] || basename(filepath);
  const id = `psi-retro-${relativePath.replace(/[^a-zA-Z0-9]/g, '-')}`;

  // Build full context with parsed content
  const fullContext = {
    title,
    content: content.slice(0, 4000),
    source: `psi/memory/retrospectives/${relativePath}`,
  };

  return {
    id,
    summary: summary || `${title} - Retrospective imported from ${relativePath}`,
    full_context: fullContext as any,
    started_at: startedAt,
    challenges,
    next_steps: nextSteps,
    tags: ['retrospective', 'psi-import'],
  };
}

// Voice announcement
function announce(message: string, agent: string = 'Tank') {
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
  const importAll = args.includes('--all');
  const dryRun = args.includes('--dry-run');

  console.log('🔄 Sync from psi/ - Import retrospectives from The Matrix\n');

  // Find psi directory
  const psiDir = findPsiRetrospectivesDir();
  if (!psiDir) {
    console.error('❌ Could not find psi/memory/retrospectives directory');
    console.error('   Expected: ~/workspace/The-matrix/psi/memory/retrospectives/');
    process.exit(1);
  }

  console.log(`📁 Source: ${psiDir}`);

  // Initialize vector DB for indexing
  if (!dryRun) {
    await initVectorDB();
  }

  // Find all retrospective files
  const files = findMarkdownFiles(psiDir);
  console.log(`📊 Found ${files.length} retrospective files\n`);

  if (files.length === 0) {
    console.log('No retrospectives to import.');
    return;
  }

  // Import each file
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const filepath of files) {
    const relativePath = filepath.replace(psiDir + '/', '');

    try {
      // Read and parse file
      const content = readFileSync(filepath, 'utf-8');
      const session = parseRetrospective(filepath, content);

      if (!session) {
        console.log(`  ⚠️  Skip (parse error): ${relativePath}`);
        errors++;
        continue;
      }

      // Check if already imported (unless --all)
      if (!importAll) {
        const existing = getSessionById(session.id);
        if (existing) {
          skipped++;
          if (dryRun) {
            console.log(`  ⏭️  Skip (exists): ${relativePath}`);
          }
          continue;
        }
      }

      // Extract title from full_context
      const title = (session.full_context as any)?.title || session.id;

      if (dryRun) {
        console.log(`  📝 Would import: ${relativePath}`);
        console.log(`     Title: ${title}`);
        console.log(`     ID: ${session.id}`);
        imported++;
        continue;
      }

      // Save to SQLite
      createSession(session);

      // Index in ChromaDB
      try {
        await saveSessionToVector({
          id: session.id,
          name: title,
          context: (session.full_context as any)?.content || session.summary,
          summary: session.summary,
        });
      } catch (e) {
        // Vector indexing is best-effort
        console.log(`     ⚠️  Vector indexing failed (non-critical)`);
      }

      console.log(`  ✅ Imported: ${relativePath}`);
      imported++;
    } catch (e) {
      console.log(`  ❌ Error: ${relativePath} - ${e}`);
      errors++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped:  ${skipped} (already exist)`);
  console.log(`   Errors:   ${errors}`);

  if (!dryRun && imported > 0) {
    announce(`Imported ${imported} retrospectives from psi memory.`, 'Tank');
  }
}

main().catch(console.error);
