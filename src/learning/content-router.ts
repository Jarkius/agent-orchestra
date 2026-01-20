/**
 * Content Router - Auto-classifies content and routes to appropriate collection
 * Routes to: knowledge (facts), lessons (problem→solution), learnings (insights)
 */

import { createLearning, createKnowledge, createLesson, findOrCreateLesson } from '../db';
import { getLearningLoop } from './loop';
import type { LearningCategory } from '../interfaces/learning';

// Content types for dual-collection routing
export type ContentType = 'knowledge' | 'lesson' | 'learning';

export interface ClassificationResult {
  type: ContentType;
  confidence: number;
  reason: string;
  extractedFields?: {
    problem?: string;
    solution?: string;
    outcome?: string;
  };
}

export interface RouteResult {
  id: string;
  type: ContentType;
  message: string;
}

// Classification patterns
const KNOWLEDGE_PATTERNS = [
  /^.+\s+(is|are|was|were)\s+.+$/i,           // "X is Y" statements
  /^.+\s+(uses?|has|have|contains?)\s+.+$/i,  // "X uses Y" statements
  /^.+\s+(provides?|supports?|enables?)\s+.+$/i,
  /^.+\s+(runs?|executes?|calls?)\s+.+$/i,
  /^the\s+.+$/i,                               // "The X..." definitions
  /^\w+:\s+.+$/i,                              // "Term: definition" format
];

const LESSON_PATTERNS = [
  /when\s+.+[,;]\s*(then\s+)?/i,              // "When X, then Y"
  /if\s+.+[,;]\s*(then\s+)?/i,                // "If X, then Y"
  /to\s+(fix|solve|resolve|handle)\s+/i,      // "To fix X..."
  /(problem|issue|error|bug).*(solution|fix|workaround)/i,
  /(don'?t|never|avoid)\s+.+\s+(instead|use)/i,  // "Don't X, instead Y"
  /^\s*problem\s*:/i,                          // Explicit "Problem:" format
  /(caused by|fixed by|resolved by)/i,
];

const LEARNING_PATTERNS = [
  /(realized|learned|discovered|understood)\s+that/i,
  /(key insight|important lesson|takeaway)/i,
  /(principle|philosophy|approach):/i,
  /(always|never|must|should)\s+.{10,}/i,     // Rules/principles
  /the\s+(key|important|critical)\s+(thing|point|lesson)/i,
  /(wisdom|insight|pattern):/i,
  /^\s*(insight|principle|pattern)\s*:/i,
];

// Keywords for scoring
const KNOWLEDGE_KEYWORDS = [
  'is', 'are', 'uses', 'has', 'contains', 'provides', 'supports',
  'runs', 'executes', 'implements', 'defines', 'represents',
  'located', 'stored', 'found', 'exists', 'includes',
];

const LESSON_KEYWORDS = [
  'when', 'if', 'fix', 'solve', 'resolve', 'handle', 'error',
  'problem', 'issue', 'bug', 'workaround', 'solution', 'avoid',
  'instead', 'caused', 'fixed', 'because', 'due to', 'prevent',
];

const LEARNING_KEYWORDS = [
  'realized', 'learned', 'discovered', 'insight', 'principle',
  'philosophy', 'approach', 'wisdom', 'pattern', 'always',
  'never', 'must', 'should', 'important', 'critical', 'key',
];

/**
 * Classify content to determine the appropriate collection
 */
export function classifyContent(
  content: string,
  context?: { category?: string; title?: string; hasStructuredFields?: boolean }
): ClassificationResult {
  const text = content.toLowerCase();
  const scores = { knowledge: 0, lesson: 0, learning: 0 };

  // Check patterns
  for (const pattern of KNOWLEDGE_PATTERNS) {
    if (pattern.test(content)) scores.knowledge += 2;
  }
  for (const pattern of LESSON_PATTERNS) {
    if (pattern.test(content)) scores.lesson += 2;
  }
  for (const pattern of LEARNING_PATTERNS) {
    if (pattern.test(content)) scores.learning += 2;
  }

  // Check keywords
  for (const kw of KNOWLEDGE_KEYWORDS) {
    if (text.includes(kw)) scores.knowledge += 1;
  }
  for (const kw of LESSON_KEYWORDS) {
    if (text.includes(kw)) scores.lesson += 1;
  }
  for (const kw of LEARNING_KEYWORDS) {
    if (text.includes(kw)) scores.learning += 1;
  }

  // Context-based adjustments
  if (context?.category) {
    const cat = context.category.toLowerCase();
    if (['insight', 'philosophy', 'principle', 'pattern'].includes(cat)) {
      scores.learning += 3;
    } else if (['debugging', 'tooling', 'process'].includes(cat)) {
      scores.lesson += 2;
    } else if (['architecture'].includes(cat)) {
      scores.knowledge += 2;
    }
  }

  // If structured fields provided, likely a learning
  if (context?.hasStructuredFields) {
    scores.learning += 2;
  }

  // Extract problem/solution if lesson-like
  let extractedFields: ClassificationResult['extractedFields'] | undefined;
  if (scores.lesson >= scores.knowledge && scores.lesson >= scores.learning) {
    extractedFields = extractProblemSolution(content);
  }

  // Determine winner
  const maxScore = Math.max(scores.knowledge, scores.lesson, scores.learning);
  const totalScore = scores.knowledge + scores.lesson + scores.learning;
  const confidence = totalScore > 0 ? maxScore / totalScore : 0.33;

  let type: ContentType;
  let reason: string;

  if (scores.learning >= scores.knowledge && scores.learning >= scores.lesson) {
    type = 'learning';
    reason = 'Contains insight/principle patterns or wisdom keywords';
  } else if (scores.lesson >= scores.knowledge) {
    type = 'lesson';
    reason = 'Contains problem→solution pattern or fix-related keywords';
  } else {
    type = 'knowledge';
    reason = 'Contains factual statements or observations';
  }

  return { type, confidence, reason, extractedFields };
}

/**
 * Extract problem/solution/outcome from lesson-like content
 */
function extractProblemSolution(content: string): {
  problem?: string;
  solution?: string;
  outcome?: string;
} {
  const result: { problem?: string; solution?: string; outcome?: string } = {};

  // Try explicit format first
  const problemMatch = content.match(/problem\s*:\s*(.+?)(?=solution|fix|$)/i);
  const solutionMatch = content.match(/solution\s*:\s*(.+?)(?=outcome|result|$)/i);
  const outcomeMatch = content.match(/(outcome|result)\s*:\s*(.+?)$/i);

  if (problemMatch) result.problem = problemMatch[1].trim();
  if (solutionMatch) result.solution = solutionMatch[1].trim();
  if (outcomeMatch) result.outcome = outcomeMatch[2].trim();

  // Try "When X, do Y" pattern
  if (!result.problem || !result.solution) {
    const whenMatch = content.match(/when\s+(.+?)[,;]\s*(?:then\s+)?(.+)/i);
    if (whenMatch) {
      result.problem = result.problem || whenMatch[1].trim();
      result.solution = result.solution || whenMatch[2].trim();
    }
  }

  // Try "To fix X, do Y" pattern
  if (!result.problem || !result.solution) {
    const fixMatch = content.match(/to\s+(fix|solve|resolve)\s+(.+?)[,;]\s*(.+)/i);
    if (fixMatch) {
      result.problem = result.problem || fixMatch[2].trim();
      result.solution = result.solution || fixMatch[3].trim();
    }
  }

  return result;
}

/**
 * Route content to the appropriate collection based on classification
 */
export async function routeContent(
  content: string,
  metadata: {
    category?: LearningCategory;
    title?: string;
    agentId?: number;
    sessionId?: string;
    what_happened?: string;
    lesson?: string;
    prevention?: string;
  }
): Promise<RouteResult> {
  // Check if structured fields suggest it's definitely a learning
  const hasStructuredFields = !!(metadata.what_happened || metadata.lesson || metadata.prevention);

  const classification = classifyContent(content, {
    category: metadata.category,
    title: metadata.title,
    hasStructuredFields,
  });

  // High-confidence classifications or structured fields → use classification
  // Low-confidence → default to learning (safest, can be reclassified later)
  const effectiveType = classification.confidence > 0.4 ? classification.type : 'learning';

  switch (effectiveType) {
    case 'knowledge': {
      const id = createKnowledge({
        content,
        category: metadata.category,
        agent_id: metadata.agentId,
      });

      // Also embed in vector DB via learning loop
      const loop = getLearningLoop();
      await loop.addKnowledge({
        content,
        missionId: metadata.sessionId || '',
        category: metadata.category || 'general',
      });

      return {
        id: `knowledge_${id}`,
        type: 'knowledge',
        message: `Routed to knowledge: ${classification.reason}`,
      };
    }

    case 'lesson': {
      const extracted = classification.extractedFields || {};
      const problem = extracted.problem || metadata.title || content.slice(0, 100);
      const solution = extracted.solution || content;
      const outcome = extracted.outcome || 'Pending verification';

      const id = findOrCreateLesson({
        problem,
        solution,
        outcome,
        category: metadata.category,
        confidence: 0.5,
        agent_id: metadata.agentId,
      });

      return {
        id: `lesson_${id}`,
        type: 'lesson',
        message: `Routed to lesson: ${classification.reason}`,
      };
    }

    case 'learning':
    default: {
      const id = createLearning({
        category: metadata.category || 'insight',
        title: metadata.title || content.slice(0, 100),
        description: content,
        confidence: 'low',
        agent_id: metadata.agentId,
        source_session_id: metadata.sessionId,
        what_happened: metadata.what_happened,
        lesson: metadata.lesson,
        prevention: metadata.prevention,
      });

      return {
        id: `learning_${id}`,
        type: 'learning',
        message: `Routed to learning: ${classification.reason}`,
      };
    }
  }
}

/**
 * Batch classify multiple items (for migration)
 */
export function batchClassify(
  items: Array<{ content: string; category?: string; title?: string }>
): Array<{ item: typeof items[0]; classification: ClassificationResult }> {
  return items.map(item => ({
    item,
    classification: classifyContent(item.content, {
      category: item.category,
      title: item.title,
    }),
  }));
}

export default {
  classifyContent,
  routeContent,
  batchClassify,
  extractProblemSolution,
};
