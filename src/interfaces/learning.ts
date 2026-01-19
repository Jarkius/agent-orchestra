/**
 * Learning Loop Interface
 * Expert-level knowledge harvesting with dual-collection pattern
 */

import type { Mission, MissionResult, ErrorContext } from './mission';

export type LearningCategory =
  | 'performance' | 'architecture' | 'tooling' | 'debugging' | 'security' | 'testing' | 'process'
  | 'philosophy' | 'principle' | 'insight' | 'pattern' | 'retrospective';

export type Confidence = 'low' | 'medium' | 'high' | 'proven';

export interface Learning {
  id: number;
  category: LearningCategory;
  title: string;
  description?: string;
  context?: string;
  what_happened?: string;
  lesson?: string;
  prevention?: string;
  sourceUrl?: string;  // External reference URL(s)
  confidence: Confidence;
  timesValidated: number;
  agentId?: number | null;
  sourceSessionId?: string;
  sourceMissionId?: string;
  createdAt: Date;
}

// Dual-collection pattern from PSI Engine
export interface KnowledgeEntry {
  id: string;
  content: string;
  missionId: string;
  category: string;
  embedding?: number[];
  timestamp: Date;
}

export interface LessonEntry {
  id: string;
  problem: string;      // What went wrong
  solution: string;     // How we fixed it
  outcome: string;      // Result of the fix
  category: LearningCategory;
  embedding?: number[];
  confidence: number;
  frequency: number;    // How often this pattern occurs
}

export interface FailureAnalysis {
  rootCause: string;
  category: 'logic' | 'resource' | 'timeout' | 'external' | 'dependency' | 'unknown';
  suggestion: string;
  preventionLearning?: Learning;
  similarFailures?: string[];
}

export interface Pattern {
  type: 'success' | 'failure' | 'performance';
  description: string;
  frequency: number;
  affectedMissions: string[];
  suggestedAction?: string;
  confidence: number;
}

export interface AgentRecommendation {
  agentId: number;
  reason: string;
  confidence: number;
  alternatives?: number[];
}

export interface CompletedMission extends Mission {
  status: 'completed';
  result: MissionResult;
  completedAt: Date;
}

export interface FailedMission extends Mission {
  status: 'failed';
  error: ErrorContext;
}

export interface ILearningLoop {
  // Harvest
  harvestFromMission(mission: CompletedMission): Promise<Learning[]>;
  harvestFromSession(sessionId: string): Promise<Learning[]>;
  analyzeFailure(mission: FailedMission): Promise<FailureAnalysis>;

  // Pattern Recognition
  detectPatterns(recentMissions: Mission[], windowSize?: number): Promise<Pattern[]>;
  clusterSimilarFailures(failures: FailedMission[]): Map<string, FailedMission[]>;

  // Dual Collections
  addKnowledge(entry: Omit<KnowledgeEntry, 'id' | 'timestamp'>): Promise<string>;
  addLesson(entry: Omit<LessonEntry, 'id'>): Promise<string>;
  searchKnowledge(query: string, limit?: number): Promise<KnowledgeEntry[]>;
  searchLessons(query: string, limit?: number): Promise<LessonEntry[]>;

  // Confidence Management
  boostConfidence(learningId: number, reason: string): void;
  decayStale(olderThanDays: number): void;
  validateLearning(learningId: number): void;

  // Recommendations
  recommendAgent(task: { prompt: string; type?: string }): Promise<AgentRecommendation>;
  suggestLearnings(task: { prompt: string }): Promise<Learning[]>;
  getRelevantLessons(problem: string): Promise<LessonEntry[]>;
}
