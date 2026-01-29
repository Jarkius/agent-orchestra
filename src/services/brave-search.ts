/**
 * Brave Search API Integration
 *
 * Provides web search capabilities for augmenting the memory system
 * with real-time information from the web.
 */

// ============================================================================
// Types
// ============================================================================

export interface BraveSearchOptions {
  count?: number;           // Results per request (1-20, default: 10)
  offset?: number;          // Pagination offset (0-9)
  country?: string;         // 2-char country code (default: US)
  searchLang?: string;      // Language code (default: en)
  safesearch?: 'off' | 'moderate' | 'strict';
  freshness?: 'pd' | 'pw' | 'pm' | 'py' | string;  // past day/week/month/year or date range
  spellcheck?: boolean;
}

export interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  age?: string;              // e.g., "2 hours ago"
  language?: string;
  family_friendly?: boolean;
  extra_snippets?: string[];
}

export interface BraveSearchResponse {
  query: {
    original: string;
    altered?: string;        // Spell-corrected query
    spellcheck_off?: boolean;
  };
  web?: {
    results: BraveWebResult[];
    family_friendly: boolean;
  };
  news?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
      age: string;
      source: { name: string; url: string };
    }>;
  };
  videos?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
      thumbnail?: { src: string };
    }>;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  type: 'web' | 'news' | 'video';
  age?: string;
  source?: string;
}

// ============================================================================
// API Client
// ============================================================================

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Check if Brave Search API is available
 */
export function isBraveSearchAvailable(): boolean {
  return !!process.env.BRAVE_API_KEY;
}

/**
 * Get the API key (throws if not available)
 */
function getApiKey(): string {
  const key = process.env.BRAVE_API_KEY;
  if (!key) {
    throw new Error('BRAVE_API_KEY not set. Add it to .env.local');
  }
  return key;
}

/**
 * Search the web using Brave Search API
 */
export async function braveSearch(
  query: string,
  options: BraveSearchOptions = {}
): Promise<BraveSearchResponse> {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    q: query,
    count: String(options.count || 10),
  });

  if (options.offset) params.set('offset', String(options.offset));
  if (options.country) params.set('country', options.country);
  if (options.searchLang) params.set('search_lang', options.searchLang);
  if (options.safesearch) params.set('safesearch', options.safesearch);
  if (options.freshness) params.set('freshness', options.freshness);
  if (options.spellcheck !== undefined) params.set('spellcheck', String(options.spellcheck));

  const response = await fetch(`${BRAVE_API_URL}?${params}`, {
    headers: {
      'Accept': 'application/json',
      'x-subscription-token': apiKey,
    },
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 404) throw new Error('Brave API: Subscription not found');
    if (status === 422) throw new Error('Brave API: Invalid token');
    if (status === 429) throw new Error('Brave API: Rate limit exceeded');
    throw new Error(`Brave API error: ${status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Search and return simplified results
 */
export async function search(
  query: string,
  options: BraveSearchOptions & { includeNews?: boolean; includeVideos?: boolean } = {}
): Promise<SearchResult[]> {
  const response = await braveSearch(query, options);
  const results: SearchResult[] = [];

  // Add web results
  if (response.web?.results) {
    for (const r of response.web.results) {
      results.push({
        title: r.title,
        url: r.url,
        description: r.description,
        type: 'web',
        age: r.age,
      });
    }
  }

  // Add news results
  if (options.includeNews && response.news?.results) {
    for (const r of response.news.results) {
      results.push({
        title: r.title,
        url: r.url,
        description: r.description,
        type: 'news',
        age: r.age,
        source: r.source?.name,
      });
    }
  }

  // Add video results
  if (options.includeVideos && response.videos?.results) {
    for (const r of response.videos.results) {
      results.push({
        title: r.title,
        url: r.url,
        description: r.description,
        type: 'video',
      });
    }
  }

  return results;
}

/**
 * Search for recent results (past day/week/month)
 */
export async function searchRecent(
  query: string,
  freshness: 'day' | 'week' | 'month' = 'week',
  count: number = 10
): Promise<SearchResult[]> {
  const freshnessMap = { day: 'pd', week: 'pw', month: 'pm' };
  return search(query, {
    count,
    freshness: freshnessMap[freshness],
    includeNews: true,
  });
}

/**
 * Search for programming/tech topics
 */
export async function searchTech(
  query: string,
  count: number = 10
): Promise<SearchResult[]> {
  // Add programming context to improve results
  const techQuery = query.includes('programming') || query.includes('code')
    ? query
    : `${query} programming development`;

  return search(techQuery, {
    count,
    safesearch: 'moderate',
  });
}

// ============================================================================
// Memory Integration
// ============================================================================

import { createLearning } from '../db';
import {
  fetchAndExtract,
  isExtractionAvailable,
  getBestProvider,
  type ExtractedInsight,
} from './content-fetcher';
import type { LLMProvider } from './external-llm';

export interface DeepSearchResult extends SearchResult {
  insight?: ExtractedInsight;
  extractionError?: string;
}

export interface DeepSearchOptions extends BraveSearchOptions {
  // Deep extraction options
  deep?: boolean;              // Enable content extraction
  extractCount?: number;       // How many URLs to extract (default: 3)
  provider?: LLMProvider;      // LLM provider for extraction
  // Capture options
  captureAsLearning?: boolean;
  learningCategory?: string;
  includeNews?: boolean;
}

/**
 * Search and optionally capture results as a learning
 */
export async function searchAndCapture(
  query: string,
  options: DeepSearchOptions = {}
): Promise<{ results: SearchResult[]; learningId?: number }> {
  const results = await search(query, options);

  let learningId: number | undefined;

  if (options.captureAsLearning && results.length > 0) {
    // Create a learning from the search results
    const topResults = results.slice(0, 5);
    const description = topResults
      .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
      .join('\n\n');

    learningId = createLearning({
      category: options.learningCategory || 'insight',
      title: `Web research: ${query}`,
      description: `Search results for "${query}":\n\n${description}`,
      source_url: topResults.map(r => r.url).join(', '),
      confidence: 'low',
    });
  }

  return { results, learningId };
}

/**
 * Deep search: Search, fetch content, and extract insights using LLM
 */
export async function deepSearch(
  query: string,
  options: DeepSearchOptions = {}
): Promise<{
  results: DeepSearchResult[];
  learningId?: number;
  extractionStats: { attempted: number; succeeded: number; failed: number };
}> {
  const {
    extractCount = 3,
    provider = isExtractionAvailable() ? getBestProvider() : 'gemini',
    ...searchOptions
  } = options;

  // First, do the regular search
  const results = await search(query, searchOptions);

  // Stats tracking
  const stats = { attempted: 0, succeeded: 0, failed: 0 };

  // Extract content from top results
  const deepResults: DeepSearchResult[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;

    if (i < extractCount && isExtractionAvailable()) {
      stats.attempted++;
      try {
        const insight = await fetchAndExtract(result.url, provider);
        deepResults.push({ ...result, insight });
        stats.succeeded++;
      } catch (error: any) {
        deepResults.push({
          ...result,
          extractionError: error.message || String(error),
        });
        stats.failed++;
      }
    } else {
      deepResults.push(result);
    }
  }

  // Optionally capture as learning (with extracted insights)
  let learningId: number | undefined;

  if (options.captureAsLearning && deepResults.length > 0) {
    const extracted = deepResults.filter(r => r.insight);
    const description = extracted.length > 0
      ? extracted.map((r, i) => {
          const insight = r.insight!;
          const keyPointsStr = insight.keyPoints.length > 0
            ? '\n\n**Key Points:**\n' + insight.keyPoints.map(p => `- ${p}`).join('\n')
            : '';
          return `### ${i + 1}. ${insight.title}\n${r.url}\n\n${insight.summary}${keyPointsStr}`;
        }).join('\n\n---\n\n')
      : deepResults.slice(0, 5).map((r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`
        ).join('\n\n');

    learningId = createLearning({
      category: options.learningCategory || 'insight',
      title: `Deep research: ${query}`,
      description: `Research findings for "${query}":\n\n${description}`,
      source_url: deepResults.slice(0, 5).map(r => r.url).join(', '),
      confidence: extracted.length > 0 ? 'medium' : 'low',
    });
  }

  return { results: deepResults, learningId, extractionStats: stats };
}

/**
 * Check if deep search (with LLM extraction) is available
 */
export function isDeepSearchAvailable(): boolean {
  return isBraveSearchAvailable() && isExtractionAvailable();
}
