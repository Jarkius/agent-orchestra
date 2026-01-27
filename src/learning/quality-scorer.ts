/**
 * Learning Quality Scorer
 *
 * Uses Claude Sonnet to score learning quality on multiple dimensions:
 * - Specificity: How specific vs generic
 * - Actionability: Can you act on this?
 * - Evidence: Is there supporting evidence?
 * - Novelty: New insight vs common knowledge
 *
 * Falls back to heuristic scoring when LLM is unavailable.
 */

import { ExternalLLM, type LLMOptions } from '../services/external-llm';
import type { LearningRecord } from '../db';

// ============ Types ============

export interface QualityScore {
  specificity: number;    // 0-1: How specific vs generic
  actionability: number;  // 0-1: Can you act on this?
  evidence: number;       // 0-1: Is there supporting evidence?
  novelty: number;        // 0-1: New insight vs common knowledge
  overall: number;        // Weighted average
  reasoning?: string;     // Why these scores (from LLM)
}

export interface QualityScorerConfig {
  provider: 'anthropic' | 'gemini' | 'openai';
  model?: string;
  enableLLM: boolean;
  weights?: {
    specificity: number;
    actionability: number;
    evidence: number;
    novelty: number;
  };
}

const DEFAULT_CONFIG: QualityScorerConfig = {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  enableLLM: true,
  weights: {
    specificity: 0.25,
    actionability: 0.35,  // Actionability matters most
    evidence: 0.20,
    novelty: 0.20,
  },
};

// ============ Heuristic Patterns ============

// Generic phrases that reduce specificity
const GENERIC_PATTERNS = [
  /always\s+do/i,
  /never\s+do/i,
  /best\s+practice/i,
  /it's\s+important/i,
  /you\s+should/i,
  /make\s+sure/i,
  /keep\s+in\s+mind/i,
  /don't\s+forget/i,
];

// Specific indicators
const SPECIFIC_PATTERNS = [
  /\d+(?:\.\d+)?(?:\s*%|\s*ms|\s*x\s+faster)/i,  // Numbers with units
  /`[^`]+`/,  // Code references
  /\b(?:file|function|method|class|module)\s+\w+/i,  // Named references
  /\b(?:in|at|when|if)\s+\w+\s+\w+/i,  // Contextual conditions
];

// Action indicators
const ACTION_PATTERNS = [
  /\b(?:use|avoid|prefer|run|execute|call|invoke|set|configure)\b/i,
  /\b(?:instead\s+of|rather\s+than|before|after)\b/i,
  /`[^`]+\([^)]*\)`/,  // Function calls in code
];

// Evidence indicators
const EVIDENCE_PATTERNS = [
  /\b(?:because|results?\s+in|leads?\s+to|causes?|prevents?)\b/i,
  /\b(?:measured|tested|verified|confirmed|observed)\b/i,
  /\d+(?:\.\d+)?(?:\s*%|\s*x\s+faster|\s*ms)/i,  // Metrics
];

// ============ Quality Scorer ============

export class QualityScorer {
  private config: QualityScorerConfig;
  private llm: ExternalLLM | null = null;

  constructor(config: Partial<QualityScorerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.enableLLM) {
      try {
        this.llm = new ExternalLLM(this.config.provider);
      } catch (error) {
        console.error(`[QualityScorer] LLM init failed, using heuristics: ${error}`);
        this.llm = null;
      }
    }
  }

  /**
   * Score a learning's quality
   */
  async scoreLearning(learning: LearningRecord): Promise<QualityScore> {
    const text = `${learning.title}\n${learning.description || ''}\n${learning.lesson || ''}`;

    // Try LLM scoring first
    if (this.llm) {
      try {
        return await this.scoreWithLLM(learning, text);
      } catch (error) {
        console.error(`[QualityScorer] LLM scoring failed, using heuristics: ${error}`);
      }
    }

    // Fallback to heuristic scoring
    return this.scoreWithHeuristics(text, learning);
  }

  /**
   * Score using Claude Sonnet
   */
  private async scoreWithLLM(learning: LearningRecord, text: string): Promise<QualityScore> {
    const prompt = `Score this learning on four quality dimensions (0.0 to 1.0):

## Learning
Title: ${learning.title}
Category: ${learning.category}
Content: ${text}
Confidence: ${learning.confidence}
Times Validated: ${learning.times_validated || 0}

## Scoring Criteria

1. **Specificity** (0-1): How specific vs generic?
   - 1.0: Very specific (mentions exact code, files, numbers, conditions)
   - 0.5: Moderately specific (some context, but could be more precise)
   - 0.0: Generic advice that could apply to anything

2. **Actionability** (0-1): Can someone act on this?
   - 1.0: Clear, immediate action possible (use X, avoid Y, configure Z)
   - 0.5: Requires some interpretation to act
   - 0.0: Just information, no clear action

3. **Evidence** (0-1): Is there supporting evidence?
   - 1.0: Has metrics, test results, or verified observations
   - 0.5: Has reasoning/explanation but no hard data
   - 0.0: Just an assertion with no backing

4. **Novelty** (0-1): New insight vs common knowledge?
   - 1.0: Unique insight specific to this codebase/situation
   - 0.5: Useful reminder of known practices
   - 0.0: Extremely common knowledge (e.g., "test your code")

Respond in this exact JSON format:
{
  "specificity": 0.0-1.0,
  "actionability": 0.0-1.0,
  "evidence": 0.0-1.0,
  "novelty": 0.0-1.0,
  "reasoning": "brief explanation of scores"
}`;

    const response = await this.llm!.query(prompt, {
      model: this.config.model,
      maxOutputTokens: 512,
      temperature: 0.3,
    });

    return this.parseScoreResponse(response.text, text, learning);
  }

  /**
   * Parse LLM response into quality score
   */
  private parseScoreResponse(
    response: string,
    text: string,
    learning: LearningRecord
  ): QualityScore {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const weights = this.config.weights!;

      const specificity = this.clampScore(parsed.specificity);
      const actionability = this.clampScore(parsed.actionability);
      const evidence = this.clampScore(parsed.evidence);
      const novelty = this.clampScore(parsed.novelty);

      const overall =
        specificity * weights.specificity +
        actionability * weights.actionability +
        evidence * weights.evidence +
        novelty * weights.novelty;

      return {
        specificity,
        actionability,
        evidence,
        novelty,
        overall: Math.round(overall * 100) / 100,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      console.error(`[QualityScorer] Failed to parse response: ${error}`);
      return this.scoreWithHeuristics(text, learning);
    }
  }

  /**
   * Score using heuristic patterns
   */
  private scoreWithHeuristics(text: string, learning: LearningRecord): QualityScore {
    const weights = this.config.weights!;

    // Specificity: check for specific vs generic patterns
    let specificity = 0.5;
    const genericMatches = GENERIC_PATTERNS.filter(p => p.test(text)).length;
    const specificMatches = SPECIFIC_PATTERNS.filter(p => p.test(text)).length;
    specificity = Math.max(0, Math.min(1, 0.5 + (specificMatches * 0.15) - (genericMatches * 0.1)));

    // Actionability: check for action patterns
    let actionability = 0.3;
    const actionMatches = ACTION_PATTERNS.filter(p => p.test(text)).length;
    actionability = Math.min(1, 0.3 + (actionMatches * 0.2));

    // Evidence: check for evidence patterns
    let evidence = 0.2;
    const evidenceMatches = EVIDENCE_PATTERNS.filter(p => p.test(text)).length;
    evidence = Math.min(1, 0.2 + (evidenceMatches * 0.25));

    // Novelty: hard to detect heuristically, use moderate default
    // Higher confidence = probably more validated = probably more novel
    let novelty = 0.4;
    if (learning.confidence === 'proven') novelty = 0.7;
    else if (learning.confidence === 'high') novelty = 0.6;
    else if (learning.confidence === 'medium') novelty = 0.5;

    const overall =
      specificity * weights.specificity +
      actionability * weights.actionability +
      evidence * weights.evidence +
      novelty * weights.novelty;

    return {
      specificity: Math.round(specificity * 100) / 100,
      actionability: Math.round(actionability * 100) / 100,
      evidence: Math.round(evidence * 100) / 100,
      novelty: Math.round(novelty * 100) / 100,
      overall: Math.round(overall * 100) / 100,
      reasoning: 'Heuristic scoring (LLM unavailable)',
    };
  }

  /**
   * Clamp score to 0-1 range
   */
  private clampScore(value: number): number {
    if (typeof value !== 'number' || isNaN(value)) return 0.5;
    return Math.max(0, Math.min(1, value));
  }

  /**
   * Score multiple learnings in batch
   */
  async scoreBatch(learnings: LearningRecord[]): Promise<Map<number, QualityScore>> {
    const results = new Map<number, QualityScore>();

    for (const learning of learnings) {
      const score = await this.scoreLearning(learning);
      results.set(learning.id!, score);
    }

    return results;
  }

  /**
   * Check if LLM is available
   */
  isLLMAvailable(): boolean {
    return this.llm !== null;
  }
}

// ============ Singleton ============

let scorerInstance: QualityScorer | null = null;

export function getQualityScorer(config?: Partial<QualityScorerConfig>): QualityScorer {
  if (!scorerInstance || config) {
    scorerInstance = new QualityScorer(config);
  }
  return scorerInstance;
}

export default {
  QualityScorer,
  getQualityScorer,
};
