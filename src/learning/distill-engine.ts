/**
 * Distill Engine - Extract actionable learnings from raw content
 *
 * Two modes:
 * 1. Smart mode: Uses Claude Sonnet for high-quality extraction
 * 2. Heuristic mode: Uses regex-based parsing (fallback)
 *
 * Usage:
 *   import { distillFromContent, smartDistill } from './distill-engine';
 *
 *   // Heuristic mode (fast, no API cost)
 *   const result = distillFromContent(markdownContent, { sourcePath: './README.md' });
 *
 *   // Smart mode (higher quality, uses Sonnet)
 *   const result = await smartDistill(markdownContent, { sourcePath: './README.md' });
 */

import type { LearningCategory } from '../interfaces/learning';
import { ExternalLLM, type LLMProvider } from '../services/external-llm';

// ============ Interfaces ============

export interface ParsedItem {
  type: 'list_item' | 'blockquote' | 'code_block' | 'paragraph';
  content: string;
  line: number;
  metadata?: Record<string, string>;  // e.g., language for code blocks
}

export interface ParsedSection {
  header: string;
  level: number;  // 1 for #, 2 for ##, etc.
  content: string;
  startLine: number;
  endLine: number;
  items: ParsedItem[];
}

export interface ExtractedMetric {
  value: string;
  context: string;
  type: 'percentage' | 'multiplier' | 'time' | 'count' | 'size';
}

export interface ExtractedLearning {
  title: string;
  category: LearningCategory;
  what_happened?: string;
  lesson: string;
  prevention?: string;
  source_section?: string;
  source_line?: number;
  confidence: 'low';
  metrics?: ExtractedMetric[];
}

// Enhanced learning with Sonnet-generated fields
export interface EnhancedLearning extends ExtractedLearning {
  reasoning?: string;           // Why this is worth learning
  prerequisites?: string[];     // What you need to know first
  applicability?: string[];     // When to apply this
  counterexamples?: string[];   // When NOT to apply
  relatedConcepts?: string[];   // Links to other learnings
}

export interface SmartDistillConfig {
  provider: LLMProvider;
  model?: string;
  enableLLM: boolean;
  maxLearnings?: number;
}

const DEFAULT_SMART_CONFIG: SmartDistillConfig = {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  enableLLM: true,
  maxLearnings: 15,
};

export interface DistillOptions {
  deep?: boolean;
  maxLearnings?: number;
  minConfidenceScore?: number;
  sourcePath?: string;
  sourceUrl?: string;
}

export interface DistillStats {
  sectionsProcessed: number;
  itemsAnalyzed: number;
  learningsExtracted: number;
  skippedLowRelevance: number;
}

export interface DistillResult {
  learnings: ExtractedLearning[];
  stats: DistillStats;
}

// ============ Category Keywords (from distill.ts) ============

const CATEGORY_KEYWORDS: Record<LearningCategory, RegExp> = {
  // Technical patterns
  performance: /\b(fast|slow|latency|memory|cache|optimize|performance|speed|efficient|throughput)\b/i,
  architecture: /\b(pattern|design|structure|layer|component|module|system|interface|api|abstraction)\b/i,
  tooling: /\b(tool|config|setup|install|cli|command|script|plugin|extension|package)\b/i,
  debugging: /\b(bug|error|fix|issue|debug|trace|log|crash|exception|stack)\b/i,
  security: /\b(security|auth|token|secret|encrypt|vulnerability|permission|credential|xss|injection)\b/i,
  testing: /\b(test|spec|coverage|mock|assert|unit|integration|e2e|fixture)\b/i,
  process: /\b(workflow|process|method|team|review|deploy|release|ci|cd|pipeline)\b/i,
  // Wisdom patterns
  philosophy: /\b(believe|philosophy|approach|mindset|way of|think|perspective)\b/i,
  principle: /\b(always|never|must|rule|principle|guideline|standard|best practice)\b/i,
  insight: /\b(realized|understood|discovered|insight|aha|eureka|learned that)\b/i,
  pattern: /\b(pattern|recurring|often|usually|tend to|common|typical)\b/i,
  retrospective: /\b(learned|retrospective|looking back|in hindsight|reflection|lesson)\b/i,
};

// Section headers that indicate high-value content
const VALUABLE_SECTION_PATTERNS = [
  /lesson/i, /learn/i, /tip/i, /best practice/i, /gotcha/i,
  /avoid/i, /important/i, /note/i, /warning/i, /caveat/i,
  /takeaway/i, /insight/i, /key point/i, /summary/i,
  /how to/i, /why/i, /when to/i, /conclusion/i,
];

// Section headers that indicate low-value/noise content
const NOISE_SECTION_PATTERNS = [
  /table of contents/i, /toc/i, /acknowledgment/i, /license/i,
  /contributing/i, /changelog/i, /installation/i, /prerequisites/i,
  /requirements/i, /dependencies/i, /credits/i, /authors?/i,
  /related project/i, /see also/i, /references/i,
];

// Action verbs that indicate actionable content
const ACTION_VERBS = /\b(use|avoid|ensure|always|never|prefer|consider|try|check|verify|make sure|don't|do not|should|must|can|will|need to)\b/i;

// Outcome words that indicate learning content
const OUTCOME_WORDS = /\b(because|results in|leads to|prevents|causes|improves|reduces|increases|enables|allows|helps|makes)\b/i;

// ============ Parsing Functions ============

/**
 * Parse markdown content into structured sections
 */
export function parseMarkdownStructure(content: string): ParsedSection[] {
  const lines = content.split('\n');
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;
  let inCodeBlock = false;
  let codeBlockStart = -1;
  let codeBlockLang = '';
  let codeBlockContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Track code blocks
    const codeBlockMatch = line.match(/^```(\w*)/);
    if (codeBlockMatch) {
      if (!inCodeBlock) {
        // Start code block
        inCodeBlock = true;
        codeBlockStart = i;
        codeBlockLang = codeBlockMatch[1] || '';
        codeBlockContent = '';
      } else {
        // End code block
        inCodeBlock = false;
        if (currentSection && codeBlockContent.trim()) {
          currentSection.items.push({
            type: 'code_block',
            content: codeBlockContent.trim(),
            line: codeBlockStart,
            metadata: { language: codeBlockLang },
          });
        }
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      continue;
    }

    // Check for header
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      if (currentSection) {
        currentSection.endLine = i - 1;
        sections.push(currentSection);
      }
      currentSection = {
        header: headerMatch[2]!.trim(),
        level: headerMatch[1]!.length,
        content: '',
        startLine: i,
        endLine: i,
        items: [],
      };
      continue;
    }

    // Build section content and extract items
    if (currentSection) {
      currentSection.content += line + '\n';
      currentSection.endLine = i;

      // Extract list items (-, *, +, or numbered)
      const listMatch = line.match(/^\s*[-*+]\s+(.+)$/) || line.match(/^\s*\d+\.\s+(.+)$/);
      if (listMatch) {
        currentSection.items.push({
          type: 'list_item',
          content: listMatch[1]!.trim(),
          line: i,
        });
      }

      // Extract blockquotes
      const quoteMatch = line.match(/^>\s*(.+)$/);
      if (quoteMatch) {
        currentSection.items.push({
          type: 'blockquote',
          content: quoteMatch[1]!.trim(),
          line: i,
        });
      }
    } else if (line.trim()) {
      // Content before first header - create implicit section
      currentSection = {
        header: '(Document Start)',
        level: 0,
        content: line + '\n',
        startLine: i,
        endLine: i,
        items: [],
      };

      // Check if it's a list item
      const listMatch = line.match(/^\s*[-*+]\s+(.+)$/) || line.match(/^\s*\d+\.\s+(.+)$/);
      if (listMatch) {
        currentSection.items.push({
          type: 'list_item',
          content: listMatch[1]!.trim(),
          line: i,
        });
      }
    }
  }

  // Don't forget the last section
  if (currentSection) {
    currentSection.endLine = lines.length - 1;
    sections.push(currentSection);
  }

  return sections;
}

// ============ Scoring Functions ============

/**
 * Extract metrics (percentages, timings, multipliers) from text
 */
export function extractMetrics(text: string): ExtractedMetric[] {
  const metrics: ExtractedMetric[] = [];

  const patterns: Array<{ regex: RegExp; type: ExtractedMetric['type'] }> = [
    { regex: /(\d+(?:\.\d+)?)\s*%/g, type: 'percentage' },
    { regex: /(\d+(?:\.\d+)?)\s*x\s+(?:faster|slower|more|less|better|worse)/gi, type: 'multiplier' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:ms|s|sec|min|hour|day)/gi, type: 'time' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:MB|GB|KB|TB|bytes)/gi, type: 'size' },
    { regex: /reduced\s+(?:by\s+)?(\d+)/gi, type: 'percentage' },
    { regex: /improved\s+(?:by\s+)?(\d+)/gi, type: 'percentage' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:times?|fold)/gi, type: 'multiplier' },
  ];

  for (const { regex, type } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      // Get surrounding context (30 chars before and after)
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + match[0].length + 30);
      const context = text.slice(start, end).trim();

      metrics.push({
        value: match[0],
        context,
        type,
      });
    }
  }

  return metrics;
}

/**
 * Check if a section header indicates noise content
 */
export function isNoiseSection(header: string): boolean {
  return NOISE_SECTION_PATTERNS.some(pattern => pattern.test(header));
}

/**
 * Check if a section header indicates valuable content
 */
function isValuableSection(header: string): boolean {
  return VALUABLE_SECTION_PATTERNS.some(pattern => pattern.test(header));
}

/**
 * Score an item's relevance as a potential learning
 * Returns a score from 0 to 1
 */
export function scoreRelevance(item: ParsedItem, sectionHeader: string): number {
  let score = 0;
  const text = item.content;

  // Base score based on length (too short = noise, too long = probably not a single learning)
  const length = text.length;
  if (length < 20) return 0;  // Too short
  if (length < 40) score += 0.1;
  else if (length <= 200) score += 0.2;
  else if (length <= 400) score += 0.15;
  else score += 0.1;  // Long items slightly penalized

  // Action verbs indicate actionable content
  if (ACTION_VERBS.test(text)) score += 0.2;

  // Outcome words indicate learning content
  if (OUTCOME_WORDS.test(text)) score += 0.2;

  // Metrics presence (concrete data = valuable)
  const metrics = extractMetrics(text);
  if (metrics.length > 0) score += 0.3;

  // Section relevance
  if (isValuableSection(sectionHeader)) score += 0.2;

  // Blockquotes often contain important callouts
  if (item.type === 'blockquote') score += 0.1;

  // Code blocks with explanations can be valuable
  if (item.type === 'code_block' && text.includes('//') || text.includes('#')) {
    score += 0.1;
  }

  // Cap at 1.0
  return Math.min(1, score);
}

/**
 * Suggest a category based on section header and content
 */
export function suggestCategoryFromContext(
  item: ParsedItem,
  section: ParsedSection
): LearningCategory {
  const combinedText = `${section.header} ${item.content}`;

  // Check each category's keywords
  for (const [category, pattern] of Object.entries(CATEGORY_KEYWORDS)) {
    if (pattern.test(combinedText)) {
      return category as LearningCategory;
    }
  }

  // Default to insight for unclassified content
  return 'insight';
}

/**
 * Extract a title from content (first sentence or truncated)
 */
function extractTitle(content: string): string {
  // Try to get first sentence
  const sentenceMatch = content.match(/^[^.!?]+[.!?]/);
  if (sentenceMatch && sentenceMatch[0].length <= 100) {
    return sentenceMatch[0].trim();
  }

  // Fall back to truncation
  if (content.length <= 100) return content.trim();
  return content.slice(0, 97).trim() + '...';
}

/**
 * Try to extract structured fields from content
 */
function extractStructuredFields(content: string): {
  lesson?: string;
  prevention?: string;
} {
  const result: { lesson?: string; prevention?: string } = {};

  // Look for "should", "must", "always" patterns → lesson
  const shouldMatch = content.match(/(should|must|always|ensure)\s+(.{10,})/i);
  if (shouldMatch) {
    result.lesson = shouldMatch[0].trim();
  }

  // Look for "avoid", "never", "don't" patterns → prevention
  const avoidMatch = content.match(/(avoid|never|don'?t|do not)\s+(.{10,})/i);
  if (avoidMatch) {
    result.prevention = avoidMatch[0].trim();
  }

  return result;
}

/**
 * Convert a scored item to an ExtractedLearning
 */
function itemToLearning(
  item: ParsedItem,
  section: ParsedSection,
  options: DistillOptions
): ExtractedLearning | null {
  const score = scoreRelevance(item, section.header);
  const threshold = options.minConfidenceScore ?? 0.3;

  if (score < threshold) return null;

  const category = suggestCategoryFromContext(item, section);
  const title = extractTitle(item.content);
  const structured = extractStructuredFields(item.content);
  const metrics = extractMetrics(item.content);

  return {
    title,
    category,
    lesson: structured.lesson || item.content,
    prevention: structured.prevention,
    source_section: section.header,
    source_line: item.line,
    confidence: 'low',
    metrics: metrics.length > 0 ? metrics : undefined,
  };
}

/**
 * Calculate Jaccard similarity between two strings (word-based)
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

/**
 * Deduplicate learnings by merging similar ones
 */
function deduplicateLearnings(learnings: ExtractedLearning[]): ExtractedLearning[] {
  if (learnings.length <= 1) return learnings;

  const result: ExtractedLearning[] = [];
  const used = new Set<number>();

  for (let i = 0; i < learnings.length; i++) {
    if (used.has(i)) continue;

    const current = learnings[i]!;
    let merged = current;

    // Check for similar learnings
    for (let j = i + 1; j < learnings.length; j++) {
      if (used.has(j)) continue;

      const other = learnings[j]!;
      const similarity = jaccardSimilarity(current.lesson, other.lesson);

      if (similarity > 0.8) {
        // Merge: keep the one with more metrics, or longer content
        const currentScore = (current.metrics?.length || 0) + current.lesson.length / 100;
        const otherScore = (other.metrics?.length || 0) + other.lesson.length / 100;

        if (otherScore > currentScore) {
          merged = other;
        }
        used.add(j);
      }
    }

    result.push(merged);
    used.add(i);
  }

  return result;
}

// ============ Main Entry Point ============

/**
 * Extract learnings from raw markdown content
 */
export function distillFromContent(
  content: string,
  options: DistillOptions = {}
): DistillResult {
  const {
    maxLearnings = 20,
    minConfidenceScore = 0.3,
  } = options;

  const sections = parseMarkdownStructure(content);
  const learnings: ExtractedLearning[] = [];
  let itemsAnalyzed = 0;
  let skippedLowRelevance = 0;
  let sectionsProcessed = 0;

  for (const section of sections) {
    // Skip noise sections
    if (isNoiseSection(section.header)) continue;
    sectionsProcessed++;

    for (const item of section.items) {
      itemsAnalyzed++;

      const learning = itemToLearning(item, section, { minConfidenceScore });
      if (learning) {
        learnings.push(learning);
      } else {
        skippedLowRelevance++;
      }

      // Stop if we've hit the limit
      if (learnings.length >= maxLearnings) break;
    }

    if (learnings.length >= maxLearnings) break;
  }

  // Deduplicate similar learnings
  const deduplicated = deduplicateLearnings(learnings);

  return {
    learnings: deduplicated,
    stats: {
      sectionsProcessed,
      itemsAnalyzed,
      learningsExtracted: deduplicated.length,
      skippedLowRelevance: skippedLowRelevance + (learnings.length - deduplicated.length),
    },
  };
}

// ============ Smart Distill (Sonnet-based) ============

/**
 * Extract learnings using Claude Sonnet for higher quality
 */
export async function smartDistill(
  content: string,
  options: DistillOptions & Partial<SmartDistillConfig> = {}
): Promise<{ learnings: EnhancedLearning[]; stats: DistillStats }> {
  const config: SmartDistillConfig = {
    ...DEFAULT_SMART_CONFIG,
    provider: options.provider || DEFAULT_SMART_CONFIG.provider,
    model: options.model || DEFAULT_SMART_CONFIG.model,
    enableLLM: options.enableLLM ?? DEFAULT_SMART_CONFIG.enableLLM,
    maxLearnings: options.maxLearnings || DEFAULT_SMART_CONFIG.maxLearnings,
  };

  // If LLM is disabled, fall back to heuristic extraction
  if (!config.enableLLM) {
    const result = distillFromContent(content, options);
    return {
      learnings: result.learnings as EnhancedLearning[],
      stats: result.stats,
    };
  }

  // Try LLM extraction
  let llm: ExternalLLM;
  try {
    llm = new ExternalLLM(config.provider);
  } catch (error) {
    console.error(`[SmartDistill] LLM init failed, falling back to heuristics: ${error}`);
    const result = distillFromContent(content, options);
    return {
      learnings: result.learnings as EnhancedLearning[],
      stats: result.stats,
    };
  }

  const prompt = buildSmartDistillPrompt(content, config.maxLearnings!);

  try {
    const response = await llm.query(prompt, {
      model: config.model,
      maxOutputTokens: 4096,
      temperature: 0.4,
    });

    const learnings = parseSmartDistillResponse(response.text);

    return {
      learnings,
      stats: {
        sectionsProcessed: 1, // LLM processes as one unit
        itemsAnalyzed: content.split('\n').length,
        learningsExtracted: learnings.length,
        skippedLowRelevance: 0,
      },
    };
  } catch (error) {
    console.error(`[SmartDistill] LLM extraction failed: ${error}`);
    const result = distillFromContent(content, options);
    return {
      learnings: result.learnings as EnhancedLearning[],
      stats: result.stats,
    };
  }
}

/**
 * Build prompt for Sonnet-based extraction
 */
function buildSmartDistillPrompt(content: string, maxLearnings: number): string {
  // Truncate content if too long (keep under ~10k tokens)
  const maxChars = 30000;
  const truncatedContent = content.length > maxChars
    ? content.slice(0, maxChars) + '\n\n[Content truncated...]'
    : content;

  return `You are an expert at extracting valuable learnings from technical content. Analyze the following content and extract actionable learnings.

## Content to Analyze
${truncatedContent}

## Extraction Guidelines

Extract learnings that are:
1. **Specific** - Not generic advice, but concrete observations
2. **Actionable** - Someone can DO something with this
3. **Evidence-backed** - Has reasoning or data behind it
4. **Novel** - Not obvious common knowledge

For each learning, provide:
- **title**: Imperative statement, <10 words (e.g., "Use bulk inserts with transactions")
- **category**: One of: performance, architecture, tooling, process, debugging, security, testing, philosophy, principle, insight, pattern, retrospective
- **lesson**: The core learning (1-2 sentences)
- **reasoning**: Why this matters (1 sentence)
- **applicability**: When to apply this (list of scenarios)
- **counterexamples**: When NOT to apply this (list of exceptions)
- **relatedConcepts**: Related topics/technologies (list)

Extract up to ${maxLearnings} learnings. Quality over quantity - skip generic or obvious items.

Respond with a JSON array:
[
  {
    "title": "...",
    "category": "...",
    "lesson": "...",
    "reasoning": "...",
    "applicability": ["when X", "when Y"],
    "counterexamples": ["not when Z"],
    "relatedConcepts": ["concept1", "concept2"],
    "confidence": "low"
  }
]

Only output valid JSON, no additional text.`;
}

/**
 * Parse Sonnet response into enhanced learnings
 */
function parseSmartDistillResponse(response: string): EnhancedLearning[] {
  try {
    // Extract JSON array from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[SmartDistill] No JSON array found in response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as any[];
    const validCategories: LearningCategory[] = [
      'performance', 'architecture', 'tooling', 'process', 'debugging',
      'security', 'testing', 'philosophy', 'principle', 'insight',
      'pattern', 'retrospective',
    ];

    return parsed
      .filter(item => item.title && item.lesson)
      .map(item => ({
        title: String(item.title).slice(0, 200),
        category: validCategories.includes(item.category) ? item.category : 'insight',
        lesson: String(item.lesson),
        reasoning: item.reasoning,
        applicability: Array.isArray(item.applicability) ? item.applicability : undefined,
        counterexamples: Array.isArray(item.counterexamples) ? item.counterexamples : undefined,
        relatedConcepts: Array.isArray(item.relatedConcepts) ? item.relatedConcepts : undefined,
        confidence: 'low' as const,
      }));
  } catch (error) {
    console.error(`[SmartDistill] Failed to parse response: ${error}`);
    return [];
  }
}

export default {
  parseMarkdownStructure,
  distillFromContent,
  smartDistill,
  extractMetrics,
  scoreRelevance,
  suggestCategoryFromContext,
  isNoiseSection,
};
