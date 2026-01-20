/**
 * Context Router - Task-aware retrieval for smart memory access
 * Routes queries to appropriate collections with category boosting based on task type
 */

import {
  searchLearnings,
  searchKnowledgeVector,
  searchLessonsVector,
  isInitialized,
  initVectorDB,
} from '../vector-db';
import { getLearningById, getKnowledgeById, getLessonById } from '../db';
import type { LearningCategory } from '../interfaces/learning';

// Task types for context-aware routing
export type TaskType = 'debugging' | 'architecture' | 'implementation' | 'research' | 'general';

export interface TaskContext {
  type: TaskType;
  keywords: string[];
  preferredCategories: LearningCategory[];
  confidence: number;
}

export interface RetrievalStrategy {
  collections: ('knowledge' | 'lessons' | 'learnings')[];
  sortBy: 'relevance' | 'recency' | 'confidence' | 'validation';
  categoryBoost: Partial<Record<LearningCategory, number>>;
  limit: number;
}

export interface SearchResult {
  id: string;
  type: 'knowledge' | 'lesson' | 'learning';
  content: string;
  title?: string;
  category?: string;
  confidence?: string | number;
  relevanceScore: number;
  boostedScore: number;
}

// Task type detection patterns
const TASK_PATTERNS: Record<TaskType, { keywords: string[]; patterns: RegExp[] }> = {
  debugging: {
    keywords: [
      'error', 'fix', 'bug', 'fail', 'crash', 'broken', 'not working',
      'issue', 'problem', 'exception', 'debug', 'trace', 'stack',
    ],
    patterns: [
      /fix\s+(the|this|a)/i,
      /why\s+(is|does|did)\s+.+\s+(fail|error|crash)/i,
      /not\s+working/i,
      /how\s+to\s+(fix|debug|solve)/i,
    ],
  },
  architecture: {
    keywords: [
      'design', 'structure', 'pattern', 'organize', 'system', 'architecture',
      'component', 'module', 'layer', 'interface', 'abstraction', 'refactor',
    ],
    patterns: [
      /how\s+(should|to)\s+(design|structure|organize)/i,
      /what\s+(pattern|architecture)/i,
      /best\s+(practice|approach)\s+for/i,
    ],
  },
  implementation: {
    keywords: [
      'implement', 'add', 'create', 'build', 'make', 'write', 'code',
      'function', 'class', 'method', 'feature', 'functionality',
    ],
    patterns: [
      /how\s+to\s+(implement|add|create|build)/i,
      /write\s+(a|the)\s+/i,
      /add\s+(a|the|new)\s+/i,
    ],
  },
  research: {
    keywords: [
      'what', 'why', 'how does', 'explain', 'understand', 'learn',
      'documentation', 'concept', 'theory', 'meaning', 'purpose',
    ],
    patterns: [
      /what\s+(is|are|does)/i,
      /why\s+(is|are|does|do)/i,
      /how\s+does\s+.+\s+work/i,
      /explain\s+(the|how|why)/i,
    ],
  },
  general: {
    keywords: [],
    patterns: [],
  },
};

// Category preferences by task type
const CATEGORY_PREFERENCES: Record<TaskType, LearningCategory[]> = {
  debugging: ['debugging', 'tooling', 'pattern', 'process'],
  architecture: ['architecture', 'pattern', 'principle', 'philosophy'],
  implementation: ['tooling', 'pattern', 'process', 'architecture'],
  research: ['insight', 'philosophy', 'principle', 'architecture'],
  general: ['insight', 'pattern', 'architecture', 'tooling'],
};

// Default boost values
const DEFAULT_BOOST = 1.0;
const PREFERRED_BOOST = 1.5;
const HIGHLY_PREFERRED_BOOST = 2.0;

/**
 * Detect the task type from a query string
 */
export function detectTaskType(query: string): TaskContext {
  const queryLower = query.toLowerCase();
  const scores: Record<TaskType, number> = {
    debugging: 0,
    architecture: 0,
    implementation: 0,
    research: 0,
    general: 0,
  };

  const matchedKeywords: string[] = [];

  // Score each task type
  for (const [taskType, { keywords, patterns }] of Object.entries(TASK_PATTERNS) as [
    TaskType,
    { keywords: string[]; patterns: RegExp[] }
  ][]) {
    // Keyword matching
    for (const keyword of keywords) {
      if (queryLower.includes(keyword)) {
        scores[taskType] += 1;
        matchedKeywords.push(keyword);
      }
    }

    // Pattern matching (higher weight)
    for (const pattern of patterns) {
      if (pattern.test(query)) {
        scores[taskType] += 3;
      }
    }
  }

  // Find the best match
  let bestType: TaskType = 'general';
  let bestScore = 0;

  for (const [taskType, score] of Object.entries(scores) as [TaskType, number][]) {
    if (score > bestScore) {
      bestScore = score;
      bestType = taskType;
    }
  }

  // Calculate confidence
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0 ? bestScore / totalScore : 0.2;

  return {
    type: bestType,
    keywords: matchedKeywords,
    preferredCategories: CATEGORY_PREFERENCES[bestType],
    confidence,
  };
}

/**
 * Get the retrieval strategy for a task type
 */
export function getRetrievalStrategy(taskType: TaskType): RetrievalStrategy {
  const preferredCategories = CATEGORY_PREFERENCES[taskType];
  const categoryBoost: Partial<Record<LearningCategory, number>> = {};

  // Set boost values
  const allCategories: LearningCategory[] = [
    'performance', 'architecture', 'tooling', 'debugging', 'security',
    'testing', 'process', 'philosophy', 'principle', 'insight', 'pattern', 'retrospective',
  ];

  for (const cat of allCategories) {
    if (preferredCategories[0] === cat) {
      categoryBoost[cat] = HIGHLY_PREFERRED_BOOST;
    } else if (preferredCategories.includes(cat)) {
      categoryBoost[cat] = PREFERRED_BOOST;
    } else {
      categoryBoost[cat] = DEFAULT_BOOST;
    }
  }

  // Determine collections and sort order based on task type
  let collections: RetrievalStrategy['collections'];
  let sortBy: RetrievalStrategy['sortBy'];

  switch (taskType) {
    case 'debugging':
      collections = ['lessons', 'learnings', 'knowledge'];
      sortBy = 'recency'; // Recent errors are more relevant
      break;
    case 'architecture':
      collections = ['learnings', 'knowledge', 'lessons'];
      sortBy = 'confidence'; // High-confidence architectural decisions
      break;
    case 'implementation':
      collections = ['lessons', 'knowledge', 'learnings'];
      sortBy = 'relevance'; // Most relevant patterns
      break;
    case 'research':
      collections = ['knowledge', 'learnings', 'lessons'];
      sortBy = 'relevance'; // Broad factual search
      break;
    default:
      collections = ['learnings', 'lessons', 'knowledge'];
      sortBy = 'relevance';
  }

  return {
    collections,
    sortBy,
    categoryBoost,
    limit: 10,
  };
}

/**
 * Execute smart retrieval with task-aware routing
 */
export async function executeSmartRetrieval(
  query: string,
  options?: {
    limit?: number;
    taskType?: TaskType; // Override auto-detection
    collections?: ('knowledge' | 'lessons' | 'learnings')[];
  }
): Promise<SearchResult[]> {
  if (!isInitialized()) await initVectorDB();

  // Detect or use provided task type
  const taskContext = options?.taskType
    ? { type: options.taskType, ...detectTaskType(query) }
    : detectTaskType(query);

  const strategy = getRetrievalStrategy(taskContext.type);
  const limit = options?.limit || strategy.limit;
  const collections = options?.collections || strategy.collections;

  const results: SearchResult[] = [];

  // Search each collection
  for (const collection of collections) {
    const collectionLimit = Math.ceil(limit / collections.length) + 2; // Extra for filtering

    try {
      switch (collection) {
        case 'learnings': {
          const learningResults = await searchLearnings(query, { limit: collectionLimit });
          if (learningResults.ids[0]) {
            for (let i = 0; i < learningResults.ids[0].length; i++) {
              const id = learningResults.ids[0][i];
              const numId = parseInt(id.replace('learning_', ''));
              const learning = getLearningById(numId);
              if (learning) {
                const distance = learningResults.distances?.[0]?.[i] ?? 0.5;
                const relevanceScore = 1 - distance;
                const categoryBoostValue = strategy.categoryBoost[learning.category as LearningCategory] || 1;

                results.push({
                  id,
                  type: 'learning',
                  content: learning.description || learning.lesson || learning.title,
                  title: learning.title,
                  category: learning.category,
                  confidence: learning.confidence,
                  relevanceScore,
                  boostedScore: relevanceScore * categoryBoostValue,
                });
              }
            }
          }
          break;
        }

        case 'knowledge': {
          const knowledgeResults = await searchKnowledgeVector(query, { limit: collectionLimit });
          if (knowledgeResults.ids[0]) {
            for (let i = 0; i < knowledgeResults.ids[0].length; i++) {
              const id = knowledgeResults.ids[0][i];
              const numId = parseInt(id.replace('knowledge_', ''));
              const knowledge = getKnowledgeById(numId);
              if (knowledge) {
                const distance = knowledgeResults.distances?.[0]?.[i] ?? 0.5;
                const relevanceScore = 1 - distance;
                const categoryBoostValue = strategy.categoryBoost[knowledge.category as LearningCategory] || 1;

                results.push({
                  id,
                  type: 'knowledge',
                  content: knowledge.content,
                  category: knowledge.category || undefined,
                  relevanceScore,
                  boostedScore: relevanceScore * categoryBoostValue,
                });
              }
            }
          }
          break;
        }

        case 'lessons': {
          const lessonResults = await searchLessonsVector(query, { limit: collectionLimit });
          if (lessonResults.ids[0]) {
            for (let i = 0; i < lessonResults.ids[0].length; i++) {
              const id = lessonResults.ids[0][i];
              const numId = parseInt(id.replace('lesson_', ''));
              const lesson = getLessonById(numId);
              if (lesson) {
                const distance = lessonResults.distances?.[0]?.[i] ?? 0.5;
                const relevanceScore = 1 - distance;
                const categoryBoostValue = strategy.categoryBoost[lesson.category as LearningCategory] || 1;

                results.push({
                  id,
                  type: 'lesson',
                  content: `Problem: ${lesson.problem}\nSolution: ${lesson.solution}\nOutcome: ${lesson.outcome}`,
                  title: lesson.problem,
                  category: lesson.category || undefined,
                  confidence: lesson.confidence,
                  relevanceScore,
                  boostedScore: relevanceScore * categoryBoostValue,
                });
              }
            }
          }
          break;
        }
      }
    } catch (error) {
      console.error(`Error searching ${collection}:`, error);
    }
  }

  // Sort by boosted score
  results.sort((a, b) => b.boostedScore - a.boostedScore);

  // Return limited results
  return results.slice(0, limit);
}

/**
 * Get retrieval context for debugging/logging
 */
export function getRetrievalContext(query: string): {
  taskContext: TaskContext;
  strategy: RetrievalStrategy;
} {
  const taskContext = detectTaskType(query);
  const strategy = getRetrievalStrategy(taskContext.type);
  return { taskContext, strategy };
}

export default {
  detectTaskType,
  getRetrievalStrategy,
  executeSmartRetrieval,
  getRetrievalContext,
};
