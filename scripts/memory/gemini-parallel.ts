#!/usr/bin/env bun
/**
 * gemini-parallel - Execute parallel Gemini queries via MQTT browser automation
 *
 * Usage:
 *   bun run gemini:parallel "query1" "query2" "query3" "query4"
 *   bun run gemini:parallel --model=pro "complex query 1" "complex query 2"
 *   bun run gemini:parallel --save "topic to research"
 *
 * Options:
 *   --model=fast|thinking|pro  Select Gemini model (default: fast)
 *   --timeout=30000            Response wait timeout in ms (default: 30000)
 *   --save                     Save responses as learnings
 *   --json                     Output as JSON
 *   --quiet                    Minimal output
 *
 * Prerequisites:
 *   1. Mosquitto MQTT broker running (port 1883)
 *   2. claude-browser-proxy extension loaded in browser
 *   3. Browser signed into Gemini
 *
 * @see src/services/mqtt-client.ts
 */

import { GeminiBrowserClient, parallelGeminiQueries } from '../../src/services/mqtt-client';
import { createLearning } from '../../src/db/learnings';
import { saveLearning as saveLearningToChroma, initVectorDB } from '../../src/vector-db';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface Options {
  model?: 'fast' | 'thinking' | 'pro';
  timeout: number;
  save: boolean;
  json: boolean;
  quiet: boolean;
  queries: string[];
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    timeout: 30000,
    save: false,
    json: false,
    quiet: false,
    queries: [],
  };

  for (const arg of args) {
    if (arg.startsWith('--model=')) {
      const model = arg.split('=')[1] as 'fast' | 'thinking' | 'pro';
      if (!['fast', 'thinking', 'pro'].includes(model)) {
        console.error(`Invalid model: ${model}. Must be fast, thinking, or pro.`);
        process.exit(1);
      }
      options.model = model;
    } else if (arg.startsWith('--timeout=')) {
      options.timeout = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--save') {
      options.save = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('--')) {
      options.queries.push(arg);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
🔮 gemini-parallel - Parallel Gemini Research via MQTT

USAGE:
  bun run gemini:parallel [options] "query1" "query2" ...

OPTIONS:
  --model=<fast|thinking|pro>  Select Gemini model (default: auto)
  --timeout=<ms>               Response wait timeout (default: 30000)
  --save                       Save responses as learnings to database
  --json                       Output results as JSON
  --quiet, -q                  Minimal output
  --help, -h                   Show this help

EXAMPLES:
  # Compare frameworks
  bun run gemini:parallel "What is React?" "What is Vue?" "What is Svelte?"

  # Research with Pro model and save results
  bun run gemini:parallel --model=pro --save "Explain quantum computing" "Explain string theory"

  # Quick research with JSON output
  bun run gemini:parallel --json "Latest TypeScript features"

PREREQUISITES:
  1. Mosquitto MQTT broker running: brew services start mosquitto
  2. claude-browser-proxy extension loaded in browser
  3. Signed into Gemini in browser

MQTT TOPICS:
  Command:  claude/browser/command
  Response: claude/browser/response
`);
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const options = parseArgs();

  if (options.queries.length === 0) {
    console.error('Error: No queries provided.\n');
    printHelp();
    process.exit(1);
  }

  if (options.queries.length > 4) {
    console.error('Error: Maximum 4 queries per batch (browser performance limit).');
    process.exit(1);
  }

  const log = options.quiet
    ? () => {}
    : (msg: string) => console.log(msg);

  log(`\n🔮 Gemini Parallel Research`);
  log(`   Queries: ${options.queries.length}`);
  log(`   Model: ${options.model || 'default'}`);
  log(`   Timeout: ${options.timeout}ms`);
  log('');

  // Create MQTT client
  const client = new GeminiBrowserClient();

  try {
    // Connect to MQTT
    log('📡 Connecting to MQTT broker...');
    await client.connect();
    log('✅ Connected\n');

    // Execute parallel queries
    log('🚀 Launching parallel queries...\n');

    const startTime = Date.now();
    const results = await parallelGeminiQueries(client, options.queries, {
      model: options.model,
      timeout: options.timeout,
      onTabCreated: (tabId, query) => {
        log(`   📑 Tab ${tabId}: "${query.substring(0, 40)}..."`);
      },
      onQuerySent: (tabId) => {
        log(`   ➡️  Tab ${tabId}: Query sent`);
      },
      onResponseReceived: (tabId, query, response) => {
        log(`   ✅ Tab ${tabId}: Response received (${response.length} chars)`);
      },
    });
    const elapsed = Date.now() - startTime;

    log(`\n⏱️  Total time: ${(elapsed / 1000).toFixed(1)}s\n`);

    // Output results
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      log('━'.repeat(60));
      for (const result of results) {
        log(`\n📌 Query: ${result.query}`);
        log(`   Tab: ${result.tabId}`);
        log('─'.repeat(60));
        // Truncate long responses for display
        const preview = result.response.length > 500
          ? result.response.substring(0, 500) + '...\n[truncated]'
          : result.response;
        console.log(preview);
        log('');
      }
    }

    // Save as learnings if requested
    if (options.save) {
      log('\n💾 Saving responses as learnings...');

      // Initialize vector DB
      await initVectorDB();

      for (const result of results) {
        const title = `Gemini: ${result.query.substring(0, 50)}${result.query.length > 50 ? '...' : ''}`;

        // Save to SQLite
        const learningId = createLearning({
          category: 'research',
          title,
          description: result.response,
          context: `Query: ${result.query}\n\nSource: Gemini (${options.model || 'default'} model)\nTab ID: ${result.tabId}`,
          confidence: 'low',
          maturity_stage: 'observation',
        });

        // Save to ChromaDB for vector search
        await saveLearningToChroma({
          id: learningId,
          category: 'research',
          title,
          description: result.response,
        });

        log(`   ✅ Saved: ${title} (ID: ${learningId})`);
      }
    }

    log('\n✨ Done!\n');

  } catch (error) {
    console.error('\n❌ Error:', (error as Error).message);

    if ((error as Error).message.includes('Connection timeout')) {
      console.error('\nTroubleshooting:');
      console.error('  1. Check Mosquitto is running: brew services list');
      console.error('  2. Check extension is loaded: brave://extensions/');
      console.error('  3. Extension badge should be green');
    }

    process.exit(1);
  } finally {
    client.disconnect();
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
