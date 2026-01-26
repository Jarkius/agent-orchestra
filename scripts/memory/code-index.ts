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
import { getCodeFileStats, findIndexedFiles, findFilesBySymbol, findSymbolByName, getSymbolStats, getFilesByPattern, getPatternStats, getAllCodeFiles } from '../../src/db';
import { hybridSearch, fastSearch, getIndexHealth } from '../../src/indexer/hybrid-search';
import { initVectorDB } from '../../src/vector-db';
import { analyzeAndPersistPatterns } from '../../src/learning/code-analyzer';

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

    case 'files': {
      // List all indexed files with optional language filter
      const langFilter = args.includes('--lang')
        ? args[args.indexOf('--lang') + 1]
        : undefined;

      const stats = getCodeFileStats();
      console.log(`\nIndexed Files: ${stats.totalFiles}\n`);

      if (langFilter) {
        console.log(`Filtering by language: ${langFilter}\n`);
      }

      console.log('Language Distribution:');
      const sortedLangs = Object.entries(stats.byLanguage)
        .sort(([, a], [, b]) => b - a);

      for (const [lang, count] of sortedLangs) {
        if (!langFilter || lang === langFilter) {
          console.log(`  ${lang}: ${count} files`);
        }
      }

      if (stats.externalFiles > 0) {
        console.log(`\nExternal files (symlinked): ${stats.externalFiles}`);
      }

      if (stats.lastIndexed) {
        console.log(`\nLast indexed: ${stats.lastIndexed}`);
      }
      break;
    }

    case 'find': {
      // Fast SQLite-based file search (no embedding model needed)
      if (!query) {
        console.error('Usage: bun memory index find "pattern"');
        process.exit(1);
      }

      const startTime = Date.now();
      const langFilter = args.includes('--lang')
        ? args[args.indexOf('--lang') + 1]
        : undefined;

      const limit = args.includes('--limit')
        ? parseInt(args[args.indexOf('--limit') + 1] || '20')
        : 20;

      // Search by file path/name
      const fileResults = findIndexedFiles(query, {
        language: langFilter,
        limit,
      });

      // Also search by symbol name
      const symbolResults = findFilesBySymbol(query, { limit: 10 });

      const queryTime = Date.now() - startTime;
      console.log(`\nFast search for: "${query}" (${queryTime}ms)\n`);

      if (fileResults.length === 0 && symbolResults.length === 0) {
        console.log('No files found matching that pattern.');
        console.log('Tip: Run "bun memory index once" to index your codebase first.');
        break;
      }

      if (fileResults.length > 0) {
        console.log('Files matching path/name:');
        for (const file of fileResults) {
          console.log(`  ${file.file_path} (${file.language || 'unknown'}, ${file.line_count} lines)`);
        }
      }

      if (symbolResults.length > 0) {
        console.log('\nFiles containing symbol:');
        for (const file of symbolResults) {
          const funcs = file.functions ? JSON.parse(file.functions).slice(0, 5) : [];
          const classes = file.classes ? JSON.parse(file.classes).slice(0, 3) : [];
          const symbols = [...funcs, ...classes].join(', ');
          console.log(`  ${file.file_path}`);
          if (symbols) {
            console.log(`    Symbols: ${symbols}`);
          }
        }
      }
      break;
    }

    case 'health': {
      // Check sync between SQLite and ChromaDB
      console.log('\nIndex Health Check\n');

      try {
        await initVectorDB();
        const health = await getIndexHealth();

        console.log('SQLite Index:');
        console.log(`  Total files: ${health.sqlite.totalFiles}`);
        console.log(`  External files: ${health.sqlite.externalFiles}`);
        console.log(`  Last indexed: ${health.sqlite.lastIndexed || 'never'}`);

        console.log('\nChromaDB Index:');
        console.log(`  Total documents: ${health.chromadb.totalDocuments}`);

        console.log('\nSync Status:');
        if (health.inSync) {
          console.log('  ✅ Indexes appear in sync');
        } else {
          console.log(`  ⚠️  Drift detected: ~${health.drift} files`);
          console.log('  Tip: Run "bun memory index once --force" to resync');
        }
      } catch (error) {
        console.error('Error checking health:', error);
        console.log('Tip: Ensure ChromaDB is running and indexed');
      }
      break;
    }

    case 'hybrid': {
      // Hybrid search - auto-routes to best method
      if (!query) {
        console.error('Usage: bun memory index hybrid "query"');
        process.exit(1);
      }

      await initVectorDB();
      console.log(`Hybrid search for: "${query}"\n`);

      const langFilter = args.includes('--lang')
        ? args[args.indexOf('--lang') + 1]
        : undefined;

      const limit = args.includes('--limit')
        ? parseInt(args[args.indexOf('--limit') + 1] || '10')
        : 10;

      const result = await hybridSearch(query, {
        language: langFilter,
        limit,
      });

      console.log(`Search method: ${result.source} (${result.query_time_ms}ms)`);
      console.log(`Found ${result.total_results} results:\n`);

      for (const item of result.results) {
        const relevance = item.relevance ? `[${item.relevance}%]` : '';
        console.log(`${relevance} ${item.file_path} (${item.language || 'unknown'})`);

        if (item.functions?.length) {
          console.log(`    Functions: ${item.functions.slice(0, 5).join(', ')}`);
        }
        if (item.snippets && item.snippets.length > 0 && item.snippets[0]) {
          const snippet = item.snippets[0].content.slice(0, 150).replace(/\n/g, ' ');
          console.log(`    ${snippet}...`);
        }
        console.log('');
      }
      break;
    }

    case 'grep':
    case 'smart-grep': {
      // Smart grep: SQLite narrows files, then grep searches content
      if (!query) {
        console.error('Usage: bun memory index grep "pattern" [--in "file-filter"]');
        process.exit(1);
      }

      const startTime = Date.now();

      // Optional file filter (--in "matrix" to search only matrix-related files)
      const fileFilter = args.includes('--in')
        ? args[args.indexOf('--in') + 1]
        : undefined;

      const langFilter = args.includes('--lang')
        ? args[args.indexOf('--lang') + 1]
        : undefined;

      // Step 1: Get candidate files from SQLite
      let files: string[];
      if (fileFilter) {
        const matches = findIndexedFiles(fileFilter, { language: langFilter, limit: 100 });
        files = matches.map(f => f.file_path);
      } else if (langFilter) {
        // Get all files of this language
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const result = await execAsync(
          `sqlite3 agents.db "SELECT file_path FROM code_files WHERE language = '${langFilter}'"`
        );
        files = result.stdout.trim().split('\n').filter(Boolean);
      } else {
        // Get all indexed files
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const result = await execAsync(
          `sqlite3 agents.db "SELECT file_path FROM code_files"`
        );
        files = result.stdout.trim().split('\n').filter(Boolean);
      }

      const sqliteTime = Date.now() - startTime;

      if (files.length === 0) {
        console.log('No indexed files match the filter.');
        console.log('Tip: Run "bun memory index once" to index your codebase first.');
        break;
      }

      // Step 2: Run grep on just those files
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const grepStart = Date.now();
      const escapedQuery = query.replace(/"/g, '\\"');

      try {
        // Run grep on the specific files
        const fileList = files.join(' ');
        const { stdout } = await execAsync(
          `grep -Hn "${escapedQuery}" ${fileList} 2>/dev/null || true`,
          { maxBuffer: 10 * 1024 * 1024 }
        );

        const grepTime = Date.now() - grepStart;
        const totalTime = Date.now() - startTime;

        const lines = stdout.trim().split('\n').filter(Boolean);

        console.log(`\n🔍 Smart grep for: "${query}"\n`);
        console.log(`⚡ SQLite: ${sqliteTime}ms (${files.length} files) → grep: ${grepTime}ms`);
        console.log(`📊 Total: ${totalTime}ms | Found: ${lines.length} matches\n`);

        if (lines.length === 0) {
          console.log('No matches found in indexed files.');
        } else {
          // Group by file
          const byFile: Record<string, string[]> = {};
          for (const line of lines) {
            const colonIdx = line.indexOf(':');
            const secondColon = line.indexOf(':', colonIdx + 1);
            if (colonIdx > 0 && secondColon > colonIdx) {
              const file = line.substring(0, colonIdx);
              const lineNum = line.substring(colonIdx + 1, secondColon);
              const content = line.substring(secondColon + 1).trim();
              if (!byFile[file]) byFile[file] = [];
              byFile[file].push(`  ${lineNum}: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`);
            }
          }

          for (const [file, matches] of Object.entries(byFile)) {
            console.log(`📄 ${file} (${matches.length} matches)`);
            for (const match of matches.slice(0, 5)) {
              console.log(match);
            }
            if (matches.length > 5) {
              console.log(`  ... and ${matches.length - 5} more`);
            }
            console.log('');
          }
        }
      } catch (error) {
        console.error('Grep failed:', error);
      }
      break;
    }

    case 'pattern': {
      // Fast pattern lookup
      if (!query) {
        // Show pattern stats if no query
        const stats = getPatternStats();
        console.log('\nPattern Index Statistics\n');
        console.log(`Total patterns: ${stats.totalPatterns}`);
        console.log(`Average confidence: ${(stats.avgConfidence * 100).toFixed(0)}%`);
        console.log('\nBy pattern name:');
        for (const [name, count] of Object.entries(stats.byName)) {
          console.log(`  ${name}: ${count}`);
        }
        console.log('\nUsage: bun memory index pattern "name"');
        break;
      }

      const startTime = Date.now();

      const limit = args.includes('--limit')
        ? parseInt(args[args.indexOf('--limit') + 1] || '20')
        : 20;

      const minConfidence = args.includes('--min-confidence')
        ? parseFloat(args[args.indexOf('--min-confidence') + 1] || '0.5')
        : 0.5;

      const results = getFilesByPattern(query, { limit, minConfidence });

      const queryTime = Date.now() - startTime;
      console.log(`\n🔍 Pattern lookup for: "${query}" (${queryTime}ms)\n`);

      if (results.length === 0) {
        console.log('No files found with that pattern.');
        console.log('Tip: Run "bun memory learn ./path" to analyze code for patterns.');
        break;
      }

      console.log(`Found ${results.length} occurrences:\n`);

      // Group by file
      const byFile: Record<string, typeof results> = {};
      for (const pattern of results) {
        if (!byFile[pattern.file_path]) byFile[pattern.file_path] = [];
        byFile[pattern.file_path].push(pattern);
      }

      for (const [filePath, patterns] of Object.entries(byFile)) {
        console.log(`📄 ${filePath}`);
        for (const p of patterns) {
          const conf = `${(p.confidence * 100).toFixed(0)}%`;
          const line = p.line_number ? `:${p.line_number}` : '';
          console.log(`   🔷 ${p.pattern_name} (${conf})${line}`);
          if (p.description) {
            console.log(`      ${p.description}`);
          }
          if (p.evidence) {
            console.log(`      Evidence: ${p.evidence}`);
          }
        }
        console.log('');
      }
      break;
    }

    case 'symbol': {
      // Fast symbol lookup with line numbers
      if (!query) {
        // Show symbol stats if no query
        const stats = getSymbolStats();
        console.log('\nSymbol Index Statistics\n');
        console.log(`Total symbols: ${stats.totalSymbols}`);
        console.log(`Files with symbols: ${stats.filesWithSymbols}`);
        console.log('\nBy type:');
        for (const [type, count] of Object.entries(stats.byType)) {
          console.log(`  ${type}: ${count}`);
        }
        console.log('\nUsage: bun memory index symbol "name"');
        break;
      }

      const startTime = Date.now();

      const typeFilter = args.includes('--type')
        ? args[args.indexOf('--type') + 1] as 'function' | 'class' | 'export' | 'import'
        : undefined;

      const limit = args.includes('--limit')
        ? parseInt(args[args.indexOf('--limit') + 1] || '20')
        : 20;

      const results = findSymbolByName(query, {
        type: typeFilter,
        exactMatch: args.includes('--exact'),
        limit,
      });

      const queryTime = Date.now() - startTime;
      console.log(`\n🔍 Symbol lookup for: "${query}" (${queryTime}ms)\n`);

      if (results.length === 0) {
        console.log('No symbols found matching that name.');
        console.log('Tip: Run "bun memory index once --force" to re-index with symbol extraction.');
        break;
      }

      console.log(`Found ${results.length} symbols:\n`);

      // Group by file
      const byFile: Record<string, typeof results> = {};
      for (const symbol of results) {
        if (!byFile[symbol.file_path]) byFile[symbol.file_path] = [];
        byFile[symbol.file_path].push(symbol);
      }

      for (const [filePath, symbols] of Object.entries(byFile)) {
        console.log(`📄 ${filePath}`);
        for (const sym of symbols) {
          const typeIcon = sym.type === 'function' ? 'ƒ' : sym.type === 'class' ? '◇' : sym.type === 'export' ? '→' : '←';
          const line = sym.line_start ? `:${sym.line_start}` : '';
          console.log(`   ${typeIcon} ${sym.name} (${sym.type})${line}`);
          if (sym.signature) {
            console.log(`     ${sym.signature.slice(0, 80)}${sym.signature.length > 80 ? '...' : ''}`);
          }
        }
        console.log('');
      }
      break;
    }

    case 'analyze':
    case 'patterns': {
      // Run pattern analysis on all indexed files
      console.log('\nRunning pattern analysis on all indexed files...\n');

      const langFilter = args.includes('--lang')
        ? args[args.indexOf('--lang') + 1]
        : undefined;

      const files = getAllCodeFiles({
        language: langFilter,
        includeContent: true,
      });

      console.log(`Found ${files.length} files to analyze${langFilter ? ` (${langFilter})` : ''}...\n`);

      let totalPatterns = 0;
      let filesWithPatterns = 0;

      for (const file of files) {
        if (!file.content) {
          // Skip files without content (need re-index)
          continue;
        }

        const { detected, persisted } = analyzeAndPersistPatterns(file.content, file.file_path);
        if (persisted > 0) {
          filesWithPatterns++;
          totalPatterns += persisted;
          console.log(`  ${file.file_path}: ${persisted} patterns`);
        }
      }

      console.log('\n✅ Pattern analysis complete');
      console.log(`   Files with patterns: ${filesWithPatterns}`);
      console.log(`   Total patterns persisted: ${totalPatterns}`);

      // Show summary stats
      const stats = getPatternStats();
      if (stats.totalPatterns > 0) {
        console.log('\nPattern distribution:');
        for (const [name, count] of Object.entries(stats.byName)) {
          console.log(`   ${name}: ${count}`);
        }
      }
      break;
    }

    default:
      printHelp();
      break;
  }
}

function printHelp() {
  console.log(`
Code Indexer - Hybrid code search (SQLite + Semantic)

Usage: bun memory index <command> [options]

Commands:
  once              Full index of codebase (one-time)
  start             Start file watcher for automatic indexing
  status            Show index statistics
  search "query"    Search indexed code semantically
  find "pattern"    Fast file/symbol lookup (SQLite, no model needed)
  symbol "name"     Fast symbol lookup with line numbers
  pattern "name"    Find files with detected design patterns
  analyze           Run pattern analysis on all indexed files
  grep "pattern"    Smart grep - SQLite narrows files, then grep searches
  files             List all indexed files by language
  health            Check sync between SQLite and ChromaDB
  hybrid "query"    Smart search - auto-routes to best method

Options:
  --force           Re-index all files (with 'once')
  --initial         Index existing files before watching (with 'start')
  --lang <lang>     Filter by language
  --in <filter>     Filter files by name/path (with 'grep')
  --limit <n>       Limit results (default: 10-20)

Examples:
  bun memory index once                      # Index entire codebase
  bun memory index once --force              # Re-index all files
  bun memory index start --initial           # Index then watch
  bun memory index status                    # Show statistics

  # Semantic search (conceptual queries)
  bun memory index search "authentication"   # How does auth work?
  bun memory index search "error handling"   # Find error patterns

  # Fast lookup (exact matches, no model load)
  bun memory index find "daemon"             # Find files named daemon
  bun memory index find "connectToHub"       # Find function by name
  bun memory index files --lang typescript   # List all TS files

  # Hybrid (auto-picks best method)
  bun memory index hybrid "WebSocket"        # Exact match → SQLite
  bun memory index hybrid "how to retry"     # Conceptual → Semantic

  # Smart grep (SQLite + grep = fast exact search)
  bun memory index grep "connectToHub"       # Search all indexed files
  bun memory index grep "TODO" --in matrix   # Search only matrix-related files
  bun memory index grep "import" --lang ts   # Search only TypeScript files

Supported Languages:
  TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Swift,
  Ruby, PHP, C/C++, C#, Bash, SQL, Markdown, JSON, YAML, TOML
`);
}

main().catch(console.error);
