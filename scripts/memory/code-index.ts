#!/usr/bin/env bun
/**
 * Code Indexer CLI
 *
 * Usage:
 *   bun memory index once       - Full index of codebase
 *   bun memory index start      - Start file watcher daemon
 *   bun memory index stop       - Stop file watcher daemon
 *   bun memory index status     - Show index statistics
 *   bun memory index search "q" - Search indexed code
 */

import { CodeIndexer, getDefaultIndexer } from '../../src/indexer/code-indexer';

const args = process.argv.slice(2);
const subcommand = args[0];
const query = args[1];

async function main() {
  const indexer = getDefaultIndexer(process.cwd());

  switch (subcommand) {
    case 'once':
    case 'full': {
      console.log('Starting full codebase indexing...\n');
      const startTime = Date.now();

      const stats = await indexer.indexAll({
        onProgress: (current, total) => {
          const percent = Math.round((current / total) * 100);
          process.stdout.write(`\rProgress: ${current}/${total} (${percent}%)`);
        },
        force: args.includes('--force'),
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('\n');
      console.log('Indexing complete!');
      console.log(`  Files indexed: ${stats.indexedFiles}`);
      console.log(`  Files skipped: ${stats.skippedFiles}`);
      console.log(`  Errors: ${stats.errors}`);
      console.log(`  Duration: ${duration}s`);
      break;
    }

    case 'start':
    case 'watch': {
      console.log('Starting file watcher...');
      console.log('Press Ctrl+C to stop\n');

      await indexer.startWatcher();

      // Keep process running
      process.on('SIGINT', async () => {
        console.log('\nStopping watcher...');
        await indexer.stopWatcher();
        process.exit(0);
      });

      // Initial index if requested
      if (args.includes('--initial')) {
        console.log('Running initial index...');
        await indexer.indexAll({
          onProgress: (current, total) => {
            process.stdout.write(`\rIndexing: ${current}/${total}`);
          },
        });
        console.log('\nInitial index complete. Now watching for changes...\n');
      } else {
        console.log('Watching for file changes...');
        console.log('Tip: Run with --initial to index existing files first\n');
      }

      // Keep alive
      await new Promise(() => {});
      break;
    }

    case 'status':
    case 'stats': {
      await indexer.init();
      const stats = indexer.getStats();
      const vectorStats = await indexer.getVectorStats();

      console.log('Code Index Status\n');
      console.log('Index Statistics:');
      console.log(`  Total documents: ${vectorStats.totalDocuments}`);
      console.log(`  Indexed files: ${stats.indexedFiles}`);
      console.log(`  Skipped files: ${stats.skippedFiles}`);
      console.log(`  Errors: ${stats.errors}`);
      console.log(`  Watcher active: ${stats.watcherActive ? 'Yes' : 'No'}`);

      if (stats.lastIndexedAt) {
        console.log(`  Last indexed: ${stats.lastIndexedAt.toISOString()}`);
      }

      console.log('\nLanguage Distribution:');
      const sortedLangs = Object.entries(vectorStats.languages)
        .sort(([, a], [, b]) => b - a);

      for (const [lang, count] of sortedLangs) {
        console.log(`  ${lang}: ${count}`);
      }
      break;
    }

    case 'search': {
      if (!query) {
        console.error('Usage: bun memory index search "query"');
        process.exit(1);
      }

      console.log(`Searching for: "${query}"\n`);

      const langFilter = args.includes('--lang')
        ? args[args.indexOf('--lang') + 1]
        : undefined;

      const limit = args.includes('--limit')
        ? parseInt(args[args.indexOf('--limit') + 1] || '10')
        : 10;

      const results = await indexer.search(query, {
        language: langFilter,
        limit,
      });

      if (results.length === 0) {
        console.log('No results found.');
        console.log('Tip: Run "bun memory index once" to index your codebase first.');
        break;
      }

      console.log(`Found ${results.length} results:\n`);

      for (const result of results) {
        const relevance = (result.relevance * 100).toFixed(0);
        console.log(`[${relevance}%] ${result.file_path} (${result.language})`);

        // Show snippet (first 200 chars)
        const snippet = result.content.slice(0, 200).replace(/\n/g, ' ');
        console.log(`     ${snippet}...`);
        console.log('');
      }
      break;
    }

    case 'clear': {
      console.log('Clearing code index...');
      // Note: This would need a clearCodeIndex function in vector-db.ts
      // For now, just show a message
      console.log('Use "bun memory reindex codebase" to rebuild the index.');
      break;
    }

    default:
      printHelp();
      break;
  }
}

function printHelp() {
  console.log(`
Code Indexer - Semantic code search

Usage: bun memory index <command> [options]

Commands:
  once              Full index of codebase (one-time)
  start             Start file watcher for automatic indexing
  status            Show index statistics
  search "query"    Search indexed code semantically

Options:
  --force           Re-index all files (with 'once')
  --initial         Index existing files before watching (with 'start')
  --lang <lang>     Filter by language (with 'search')
  --limit <n>       Limit results (with 'search', default: 10)

Examples:
  bun memory index once                      # Index entire codebase
  bun memory index once --force              # Re-index all files
  bun memory index start                     # Watch for changes
  bun memory index start --initial           # Index then watch
  bun memory index status                    # Show statistics
  bun memory index search "authentication"   # Search for auth code
  bun memory index search "api" --lang ts    # Search TypeScript only

Supported Languages:
  TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Swift,
  Ruby, PHP, C/C++, C#, Bash, SQL, Markdown, JSON, YAML, TOML
`);
}

main().catch(console.error);
