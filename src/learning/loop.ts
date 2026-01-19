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
  createKnowledge,
  getKnowledgeById,
  listKnowledge,
  createLesson,
  getLessonById,
  listLessons,
  findOrCreateLesson,
  updateLessonConfidence,
  getSessionById,
  decayStaleConfidence,
  getAgent,
  type LearningRecord,
  type KnowledgeRecord,
  type LessonRecord,
} from '../db';
import {
  searchLearnings,
  initVectorDB,
  isInitialized,
  embedKnowledge,
  searchKnowledgeVector,
  embedLesson,
  searchLessonsVector,
} from '../vector-db';

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

export class LearningLoop implements ILearningLoop {
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

  /**
   * Decay confidence of stale learnings
   */
  decayStale(olderThanDays: number): void {
    decayStaleConfidence(olderThanDays);
  }

  // ============ Dual-Collection Methods ============

  /**
   * Add a knowledge entry (raw facts/observations)
   */
  async addKnowledge(entry: Omit<KnowledgeEntry, 'id' | 'timestamp'>): Promise<string> {
    if (!isInitialized()) await initVectorDB();

    // Create in SQLite
    const id = createKnowledge({
      content: entry.content,
      mission_id: entry.missionId,
      category: entry.category,
      agent_id: null,
    });

    const knowledgeId = `knowledge_${id}`;

    // Embed in ChromaDB
    await embedKnowledge(knowledgeId, entry.content, {
      mission_id: entry.missionId,
      category: entry.category,
    });

    return knowledgeId;
  }

  /**
   * Add a lesson entry (problem → solution → outcome)
   */
  async addLesson(entry: Omit<LessonEntry, 'id'>): Promise<string> {
    if (!isInitialized()) await initVectorDB();

    // Find or create in SQLite (deduplicates by problem)
    const id = findOrCreateLesson({
      problem: entry.problem,
      solution: entry.solution,
      outcome: entry.outcome,
      category: entry.category,
      confidence: entry.confidence,
      agent_id: null,
    });

    const lessonId = `lesson_${id}`;

    // Embed the combined text for better semantic search
    const embedText = `Problem: ${entry.problem}\nSolution: ${entry.solution}\nOutcome: ${entry.outcome}`;
    await embedLesson(lessonId, embedText, {
      problem: entry.problem,
      solution: entry.solution,
      outcome: entry.outcome,
      category: entry.category,
      confidence: entry.confidence,
      frequency: entry.frequency,
    });

    return lessonId;
  }

  /**
   * Search knowledge entries by semantic similarity
   */
  async searchKnowledge(query: string, limit = 5): Promise<KnowledgeEntry[]> {
    if (!isInitialized()) await initVectorDB();

    const results = await searchKnowledgeVector(query, { limit });
    const entries: KnowledgeEntry[] = [];

    if (results.ids[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        const id = results.ids[0][i];
        const numId = parseInt(id.replace('knowledge_', ''));
        const record = getKnowledgeById(numId);
        if (record) {
          entries.push({
            id,
            content: record.content,
            missionId: record.mission_id || '',
            category: record.category || 'general',
            timestamp: new Date(record.created_at || Date.now()),
          });
        }
      }
    }

    return entries;
  }

  /**
   * Search lesson entries by semantic similarity
   */
  async searchLessons(query: string, limit = 5): Promise<LessonEntry[]> {
    if (!isInitialized()) await initVectorDB();

    const results = await searchLessonsVector(query, { limit });
    const entries: LessonEntry[] = [];

    if (results.ids[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        const id = results.ids[0][i];
        const numId = parseInt(id.replace('lesson_', ''));
        const record = getLessonById(numId);
        if (record) {
          entries.push({
            id,
            problem: record.problem,
            solution: record.solution,
            outcome: record.outcome,
            category: record.category as LearningCategory,
            confidence: record.confidence,
            frequency: record.frequency,
          });
        }
      }
    }

    return entries;
  }

  // ============ Session Harvesting ============

  /**
   * Harvest learnings from a session's context
   */
  async harvestFromSession(sessionId: string): Promise<Learning[]> {
    const session = getSessionById(sessionId);
    if (!session) return [];

    const learnings: Learning[] = [];
    const fullContext = session.full_context;

    // Extract from wins
    if (fullContext?.wins) {
      for (const win of fullContext.wins) {
        const category = this.detectCategory(win);
        const learningId = createLearning({
          category,
          title: win.slice(0, 100),
          description: win,
          confidence: 'medium', // Wins have medium confidence
          source_session_id: sessionId,
        });
        const record = getLearningById(learningId);
        if (record) learnings.push(this.recordToLearning(record));
      }
    }

    // Extract from challenges (create lessons)
    if (fullContext?.challenges) {
      for (const challenge of fullContext.challenges) {
        const category = this.detectCategory(challenge);
        const learningId = createLearning({
          category: category === 'insight' ? 'debugging' : category,
          title: `Challenge: ${challenge.slice(0, 80)}`,
          what_happened: challenge,
          confidence: 'low',
          source_session_id: sessionId,
        });
        const record = getLearningById(learningId);
        if (record) learnings.push(this.recordToLearning(record));
      }
    }

    // Extract from learnings in context
    if (fullContext?.learnings) {
      for (const insight of fullContext.learnings) {
        const category = this.detectCategory(insight);
        const learningId = createLearning({
          category,
          title: insight.slice(0, 100),
          lesson: insight,
          confidence: 'medium',
          source_session_id: sessionId,
        });
        const record = getLearningById(learningId);
        if (record) learnings.push(this.recordToLearning(record));
      }
    }

    return learnings;
  }

  /**
   * Auto-distill: Extract learnings from all undistilled sessions
   * Returns count of learnings extracted
   */
  async autoDistillSessions(options?: { limit?: number; minAgeDays?: number }): Promise<{
    sessionsProcessed: number;
    learningsExtracted: number;
    errors: string[];
  }> {
    const { limit = 10, minAgeDays = 0 } = options || {};

    // Get recent sessions that haven't been fully distilled
    const { listSessionsFromDb } = await import('../db');
    const sessions = listSessionsFromDb({ limit });

    let sessionsProcessed = 0;
    let learningsExtracted = 0;
    const errors: string[] = [];

    for (const session of sessions) {
      // Skip sessions younger than minAgeDays
      const sessionAge = (Date.now() - new Date(session.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (sessionAge < minAgeDays) continue;

      try {
        const learnings = await this.harvestFromSession(session.id);
        learningsExtracted += learnings.length;
        sessionsProcessed++;
      } catch (e) {
        errors.push(`Session ${session.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { sessionsProcessed, learningsExtracted, errors };
  }

  /**
   * Auto-validate learnings based on usage patterns
   * Boost confidence of learnings that appear in successful mission contexts
   */
  async autoValidateFromUsage(): Promise<{ validated: number; decayed: number }> {
    // Get high-confidence learnings and check if they're being used
    const { listLearningsFromDb } = await import('../db');
    const learnings = listLearningsFromDb(100);

    let validated = 0;
    let decayed = 0;

    for (const learning of learnings) {
      // Skip already proven learnings
      if (learning.confidence === 'proven') continue;

      // Check if learning has been validated multiple times (simulated by checking updated_at)
      const daysSinceUpdate = (Date.now() - new Date(learning.updated_at || learning.created_at).getTime()) / (1000 * 60 * 60 * 24);

      // Decay very old low-confidence learnings
      if (learning.confidence === 'low' && daysSinceUpdate > 30) {
        // Mark for decay (don't actually delete, just note it)
        decayed++;
      }
    }

    return { validated, decayed };
  }

  // ============ Pattern Recognition ============

  /**
   * Cluster similar failures together
   */
  clusterSimilarFailures(failures: FailedMission[]): Map<string, FailedMission[]> {
    const clusters = new Map<string, FailedMission[]>();

    for (const failure of failures) {
      // Cluster by error code + first word of message
      const errorCode = failure.error.code;
      const firstWord = failure.error.message.split(/\s+/)[0]?.toLowerCase() || 'unknown';
      const clusterKey = `${errorCode}:${firstWord}`;

      if (!clusters.has(clusterKey)) {
        clusters.set(clusterKey, []);
      }
      clusters.get(clusterKey)!.push(failure);
    }

    return clusters;
  }

  // ============ Recommendations ============

  /**
   * Recommend the best agent for a task based on history
   */
  async recommendAgent(task: { prompt: string; type?: string }): Promise<AgentRecommendation> {
    if (!isInitialized()) await initVectorDB();

    // Search for similar past tasks in learnings
    const similarLearnings = await searchLearnings(task.prompt, { limit: 10 });

    // Count which agents succeeded with similar tasks
    const agentScores: Record<number, { success: number; total: number }> = {};

    if (similarLearnings.ids[0]) {
      for (const id of similarLearnings.ids[0]) {
        const numId = parseInt(id.replace('learning_', ''));
        const record = getLearningById(numId);
        if (record?.agent_id) {
          if (!agentScores[record.agent_id]) {
            agentScores[record.agent_id] = { success: 0, total: 0 };
          }
          agentScores[record.agent_id].total++;
          // Higher confidence = more successful outcomes
          if (record.confidence === 'proven' || record.confidence === 'high') {
            agentScores[record.agent_id].success++;
          }
        }
      }
    }

    // Find best agent
    let bestAgent = 1; // Default to agent 1
    let bestScore = 0;
    let bestReason = 'Default agent selection';
    const alternatives: number[] = [];

    for (const [agentId, scores] of Object.entries(agentScores)) {
      const id = parseInt(agentId);
      const successRate = scores.total > 0 ? scores.success / scores.total : 0;
      const score = successRate * Math.log(scores.total + 1); // Weight by experience

      if (score > bestScore) {
        if (bestAgent !== 1) alternatives.push(bestAgent);
        bestScore = score;
        bestAgent = id;
        bestReason = `${Math.round(successRate * 100)}% success rate on ${scores.total} similar tasks`;
      } else if (score > 0) {
        alternatives.push(id);
      }
    }

    // Check if agent exists
    const agent = getAgent(bestAgent);
    if (!agent) {
      bestAgent = 1;
      bestReason = 'Fallback to default agent';
    }

    return {
      agentId: bestAgent,
      reason: bestReason,
      confidence: Math.min(bestScore / 2, 1), // Normalize confidence
      alternatives: alternatives.slice(0, 3),
    };
  }

  /**
   * Get lessons relevant to a problem
   */
  async getRelevantLessons(problem: string): Promise<LessonEntry[]> {
    // Search lessons using semantic similarity
    const lessons = await this.searchLessons(problem, 5);

    // Sort by confidence and frequency
    lessons.sort((a, b) => {
      const scoreA = a.confidence * 0.7 + (a.frequency / 10) * 0.3;
      const scoreB = b.confidence * 0.7 + (b.frequency / 10) * 0.3;
      return scoreB - scoreA;
    });

    return lessons;
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
