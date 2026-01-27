/**
 * Cross-Session Pattern Detection
 *
 * Phase 7: Uses Gemini Pro's long context to detect patterns across multiple sessions.
 * Falls back to heuristics when LLM is unavailable.
 */

import type { SessionRecord, LearningRecord } from '../db';
import { listSessionsFromDb as listSessions, getSessionById, searchLearnings, getLearningStats } from '../db';
import { ExternalLLM, type LLMProvider } from '../services/external-llm';

// ============ Types ============

export interface CrossSessionPattern {
  pattern: string;
  description: string;
  sessions: string[];      // Session IDs
  frequency: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  confidence: number;      // 0-1
  recommendation: string;
  category: 'workflow' | 'challenge' | 'success' | 'anti-pattern' | 'insight';
}

export interface CrossSessionAnalysis {
  patterns: CrossSessionPattern[];
  summary: string;
  stats: {
    sessionsAnalyzed: number;
    patternsDetected: number;
    usedLLM: boolean;
    tokensUsed?: number;
  };
}

export interface CrossSessionConfig {
  provider: LLMProvider;
  model?: string;
  enableLLM: boolean;
  maxSessions?: number;
  minPatternFrequency?: number;
}

const DEFAULT_CONFIG: CrossSessionConfig = {
  provider: 'gemini',
  model: 'gemini-2.0-flash', // Fast and capable
  enableLLM: true,
  maxSessions: 50,
  minPatternFrequency: 2,
};

// ============ LLM Prompt ============

const CROSS_SESSION_PROMPT = `You are an expert at identifying patterns in software development work sessions.

Analyze the following session summaries and identify recurring patterns across multiple sessions:

1. **Workflow patterns**: Common approaches, tools, or processes used repeatedly
2. **Challenge patterns**: Recurring difficulties or obstacles
3. **Success patterns**: Strategies that work well
4. **Anti-patterns**: Bad habits or approaches that cause problems
5. **Insights**: Cross-cutting observations about the work

For each pattern, provide:
- pattern: Short name (3-5 words)
- description: What the pattern is about
- sessions: Array of session IDs where this appears
- frequency: How many sessions exhibit this pattern
- trend: "increasing", "stable", or "decreasing" based on recent vs older sessions
- confidence: 0-1 how confident you are this is a real pattern
- recommendation: What action to take (continue, stop, investigate, etc.)
- category: One of workflow, challenge, success, anti-pattern, insight

Also provide a brief overall summary of the work patterns.

Respond in JSON format:
{
  "patterns": [...],
  "summary": "..."
}

Sessions to analyze:
`;

// ============ CrossSessionAnalyzer Class ============

export class CrossSessionAnalyzer {
  private config: CrossSessionConfig;
  private llm: ExternalLLM | null;

  constructor(config: Partial<CrossSessionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llm = null;

    // Only initialize LLM if enabled and API key is available
    if (this.config.enableLLM) {
      try {
        this.llm = new ExternalLLM(this.config.provider);
      } catch {
        // No API key available, will use heuristics
        this.llm = null;
      }
    }
  }

  /**
   * Analyze patterns across recent sessions
   */
  async analyzePatterns(options: {
    sessionIds?: string[];
    sinceDays?: number;
    tag?: string;
  } = {}): Promise<CrossSessionAnalysis> {
    // Get sessions to analyze
    let sessions: SessionRecord[];

    if (options.sessionIds) {
      sessions = options.sessionIds
        .map(id => getSessionById(id))
        .filter((s): s is SessionRecord => s !== null);
    } else {
      const limit = this.config.maxSessions || 50;
      sessions = listSessions({
        limit,
        tag: options.tag,
      });
    }

    // Filter by date if specified
    if (options.sinceDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - options.sinceDays);
      sessions = sessions.filter(s => {
        const sessionDate = new Date(s.created_at || '');
        return sessionDate >= cutoff;
      });
    }

    if (sessions.length < 2) {
      return {
        patterns: [],
        summary: 'Not enough sessions to analyze patterns (need at least 2)',
        stats: {
          sessionsAnalyzed: sessions.length,
          patternsDetected: 0,
          usedLLM: false,
        },
      };
    }

    // Try LLM analysis
    if (this.llm && this.config.enableLLM) {
      try {
        return await this.analyzeWithLLM(sessions);
      } catch (error) {
        console.warn('LLM analysis failed, falling back to heuristics:', error);
      }
    }

    return this.analyzeWithHeuristics(sessions);
  }

  /**
   * LLM-based pattern detection using Gemini
   */
  private async analyzeWithLLM(sessions: SessionRecord[]): Promise<CrossSessionAnalysis> {
    // Format sessions for the prompt
    const sessionText = sessions.map(s => {
      const tags = s.tags ? JSON.parse(s.tags).join(', ') : '';
      return `Session ${s.id} (${s.created_at}):
  Summary: ${s.summary}
  Tags: ${tags}
  Duration: ${s.duration_mins || 'unknown'} mins
  Commits: ${s.commits_count || 0}`;
    }).join('\n\n');

    const prompt = CROSS_SESSION_PROMPT + sessionText;

    const response = await this.llm!.complete(prompt, {
      model: this.config.model,
      maxOutputTokens: 4096,
    });

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in LLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const patterns: CrossSessionPattern[] = (parsed.patterns || [])
      .filter((p: any) => (p.frequency || p.sessions?.length || 0) >= (this.config.minPatternFrequency || 2))
      .map((p: any) => ({
        pattern: String(p.pattern || '').trim(),
        description: String(p.description || '').trim(),
        sessions: Array.isArray(p.sessions) ? p.sessions.map(String) : [],
        frequency: Number(p.frequency) || p.sessions?.length || 0,
        trend: this.validateTrend(p.trend),
        confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0.5)),
        recommendation: String(p.recommendation || '').trim(),
        category: this.validateCategory(p.category),
      }))
      .filter((p: CrossSessionPattern) => p.pattern.length > 0);

    return {
      patterns,
      summary: String(parsed.summary || 'Analysis complete'),
      stats: {
        sessionsAnalyzed: sessions.length,
        patternsDetected: patterns.length,
        usedLLM: true,
      },
    };
  }

  /**
   * Heuristic-based pattern detection (fallback)
   */
  private analyzeWithHeuristics(sessions: SessionRecord[]): CrossSessionAnalysis {
    const patterns: CrossSessionPattern[] = [];

    // Analyze tag frequency
    const tagCounts = new Map<string, string[]>();
    for (const session of sessions) {
      if (session.tags) {
        try {
          // Handle both array and JSON string formats
          const tags = Array.isArray(session.tags)
            ? session.tags
            : (typeof session.tags === 'string' && session.tags.trim()
              ? JSON.parse(session.tags)
              : []) as string[];
          for (const tag of tags) {
            if (typeof tag === 'string') {
              const sessionIds = tagCounts.get(tag) || [];
              sessionIds.push(session.id!);
              tagCounts.set(tag, sessionIds);
            }
          }
        } catch {
          // Skip invalid JSON tags
        }
      }
    }

    // Create patterns from frequent tags
    for (const [tag, sessionIds] of tagCounts) {
      if (sessionIds.length >= (this.config.minPatternFrequency || 2)) {
        patterns.push({
          pattern: `Recurring: ${tag}`,
          description: `Tag "${tag}" appears across ${sessionIds.length} sessions`,
          sessions: sessionIds,
          frequency: sessionIds.length,
          trend: this.detectTrend(sessionIds, sessions),
          confidence: 0.6,
          recommendation: 'Consider documenting common practices',
          category: 'workflow',
        });
      }
    }

    // Analyze common words in summaries
    const wordCounts = new Map<string, string[]>();
    const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'and', 'in', 'for', 'on', 'with', 'at', 'by', 'from']);

    for (const session of sessions) {
      if (session.summary) {
        const words = session.summary.toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 3 && !STOPWORDS.has(w));

        const seen = new Set<string>();
        for (const word of words) {
          if (!seen.has(word)) {
            seen.add(word);
            const sessionIds = wordCounts.get(word) || [];
            sessionIds.push(session.id!);
            wordCounts.set(word, sessionIds);
          }
        }
      }
    }

    // Find frequently mentioned concepts
    const sortedWords = Array.from(wordCounts.entries())
      .filter(([_, ids]) => ids.length >= Math.min(3, sessions.length / 2))
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);

    for (const [word, sessionIds] of sortedWords) {
      patterns.push({
        pattern: `Focus: ${word}`,
        description: `Concept "${word}" mentioned in ${sessionIds.length} sessions`,
        sessions: sessionIds,
        frequency: sessionIds.length,
        trend: this.detectTrend(sessionIds, sessions),
        confidence: 0.5,
        recommendation: 'Key topic - consider creating dedicated learning',
        category: 'insight',
      });
    }

    return {
      patterns,
      summary: `Heuristic analysis of ${sessions.length} sessions found ${patterns.length} patterns`,
      stats: {
        sessionsAnalyzed: sessions.length,
        patternsDetected: patterns.length,
        usedLLM: false,
      },
    };
  }

  /**
   * Detect trend by comparing recent vs older sessions
   */
  private detectTrend(
    patternSessionIds: string[],
    allSessions: SessionRecord[]
  ): 'increasing' | 'stable' | 'decreasing' {
    if (patternSessionIds.length < 2) return 'stable';

    // Sort sessions by date
    const sortedSessions = [...allSessions].sort((a, b) =>
      new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime()
    );

    const midpoint = Math.floor(sortedSessions.length / 2);
    const oldSessionIds = new Set(sortedSessions.slice(0, midpoint).map(s => s.id));
    const newSessionIds = new Set(sortedSessions.slice(midpoint).map(s => s.id));

    const oldCount = patternSessionIds.filter(id => oldSessionIds.has(id)).length;
    const newCount = patternSessionIds.filter(id => newSessionIds.has(id)).length;

    if (newCount > oldCount * 1.5) return 'increasing';
    if (oldCount > newCount * 1.5) return 'decreasing';
    return 'stable';
  }

  private validateTrend(trend: any): 'increasing' | 'stable' | 'decreasing' {
    const valid = ['increasing', 'stable', 'decreasing'];
    return valid.includes(trend) ? trend : 'stable';
  }

  private validateCategory(category: any): CrossSessionPattern['category'] {
    const valid = ['workflow', 'challenge', 'success', 'anti-pattern', 'insight'];
    return valid.includes(category) ? category : 'insight';
  }
}

// ============ Convenience Functions ============

let defaultAnalyzer: CrossSessionAnalyzer | null = null;

export function getCrossSessionAnalyzer(config?: Partial<CrossSessionConfig>): CrossSessionAnalyzer {
  if (!defaultAnalyzer || config) {
    defaultAnalyzer = new CrossSessionAnalyzer(config);
  }
  return defaultAnalyzer;
}

/**
 * Quick analysis of recent sessions
 */
export async function analyzeRecentSessions(
  sinceDays: number = 30,
  config?: Partial<CrossSessionConfig>
): Promise<CrossSessionAnalysis> {
  const analyzer = getCrossSessionAnalyzer(config);
  return analyzer.analyzePatterns({ sinceDays });
}

/**
 * Analyze sessions with a specific tag
 */
export async function analyzeSessionsByTag(
  tag: string,
  config?: Partial<CrossSessionConfig>
): Promise<CrossSessionAnalysis> {
  const analyzer = getCrossSessionAnalyzer(config);
  return analyzer.analyzePatterns({ tag });
}
