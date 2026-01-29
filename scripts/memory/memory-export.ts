#!/usr/bin/env bun
/**
 * Memory Export CLI - Export/Import markdown files
 *
 * Usage:
 *   bun memory export-md                    # Full export to ψ/memory/
 *   bun memory export-md --type learnings   # Just learnings
 *   bun memory export-md --type resonance   # Identity files only
 *   bun memory export-md --output ./docs    # Custom output directory
 *   bun memory import-md ./path/to/file.md  # Import single file
 *   bun memory import-md ./ψ/memory/        # Import directory
 */

import { parseArgs } from 'util';
import { resolve } from 'path';
import {
  exportMemory,
  exportLearnings,
  exportSessions,
  exportDecisions,
  exportResonance,
  scanAndImport,
  importMarkdownFile,
  importLearningToDb,
} from '../../src/memory-export';

// Parse command line arguments
const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h' },
    output: { type: 'string', short: 'o' },
    type: { type: 'string', short: 't' },
    confidence: { type: 'string', short: 'c' },
    category: { type: 'string', short: 'C' },
    limit: { type: 'string', short: 'n' },
    'dry-run': { type: 'boolean' },
    json: { type: 'boolean', short: 'j' },
  },
  allowPositionals: true,
});

const action = positionals[0] || 'export';
const target = positionals[1];

function printHelp() {
  console.log(`
📁 Memory Export/Import - Queryable Markdown Files

Usage:
  bun memory export-md [options]           Export memory to markdown
  bun memory import-md <path> [options]    Import markdown files

Export Options:
  -o, --output <dir>      Output directory (default: ./ψ/memory)
  -t, --type <type>       Export type: all, learnings, sessions, decisions, resonance
  -c, --confidence <lvl>  Min confidence: low, medium, high, proven
  -C, --category <cat>    Filter by category
  -n, --limit <num>       Limit number of items
  -j, --json              Output result as JSON
  -h, --help              Show this help

Import Options:
  --dry-run               Preview without writing to database
  -j, --json              Output result as JSON
  -h, --help              Show this help

Export Types:
  all        - Full export (learnings + sessions + decisions + resonance)
  learnings  - Learning files by category
  sessions   - Session retrospectives by month
  decisions  - Architectural decisions (ADR format)
  resonance  - High-confidence identity files (philosophy, principles)

Examples:
  bun memory export-md                           # Full export
  bun memory export-md -t learnings              # Just learnings
  bun memory export-md -t resonance -c proven    # Proven resonance only
  bun memory export-md -o ./docs/brain           # Custom output
  bun memory import-md ./ψ/memory/learnings/     # Import directory
  bun memory import-md ./new-learning.md         # Import single file
`);
}

async function runExport() {
  const outputDir = resolve(values.output || './ψ/memory');
  const exportType = values.type || 'all';
  const confidence = values.confidence as 'low' | 'medium' | 'high' | 'proven' | undefined;
  const category = values.category;
  const limit = values.limit ? parseInt(values.limit, 10) : undefined;

  console.log(`\n📁 Exporting memory to: ${outputDir}\n`);

  let result;

  switch (exportType) {
    case 'all':
      result = await exportMemory({
        outputDir,
        includeTypes: ['learnings', 'sessions', 'decisions', 'resonance'],
        minConfidence: confidence,
        category,
        limit,
      });
      break;

    case 'learnings':
      const learningsResult = await exportLearnings(outputDir, { minConfidence: confidence, category, limit });
      result = { learnings: learningsResult.count, errors: learningsResult.errors };
      break;

    case 'sessions':
      const sessionsResult = await exportSessions(outputDir, { limit });
      result = { sessions: sessionsResult.count, errors: sessionsResult.errors };
      break;

    case 'decisions':
      const decisionsResult = await exportDecisions(outputDir);
      result = { decisions: decisionsResult.count, errors: decisionsResult.errors };
      break;

    case 'resonance':
      const resonanceResult = await exportResonance(outputDir);
      result = { resonance: resonanceResult.count, errors: resonanceResult.errors };
      break;

    default:
      console.error(`Unknown export type: ${exportType}`);
      printHelp();
      process.exit(1);
  }

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('✅ Export complete!');
    console.log('');
    if ('learnings' in result) console.log(`   Learnings: ${result.learnings}`);
    if ('sessions' in result) console.log(`   Sessions: ${result.sessions}`);
    if ('decisions' in result) console.log(`   Decisions: ${result.decisions}`);
    if ('resonance' in result) console.log(`   Resonance: ${result.resonance}`);
    if (result.errors && result.errors.length > 0) {
      console.log('');
      console.log(`⚠️  Errors: ${result.errors.length}`);
      for (const err of result.errors.slice(0, 5)) {
        console.log(`   ${err}`);
      }
      if (result.errors.length > 5) {
        console.log(`   ... and ${result.errors.length - 5} more`);
      }
    }
    console.log('');
    console.log(`📂 Output: ${outputDir}`);
  }
}

async function runImport() {
  if (!target) {
    console.error('Error: Please specify a file or directory to import');
    printHelp();
    process.exit(1);
  }

  const targetPath = resolve(target);
  const dryRun = values['dry-run'];

  console.log(`\n📥 Importing from: ${targetPath}`);
  if (dryRun) console.log('   (dry run - no changes will be made)');
  console.log('');

  // Check if target is file or directory
  const stat = await Bun.file(targetPath).exists()
    ? 'file'
    : await import('fs/promises').then(fs => fs.stat(targetPath)).then(s => s.isDirectory() ? 'directory' : 'unknown').catch(() => 'unknown');

  let result;

  if (stat === 'file') {
    // Import single file
    const { learning, error } = await importMarkdownFile(targetPath);
    if (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
    if (!learning) {
      console.log('Skipped: Not a learning file');
      process.exit(0);
    }

    if (dryRun) {
      console.log(`Would import: ${learning.title}`);
      console.log(`  Category: ${learning.category}`);
      console.log(`  Confidence: ${learning.confidence}`);
      result = { imported: 1, updated: 0, skipped: 0, errors: [] };
    } else {
      const { action, id, error: dbError } = await importLearningToDb(learning);
      if (dbError) {
        console.error(`Error: ${dbError}`);
        process.exit(1);
      }
      result = {
        imported: action === 'created' ? 1 : 0,
        updated: action === 'updated' ? 1 : 0,
        skipped: 0,
        errors: [],
      };
      console.log(`✅ ${action === 'created' ? 'Created' : 'Updated'} learning #${id}: ${learning.title}`);
    }
  } else if (stat === 'directory') {
    // Import directory
    result = await scanAndImport(targetPath, { dryRun });
  } else {
    console.error(`Error: ${targetPath} is not a file or directory`);
    process.exit(1);
  }

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('');
    console.log('✅ Import complete!');
    console.log(`   Imported: ${result.imported}`);
    console.log(`   Updated: ${result.updated}`);
    console.log(`   Skipped: ${result.skipped}`);
    if (result.errors.length > 0) {
      console.log('');
      console.log(`⚠️  Errors: ${result.errors.length}`);
      for (const err of result.errors.slice(0, 5)) {
        console.log(`   ${err}`);
      }
    }
  }
}

async function main() {
  if (values.help) {
    printHelp();
    process.exit(0);
  }

  // Determine action from command
  const command = process.argv[2] || '';
  if (command.includes('import') || action === 'import') {
    await runImport();
  } else {
    await runExport();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
