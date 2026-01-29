#!/usr/bin/env bun
/**
 * Web Search CLI - Search the web using Brave Search API
 *
 * Usage:
 *   bun memory web "query"              # Basic web search
 *   bun memory web "query" --recent     # Recent results (past week)
 *   bun memory web "query" --tech       # Tech/programming focused
 *   bun memory web "query" --capture    # Save results as a learning
 *   bun memory web "query" -n 5         # Limit to 5 results
 */

import { parseArgs } from 'util';
import {
  isBraveSearchAvailable,
  search,
  searchRecent,
  searchTech,
  searchAndCapture,
  type SearchResult,
} from '../../src/services/brave-search';

// Parse command line arguments
const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h' },
    count: { type: 'string', short: 'n' },
    recent: { type: 'boolean', short: 'r' },
    tech: { type: 'boolean', short: 't' },
    news: { type: 'boolean' },
    capture: { type: 'boolean', short: 'c' },
    category: { type: 'string', short: 'C' },
    json: { type: 'boolean', short: 'j' },
    freshness: { type: 'string', short: 'f' },
  },
  allowPositionals: true,
});

const query = positionals.join(' ');

function printHelp() {
  console.log(`
🔍 Web Search - Brave Search API Integration

Usage:
  bun memory web <query> [options]

Options:
  -n, --count <num>     Number of results (1-20, default: 10)
  -r, --recent          Recent results only (past week)
  -t, --tech            Tech/programming focused search
  --news                Include news results
  -c, --capture         Save results as a learning
  -C, --category <cat>  Category for captured learning (default: insight)
  -f, --freshness <f>   Freshness: pd (day), pw (week), pm (month), py (year)
  -j, --json            Output as JSON
  -h, --help            Show this help

Examples:
  bun memory web "TypeScript best practices"
  bun memory web "SQLite FTS5 tutorial" --tech
  bun memory web "AI news" --recent --news
  bun memory web "ChromaDB embedding" --capture -C architecture

Requires BRAVE_API_KEY in .env.local
`);
}

function formatResult(result: SearchResult, index: number): string {
  const lines: string[] = [];
  const typeIcon = result.type === 'news' ? '📰' : result.type === 'video' ? '🎬' : '🌐';

  lines.push(`${typeIcon} \x1b[1m${index + 1}. ${result.title}\x1b[0m`);
  lines.push(`   \x1b[36m${result.url}\x1b[0m`);
  if (result.description) {
    // Wrap description
    const desc = result.description.slice(0, 200) + (result.description.length > 200 ? '...' : '');
    lines.push(`   ${desc}`);
  }
  if (result.age || result.source) {
    const meta: string[] = [];
    if (result.age) meta.push(result.age);
    if (result.source) meta.push(`via ${result.source}`);
    lines.push(`   \x1b[2m${meta.join(' • ')}\x1b[0m`);
  }

  return lines.join('\n');
}

async function main() {
  if (values.help || !query) {
    printHelp();
    process.exit(values.help ? 0 : 1);
  }

  // Check if API key is available
  if (!isBraveSearchAvailable()) {
    console.error('\n❌ BRAVE_API_KEY not found in environment.');
    console.error('   Add it to .env.local to enable web search.\n');
    process.exit(1);
  }

  const count = values.count ? parseInt(values.count, 10) : 10;

  console.log(`\n🔍 Searching: "${query}"\n`);

  try {
    let results: SearchResult[];
    let learningId: number | undefined;

    if (values.capture) {
      // Search and capture as learning
      const response = await searchAndCapture(query, {
        count,
        captureAsLearning: true,
        learningCategory: values.category || 'insight',
        includeNews: values.news,
      });
      results = response.results;
      learningId = response.learningId;
    } else if (values.recent) {
      // Recent results
      results = await searchRecent(query, 'week', count);
    } else if (values.tech) {
      // Tech-focused search
      results = await searchTech(query, count);
    } else {
      // Standard search
      results = await search(query, {
        count,
        freshness: values.freshness,
        includeNews: values.news,
      });
    }

    if (values.json) {
      console.log(JSON.stringify({ query, results, learningId }, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No results found.\n');
      return;
    }

    // Print results
    for (let i = 0; i < results.length; i++) {
      console.log(formatResult(results[i]!, i));
      console.log('');
    }

    console.log(`\x1b[2m━━━ ${results.length} results ━━━\x1b[0m`);

    if (learningId) {
      console.log(`\n✅ Captured as Learning #${learningId}`);
    }

    console.log('');
  } catch (error) {
    console.error(`\n❌ Search failed: ${error}\n`);
    process.exit(1);
  }
}

main().catch(console.error);
