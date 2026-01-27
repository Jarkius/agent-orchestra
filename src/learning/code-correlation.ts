/**
 * Code-Learning Correlation
 *
 * Phase 7: Uses Gemini Pro to intelligently link learnings to relevant code files.
 * Analyzes code patterns and learning content to find meaningful connections.
 */

import type { LearningRecord, CodeFileRecord, LearningCodeLinkRecord } from '../db';
import {
  listLearningsFromDb as listLearnings,
  getAllCodeFiles as listCodeFiles,
  linkLearningToCode,
  getLearningsForFile,
  getFilesForLearning,
  getLearningCodeLinkStats as getCodeLinkStats,
} from '../db';
import { ExternalLLM, type LLMProvider } from '../services/external-llm';

// ============ Types ============

export interface CorrelationMatch {
  learning: LearningRecord;
  codeFile: CodeFileRecord;
  linkType: LearningCodeLinkRecord['link_type'];
  relevanceScore: number;
  reasoning: string;
}

export interface CorrelationResult {
  matches: CorrelationMatch[];
  stats: {
    learningsAnalyzed: number;
    filesAnalyzed: number;
    linksCreated: number;
    usedLLM: boolean;
  };
}

export interface CodeCorrelationConfig {
  provider: LLMProvider;
  model?: string;
  enableLLM: boolean;
  maxLearnings?: number;
  maxFilesPerLearning?: number;
  minRelevanceScore?: number;
  persistLinks?: boolean;
}

const DEFAULT_CONFIG: CodeCorrelationConfig = {
  provider: 'gemini',
  model: 'gemini-2.0-flash',
  enableLLM: true,
  maxLearnings: 50,
  maxFilesPerLearning: 10,
  minRelevanceScore: 0.5,
  persistLinks: true,
};

// ============ LLM Prompt ============

const CORRELATION_PROMPT = `You are an expert at understanding the relationship between learnings/insights and code files.

Given a learning and a list of code files, determine which files are most relevant to the learning and what type of relationship exists.

Link types:
- derived_from: Learning was created by analyzing this code
- applies_to: Learning can be applied to improve this code
- example_in: This code demonstrates the learning in practice
- pattern_match: This code follows the pattern described in the learning

For each relevant file, provide:
- file_id: The code file ID
- link_type: One of the types above
- relevance: 0-1 score
- reasoning: Brief explanation of the relationship

Respond in JSON format:
{
  "matches": [
    { "file_id": "...", "link_type": "...", "relevance": 0.9, "reasoning": "..." }
  ]
}

Learning to correlate:
Title: {{title}}
Description: {{description}}
Category: {{category}}

Code files to consider:
`;

// ============ CodeCorrelator Class ============

export class CodeCorrelator {
  private config: CodeCorrelationConfig;
  private llm: ExternalLLM | null;

  constructor(config: Partial<CodeCorrelationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llm = null;

    if (this.config.enableLLM) {
      try {
        this.llm = new ExternalLLM(this.config.provider);
      } catch {
        this.llm = null;
      }
    }
  }

  /**
   * Correlate a single learning with code files
   */
  async correlateLearning(
    learning: LearningRecord,
    codeFiles?: CodeFileRecord[]
  ): Promise<CorrelationMatch[]> {
    if (!learning.id) return [];

    // Get code files to consider
    const files = codeFiles || listCodeFiles({
      limit: this.config.maxFilesPerLearning || 10,
    });

    if (files.length === 0) return [];

    // Try LLM correlation
    if (this.llm && this.config.enableLLM) {
      try {
        return await this.correlateWithLLM(learning, files);
      } catch (error) {
        console.warn('LLM correlation failed, falling back to heuristics:', error);
      }
    }

    return this.correlateWithHeuristics(learning, files);
  }

  /**
   * Correlate all learnings with all code files
   */
  async correlateAll(options: {
    learnings?: LearningRecord[];
    codeFiles?: CodeFileRecord[];
    onProgress?: (current: number, total: number) => void;
  } = {}): Promise<CorrelationResult> {
    const learnings = options.learnings || listLearnings({
      limit: this.config.maxLearnings || 50,
    });

    const codeFiles = options.codeFiles || listCodeFiles({
      limit: 100,
    });

    const allMatches: CorrelationMatch[] = [];
    let linksCreated = 0;

    for (let i = 0; i < learnings.length; i++) {
      const learning = learnings[i]!;
      const matches = await this.correlateLearning(learning, codeFiles);

      for (const match of matches) {
        if (match.relevanceScore >= (this.config.minRelevanceScore || 0.5)) {
          allMatches.push(match);

          // Persist if enabled
          if (this.config.persistLinks && learning.id) {
            linkLearningToCode({
              learning_id: learning.id,
              code_file_id: match.codeFile.id!,
              link_type: match.linkType,
              relevance_score: match.relevanceScore,
            });
            linksCreated++;
          }
        }
      }

      if (options.onProgress) {
        options.onProgress(i + 1, learnings.length);
      }
    }

    return {
      matches: allMatches,
      stats: {
        learningsAnalyzed: learnings.length,
        filesAnalyzed: codeFiles.length,
        linksCreated,
        usedLLM: this.llm !== null && this.config.enableLLM,
      },
    };
  }

  /**
   * LLM-based correlation using Gemini
   */
  private async correlateWithLLM(
    learning: LearningRecord,
    codeFiles: CodeFileRecord[]
  ): Promise<CorrelationMatch[]> {
    // Format files for prompt
    const fileList = codeFiles.map(f => {
      const patterns = f.patterns ? JSON.parse(f.patterns).slice(0, 3).join(', ') : '';
      return `- ${f.id}: ${f.path} (${f.language}) ${patterns ? `[${patterns}]` : ''}`;
    }).join('\n');

    const prompt = CORRELATION_PROMPT
      .replace('{{title}}', learning.title)
      .replace('{{description}}', learning.description || '')
      .replace('{{category}}', learning.category || '')
      + fileList;

    const response = await this.llm!.complete(prompt, {
      model: this.config.model,
      maxOutputTokens: 2048,
    });

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const fileMap = new Map(codeFiles.map(f => [f.id, f]));

    return (parsed.matches || [])
      .map((m: any) => {
        const codeFile = fileMap.get(m.file_id);
        if (!codeFile) return null;

        return {
          learning,
          codeFile,
          linkType: this.validateLinkType(m.link_type),
          relevanceScore: Math.max(0, Math.min(1, Number(m.relevance) || 0.5)),
          reasoning: String(m.reasoning || ''),
        };
      })
      .filter((m: CorrelationMatch | null): m is CorrelationMatch => m !== null);
  }

  /**
   * Heuristic-based correlation (fallback)
   */
  private correlateWithHeuristics(
    learning: LearningRecord,
    codeFiles: CodeFileRecord[]
  ): CorrelationMatch[] {
    const matches: CorrelationMatch[] = [];

    // Extract keywords from learning
    const learningText = `${learning.title} ${learning.description || ''}`.toLowerCase();
    const keywords = learningText
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);

    for (const file of codeFiles) {
      // Check file path and patterns for keyword matches
      const fileText = `${file.path} ${file.patterns || ''}`.toLowerCase();

      let matchCount = 0;
      const matchedKeywords: string[] = [];

      for (const keyword of keywords) {
        if (fileText.includes(keyword)) {
          matchCount++;
          matchedKeywords.push(keyword);
        }
      }

      if (matchCount >= 2) {
        const relevance = Math.min(1, matchCount / 5);

        matches.push({
          learning,
          codeFile: file,
          linkType: this.inferLinkType(learning, file),
          relevanceScore: relevance,
          reasoning: `Heuristic: matched keywords [${matchedKeywords.slice(0, 3).join(', ')}]`,
        });
      }
    }

    return matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Infer link type from learning and file
   */
  private inferLinkType(
    learning: LearningRecord,
    file: CodeFileRecord
  ): LearningCodeLinkRecord['link_type'] {
    const category = learning.category?.toLowerCase() || '';
    const path = file.path?.toLowerCase() || '';

    // Pattern-based inference
    if (path.includes('test') || path.includes('spec')) {
      return 'example_in';
    }

    if (category.includes('pattern') || category.includes('architecture')) {
      return 'pattern_match';
    }

    if (category.includes('debugging') || category.includes('insight')) {
      return 'derived_from';
    }

    return 'applies_to';
  }

  private validateLinkType(type: any): LearningCodeLinkRecord['link_type'] {
    const valid: LearningCodeLinkRecord['link_type'][] = [
      'derived_from', 'applies_to', 'example_in', 'pattern_match',
    ];
    return valid.includes(type) ? type : 'applies_to';
  }
}

// ============ Convenience Functions ============

let defaultCorrelator: CodeCorrelator | null = null;

export function getCodeCorrelator(config?: Partial<CodeCorrelationConfig>): CodeCorrelator {
  if (!defaultCorrelator || config) {
    defaultCorrelator = new CodeCorrelator(config);
  }
  return defaultCorrelator;
}

/**
 * Correlate all learnings with code files
 */
export async function correlateAllLearnings(
  config?: Partial<CodeCorrelationConfig>,
  onProgress?: (current: number, total: number) => void
): Promise<CorrelationResult> {
  const correlator = getCodeCorrelator(config);
  return correlator.correlateAll({ onProgress });
}

/**
 * Get correlation summary statistics
 */
export function getCorrelationSummary(): {
  totalLinks: number;
  learningsWithLinks: number;
  filesWithLinks: number;
  byType: Record<string, number>;
} {
  return getCodeLinkStats();
}

/**
 * Find learnings relevant to a code file
 */
export function findLearningsForCode(
  filePath: string,
  options?: { minRelevance?: number; limit?: number }
): Array<LearningRecord & { link_type: string; relevance_score: number }> {
  return getLearningsForFile(filePath, options);
}

/**
 * Find code files relevant to a learning
 */
export function findCodeForLearning(
  learningId: number,
  options?: { limit?: number }
): Array<CodeFileRecord & { link_type: string; relevance_score: number }> {
  return getFilesForLearning(learningId, options);
}
