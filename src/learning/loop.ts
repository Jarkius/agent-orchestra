/**
 * Learning Loop - Knowledge harvesting and recommendation
 * Implements core ILearningLoop methods, integrated with existing memory system
 */

import type {
  ILearningLoop,
  Learning,
  LearningCategory,
  CompletedMission,
  FailedMission,
  FailureAnalysis,
  Pattern,
  KnowledgeEntry,
  LessonEntry,
  AgentRecommendation,
} from '../interfaces/learning';
import type { Mission } from '../interfaces/mission';
import {
  createLearning,
  getLearningById,
  listLearningsFromDb,
  validateLearning as dbValidateLearning,
  type LearningRecord,
} from '../db';
import { searchLearnings, initVectorDB, isInitialized } from '../vector-db';

// Category detection keywords
const CATEGORY_KEYWORDS: Record<LearningCategory, string[]> = {
  performance: ['fast', 'slow', 'optimize', 'cache', 'memory', 'latency', 'throughput'],
  architecture: ['design', 'structure', 'pattern', 'layer', 'module', 'component', 'system'],
  tooling: ['tool', 'cli', 'config', 'setup', 'install', 'dependency', 'build'],
  debugging: ['bug', 'fix', 'error', 'issue', 'debug', 'trace', 'log'],
  security: ['auth', 'secure', 'permission', 'token', 'encrypt', 'credential'],
  testing: ['test', 'spec', 'mock', 'assert', 'coverage', 'unit', 'integration'],
  process: ['workflow', 'pipeline', 'deploy', 'review', 'merge', 'release'],
  philosophy: ['approach', 'principle', 'belief', 'mindset', 'way'],
  principle: ['rule', 'must', 'always', 'never', 'guideline'],
  insight: ['realize', 'discover', 'learn', 'understand', 'aha'],
  pattern: ['recurring', 'common', 'typical', 'usually', 'often'],
  retrospective: ['reflection', 'hindsight', 'looking back', 'lesson'],
};

export class LearningLoop implements Partial<ILearningLoop> {
  /**
   * Extract learnings from a completed mission
   */
  async harvestFromMission(mission: CompletedMission): Promise<Learning[]> {
    const learnings: Learning[] = [];

    if (!mission.result?.output) return learnings;

    // Extract key insights from output
    const output = mission.result.output;
    const insights = this.extractInsights(output);

    for (const insight of insights) {
      const category = this.detectCategory(insight);

      const learningId = createLearning({
        category,
        title: insight.slice(0, 100),
        description: insight,
        confidence: 'low',
        agent_id: mission.assignedTo,
      });

      const learning = getLearningById(learningId);
      if (learning) {
        learnings.push(this.recordToLearning(learning, mission.id));
      }
    }

    return learnings;
  }

  /**
   * Analyze a failed mission for root cause
   */
  async analyzeFailure(mission: FailedMission): Promise<FailureAnalysis> {
    const error = mission.error;

    // Map error code to category
    const categoryMap: Record<string, FailureAnalysis['category']> = {
      timeout: 'timeout',
      crash: 'logic',
      validation: 'logic',
      resource: 'resource',
      auth: 'external',
      rate_limit: 'external',
      unknown: 'unknown',
    };

    const category = categoryMap[error.code] || 'unknown';

    // Generate suggestion based on error type
    const suggestions: Record<FailureAnalysis['category'], string> = {
      timeout: 'Consider increasing timeout or breaking task into smaller chunks',
      logic: 'Review the task prompt for clarity and add more context',
      resource: 'Check system resources and reduce concurrent operations',
      external: 'Verify external service availability and credentials',
      dependency: 'Ensure all dependencies are resolved before this task',
      unknown: 'Review logs for more details',
    };

    // Search for similar failures
    if (!isInitialized()) await initVectorDB();
    const similarResults = await searchLearnings(error.message, { limit: 3 });
    const similarFailures = similarResults.ids[0] || [];

    return {
      rootCause: error.message,
      category,
      suggestion: suggestions[category] || suggestions.unknown,
      similarFailures: similarFailures.map(id => id.replace('learning_', '')),
    };
  }

  /**
   * Detect patterns in recent missions
   */
  async detectPatterns(recentMissions: Mission[], windowSize = 10): Promise<Pattern[]> {
    const patterns: Pattern[] = [];
    const missions = recentMissions.slice(0, windowSize);

    // Count success/failure by type
    const typeStats: Record<string, { success: number; failure: number; missions: string[] }> = {};

    for (const m of missions) {
      const type = m.type || 'general';
      if (!typeStats[type]) {
        typeStats[type] = { success: 0, failure: 0, missions: [] };
      }
      typeStats[type].missions.push(m.id);
      if (m.status === 'completed') typeStats[type].success++;
      if (m.status === 'failed') typeStats[type].failure++;
    }

    // Generate patterns
    for (const [type, stats] of Object.entries(typeStats)) {
      const total = stats.success + stats.failure;
      if (total < 2) continue;

      const successRate = stats.success / total;

      if (successRate < 0.5) {
        patterns.push({
          type: 'failure',
          description: `${type} tasks have ${Math.round((1 - successRate) * 100)}% failure rate`,
          frequency: total,
          affectedMissions: stats.missions,
          suggestedAction: `Review ${type} task prompts and agent assignment`,
          confidence: Math.min(total / 5, 1),
        });
      } else if (successRate > 0.8 && total >= 3) {
        patterns.push({
          type: 'success',
          description: `${type} tasks have ${Math.round(successRate * 100)}% success rate`,
          frequency: total,
          affectedMissions: stats.missions,
          confidence: Math.min(total / 5, 1),
        });
      }
    }

    return patterns;
  }

  /**
   * Suggest relevant learnings for a new task
   */
  async suggestLearnings(task: { prompt: string }): Promise<Learning[]> {
    if (!isInitialized()) await initVectorDB();

    const results = await searchLearnings(task.prompt, { limit: 5 });
    const learnings: Learning[] = [];

    if (results.ids[0]) {
      for (const id of results.ids[0]) {
        const numId = parseInt(id.replace('learning_', ''));
        const record = getLearningById(numId);
        if (record) {
          learnings.push(this.recordToLearning(record));
        }
      }
    }

    // Prioritize proven/high confidence
    learnings.sort((a, b) => {
      const confOrder = { proven: 0, high: 1, medium: 2, low: 3 };
      return confOrder[a.confidence] - confOrder[b.confidence];
    });

    return learnings.slice(0, 3);
  }

  /**
   * Validate a learning (increase confidence)
   */
  validateLearning(learningId: number): void {
    dbValidateLearning(learningId);
  }

  /**
   * Boost confidence with reason
   */
  boostConfidence(learningId: number, _reason: string): void {
    this.validateLearning(learningId);
  }

  // ============ Private Helpers ============

  private extractInsights(output: string): string[] {
    const insights: string[] = [];

    // Look for common insight patterns
    const patterns = [
      /(?:learned|discovered|realized|found that|key insight|important)[:.]?\s*(.+?)(?:\.|$)/gi,
      /(?:best practice|recommendation|tip)[:.]?\s*(.+?)(?:\.|$)/gi,
      /(?:should|must|always|never)\s+(.+?)(?:\.|$)/gi,
    ];

    for (const pattern of patterns) {
      const matches = output.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 20 && match[1].length < 300) {
          insights.push(match[1].trim());
        }
      }
    }

    // Deduplicate
    return [...new Set(insights)].slice(0, 5);
  }

  private detectCategory(text: string): LearningCategory {
    const lower = text.toLowerCase();
    let bestCategory: LearningCategory = 'insight';
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const score = keywords.filter(kw => lower.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category as LearningCategory;
      }
    }

    return bestCategory;
  }

  private recordToLearning(record: LearningRecord, missionId?: string): Learning {
    return {
      id: record.id!,
      category: record.category as LearningCategory,
      title: record.title,
      description: record.description,
      context: record.context,
      what_happened: record.what_happened,
      lesson: record.lesson,
      prevention: record.prevention,
      sourceUrl: record.source_url,
      confidence: (record.confidence || 'low') as Learning['confidence'],
      timesValidated: record.times_validated || 0,
      agentId: record.agent_id,
      sourceSessionId: record.source_session_id,
      sourceMissionId: missionId,
      createdAt: new Date(record.created_at || Date.now()),
    };
  }
}

// Singleton
let instance: LearningLoop | null = null;

export function getLearningLoop(): LearningLoop {
  if (!instance) {
    instance = new LearningLoop();
  }
  return instance;
}

export default LearningLoop;
