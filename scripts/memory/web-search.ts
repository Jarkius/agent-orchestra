#!/usr/bin/env bun
/**
 * Web Search CLI - Search the web using Brave Search API
 *
 * Usage:
 *   bun memory web "query"              # Basic web search
 *   bun memory web "query" --recent     # Recent results (past week)
 *   bun memory web "query" --tech       # Tech/programming focused
 *   bun memory web "query" --capture    # Save results as a learning
 *   bun memory web "query" --deep       # Fetch & extract content with LLM
 *   bun memory web "query" -n 5         # Limit to 5 results
 */

import { parseArgs } from 'util';
import {
  isBraveSearchAvailable,
  isDeepSearchAvailable,
  search,
  searchRecent,
  searchTech,
  searchAndCapture,
  deepSearch,
  type SearchResult,
  type DeepSearchResult,
} from '../../src/services/brave-search';
import { ExternalLLM, type LLMProvider } from '../../src/services/external-llm';
import {
  fetchAndExtract,
  isExtractionAvailable,
  getBestProvider,
  type ExtractedInsight,
} from '../../src/services/content-fetcher';
import { createLearning } from '../../src/db';

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
    deep: { type: 'boolean', short: 'd' },
    extract: { type: 'string', short: 'e' },  // How many URLs to extract
    provider: { type: 'string', short: 'p' }, // LLM provider
  },
  allowPositionals: true,
});

const query = positionals.join(' ');

// Check if query looks like a URL
function isUrl(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://') || str.startsWith('www.');
}

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

Deep Extraction (requires LLM API key):
  -d, --deep            Fetch URL content and extract insights with LLM
  -e, --extract <num>   Number of URLs to extract (default: 3)
  -p, --provider <llm>  LLM provider: gemini, openai, anthropic

Examples:
  bun memory web "TypeScript best practices"
  bun memory web "SQLite FTS5 tutorial" --tech
  bun memory web "AI news" --recent --news
  bun memory web "ChromaDB embedding" --capture -C architecture
  bun memory web "React server components" --deep --capture

Direct URL extraction (no Brave API needed):
  bun memory web https://github.com/user/repo
  bun memory web https://example.com/article --capture

Requires BRAVE_API_KEY in .env.local for web search
Direct URL and deep extraction require GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY
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

function formatDeepResult(result: DeepSearchResult, index: number): string {
  const lines: string[] = [];
  const typeIcon = result.type === 'news' ? '📰' : result.type === 'video' ? '🎬' : '🌐';

  lines.push(`${typeIcon} \x1b[1m${index + 1}. ${result.title}\x1b[0m`);
  lines.push(`   \x1b[36m${result.url}\x1b[0m`);

  if (result.insight) {
    // Show extracted summary
    lines.push(`   \x1b[32m✓ Extracted:\x1b[0m`);
    lines.push(`   ${result.insight.summary}`);
    if (result.insight.keyPoints.length > 0) {
      lines.push(`   \x1b[33mKey Points:\x1b[0m`);
      for (const point of result.insight.keyPoints.slice(0, 4)) {
        lines.push(`     • ${point}`);
      }
      if (result.insight.keyPoints.length > 4) {
        lines.push(`     \x1b[2m... and ${result.insight.keyPoints.length - 4} more\x1b[0m`);
      }
    }
    lines.push(`   \x1b[2m[${result.insight.contentType} via ${result.insight.provider}]\x1b[0m`);
  } else if (result.extractionError) {
    lines.push(`   \x1b[31m✗ Extraction failed: ${result.extractionError}\x1b[0m`);
    if (result.description) {
      const desc = result.description.slice(0, 150) + (result.description.length > 150 ? '...' : '');
      lines.push(`   ${desc}`);
    }
  } else if (result.description) {
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

function formatInsight(insight: ExtractedInsight): string {
  const lines: string[] = [];

  lines.push(`\x1b[1m${insight.title}\x1b[0m`);
  lines.push(`\x1b[36m${insight.url}\x1b[0m`);
  lines.push('');
  lines.push(`\x1b[33mSummary:\x1b[0m`);
  lines.push(insight.summary);

  if (insight.keyPoints.length > 0) {
    lines.push('');
    lines.push(`\x1b[33mKey Points:\x1b[0m`);
    for (const point of insight.keyPoints) {
      lines.push(`  • ${point}`);
    }
  }

  lines.push('');
  lines.push(`\x1b[2m[${insight.contentType} via ${insight.provider}/${insight.model}]\x1b[0m`);

  return lines.join('\n');
}

async function handleDirectUrl(url: string) {
  const provider = values.provider as LLMProvider | undefined;

  // Check LLM availability
  if (!isExtractionAvailable()) {
    console.error('\n❌ No LLM API key found for content extraction.');
    console.error('   Add GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to .env.local\n');
    process.exit(1);
  }

  console.log(`\n🔗 Extracting content from: ${url}\n`);

  try {
    const insight = await fetchAndExtract(url, provider || getBestProvider());

    if (values.json) {
      console.log(JSON.stringify(insight, null, 2));
      return;
    }

    console.log(formatInsight(insight));

    // Optionally capture as learning
    if (values.capture) {
      const keyPointsStr = insight.keyPoints.length > 0
        ? '\n\n**Key Points:**\n' + insight.keyPoints.map(p => `- ${p}`).join('\n')
        : '';

      const learningId = createLearning({
        category: values.category || 'insight',
        title: insight.title,
        description: `${insight.summary}${keyPointsStr}`,
        source_url: insight.url,
        confidence: 'medium',
      });

      console.log(`\n✅ Captured as Learning #${learningId}`);
    }

    console.log('');
  } catch (error: any) {
    console.error(`\n❌ Extraction failed: ${error.message}\n`);
    process.exit(1);
  }
}

async function main() {
  if (values.help || !query) {
    printHelp();
    process.exit(values.help ? 0 : 1);
  }

  // Handle direct URL extraction (no Brave API needed)
  if (isUrl(query)) {
    await handleDirectUrl(query);
    return;
  }

  // Check if API key is available
  if (!isBraveSearchAvailable()) {
    console.error('\n❌ BRAVE_API_KEY not found in environment.');
    console.error('   Add it to .env.local to enable web search.\n');
    process.exit(1);
  }

  // Check deep search availability
  const useDeep = values.deep;
  if (useDeep && !isDeepSearchAvailable()) {
    const availableProviders = ExternalLLM.getAvailableProviders();
    if (availableProviders.length === 0) {
      console.error('\n⚠️  Deep extraction requires an LLM API key.');
      console.error('   Add GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to .env.local');
      console.error('   Falling back to regular search.\n');
    }
  }

  const count = values.count ? parseInt(values.count, 10) : 10;
  const extractCount = values.extract ? parseInt(values.extract, 10) : 3;
  const provider = values.provider as LLMProvider | undefined;

  const modeLabel = useDeep ? '🔬 Deep searching' : '🔍 Searching';
  console.log(`\n${modeLabel}: "${query}"\n`);

  try {
    let results: SearchResult[] | DeepSearchResult[];
    let learningId: number | undefined;
    let extractionStats: { attempted: number; succeeded: number; failed: number } | undefined;

    if (useDeep && isDeepSearchAvailable()) {
      // Deep search with content extraction
      const response = await deepSearch(query, {
        count,
        extractCount,
        provider,
        captureAsLearning: values.capture,
        learningCategory: values.category || 'insight',
        includeNews: values.news,
        freshness: values.freshness,
      });
      results = response.results;
      learningId = response.learningId;
      extractionStats = response.extractionStats;
    } else if (values.capture) {
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
      console.log(JSON.stringify({ query, results, learningId, extractionStats }, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No results found.\n');
      return;
    }

    // Print results
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (useDeep && 'insight' in result) {
        console.log(formatDeepResult(result as DeepSearchResult, i));
      } else {
        console.log(formatResult(result, i));
      }
      console.log('');
    }

    console.log(`\x1b[2m━━━ ${results.length} results ━━━\x1b[0m`);

    if (extractionStats) {
      console.log(`\x1b[2mExtraction: ${extractionStats.succeeded}/${extractionStats.attempted} succeeded\x1b[0m`);
    }

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
