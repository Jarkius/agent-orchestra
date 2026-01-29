/**
 * Content Fetcher Service
 *
 * Fetches and extracts readable content from web pages.
 * Supports various content types including articles, YouTube, and more.
 */

import { ExternalLLM, type LLMProvider } from './external-llm';

// ============================================================================
// Types
// ============================================================================

export interface FetchedContent {
  url: string;
  title: string;
  content: string;
  contentType: 'article' | 'youtube' | 'github' | 'documentation' | 'unknown';
  byline?: string;
  excerpt?: string;
  wordCount: number;
  fetchedAt: string;
}

export interface ExtractedInsight {
  url: string;
  title: string;
  summary: string;
  keyPoints: string[];
  contentType: string;
  provider: LLMProvider;
  model: string;
}

export interface ContentFetchOptions {
  timeout?: number;
  maxContentLength?: number;
}

// ============================================================================
// Content Detection
// ============================================================================

function detectContentType(url: string): FetchedContent['contentType'] {
  const urlLower = url.toLowerCase();

  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    return 'youtube';
  }
  if (urlLower.includes('github.com')) {
    return 'github';
  }
  if (
    urlLower.includes('docs.') ||
    urlLower.includes('/docs/') ||
    urlLower.includes('documentation') ||
    urlLower.includes('readme')
  ) {
    return 'documentation';
  }

  return 'article';
}

/**
 * Extract YouTube video ID from URL
 */
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1]!;
  }
  return null;
}

// ============================================================================
// HTML Parsing (simple extraction without heavy dependencies)
// ============================================================================

/**
 * Simple HTML to text extraction
 * Removes scripts, styles, and extracts readable text
 */
function htmlToText(html: string): string {
  // Remove scripts and styles
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Remove HTML tags but keep content
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));

  // Clean up whitespace
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  return text;
}

/**
 * Extract title from HTML
 */
function extractTitle(html: string): string {
  // Try <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1]!.trim();

  // Try og:title
  const ogMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
  if (ogMatch) return ogMatch[1]!.trim();

  // Try h1
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1]!.trim();

  return 'Untitled';
}

/**
 * Extract description/excerpt from HTML
 */
function extractExcerpt(html: string): string | undefined {
  // Try meta description
  const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
  if (descMatch) return descMatch[1]!.trim();

  // Try og:description
  const ogMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
  if (ogMatch) return ogMatch[1]!.trim();

  return undefined;
}

// ============================================================================
// Content Fetching
// ============================================================================

/**
 * Fetch and extract content from a URL
 */
export async function fetchContent(
  url: string,
  options: ContentFetchOptions = {}
): Promise<FetchedContent> {
  const { timeout = 10000, maxContentLength = 50000 } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MemoryBot/1.0; +https://github.com/matrix-memory-agents)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const contentType = detectContentType(url);
    const title = extractTitle(html);
    const excerpt = extractExcerpt(html);

    // Extract text content
    let content = htmlToText(html);

    // Truncate if too long
    if (content.length > maxContentLength) {
      content = content.slice(0, maxContentLength) + '... [truncated]';
    }

    return {
      url,
      title,
      content,
      contentType,
      excerpt,
      wordCount: content.split(/\s+/).length,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Fetch YouTube video info (using oEmbed API - no transcript)
 */
export async function fetchYouTubeInfo(url: string): Promise<FetchedContent> {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  // Use oEmbed API to get basic info
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

  const response = await fetch(oembedUrl);
  if (!response.ok) {
    throw new Error(`YouTube oEmbed failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    title: string;
    author_name: string;
    thumbnail_url: string;
  };

  return {
    url,
    title: data.title,
    content: `YouTube Video: "${data.title}" by ${data.author_name}. Video ID: ${videoId}. Note: Full transcript extraction requires additional APIs.`,
    contentType: 'youtube',
    byline: data.author_name,
    wordCount: 0,
    fetchedAt: new Date().toISOString(),
  };
}

// ============================================================================
// LLM Content Extraction
// ============================================================================

const EXTRACTION_PROMPT = `You are a content analyzer. Given the following web page content, extract the key information.

URL: {url}
Title: {title}
Content Type: {contentType}

--- PAGE CONTENT ---
{content}
--- END CONTENT ---

Provide a response in the following format:

SUMMARY:
[2-3 sentence summary of the main content]

KEY POINTS:
- [Key point 1]
- [Key point 2]
- [Key point 3]
- [Add more if relevant, max 7]

Be concise and focus on actionable insights. If this is technical content, emphasize the practical takeaways.`;

/**
 * Extract insights from fetched content using an LLM
 */
export async function extractInsights(
  content: FetchedContent,
  provider: LLMProvider = 'gemini'
): Promise<ExtractedInsight> {
  const llm = new ExternalLLM(provider);

  // Prepare the content (truncate if too long for LLM)
  const maxContent = 15000; // ~4k tokens roughly
  const truncatedContent =
    content.content.length > maxContent
      ? content.content.slice(0, maxContent) + '... [truncated for analysis]'
      : content.content;

  const prompt = EXTRACTION_PROMPT.replace('{url}', content.url)
    .replace('{title}', content.title)
    .replace('{contentType}', content.contentType)
    .replace('{content}', truncatedContent);

  const response = await llm.query(prompt, {
    temperature: 0.3, // Lower for more focused extraction
    maxOutputTokens: 1024,
  });

  // Parse the response
  const text = response.text;

  // Extract summary
  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?=KEY POINTS:|$)/i);
  const summary = summaryMatch ? summaryMatch[1]!.trim() : text.slice(0, 500);

  // Extract key points
  const keyPointsMatch = text.match(/KEY POINTS:\s*([\s\S]*?)$/i);
  const keyPointsText = keyPointsMatch ? keyPointsMatch[1]!.trim() : '';
  const keyPoints = keyPointsText
    .split(/\n/)
    .map(line => line.replace(/^[-•*]\s*/, '').trim())
    .filter(line => line.length > 0);

  return {
    url: content.url,
    title: content.title,
    summary,
    keyPoints,
    contentType: content.contentType,
    provider: response.provider,
    model: response.model,
  };
}

/**
 * Fetch URL and extract insights in one call
 */
export async function fetchAndExtract(
  url: string,
  provider: LLMProvider = 'gemini'
): Promise<ExtractedInsight> {
  const contentType = detectContentType(url);

  let content: FetchedContent;

  if (contentType === 'youtube') {
    content = await fetchYouTubeInfo(url);
  } else {
    content = await fetchContent(url);
  }

  return extractInsights(content, provider);
}

/**
 * Check if any LLM provider is available for extraction
 */
export function isExtractionAvailable(): boolean {
  return ExternalLLM.getAvailableProviders().length > 0;
}

/**
 * Get the best available LLM provider for extraction
 */
export function getBestProvider(): LLMProvider {
  const providers = ExternalLLM.getAvailableProviders();
  // Prefer Gemini (usually faster/cheaper), then OpenAI, then Anthropic
  if (providers.includes('gemini')) return 'gemini';
  if (providers.includes('openai')) return 'openai';
  if (providers.includes('anthropic')) return 'anthropic';
  throw new Error('No LLM provider available. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY');
}
