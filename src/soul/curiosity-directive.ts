/**
 * Curiosity Directive - Structured Learning Protocol
 *
 * Agents ask questions to learn. But curiosity has a cost.
 * This module provides structured curiosity with token budgets.
 *
 * Rule: One deep question > five shallow.
 */

/**
 * The Curiosity Protocol - injected into every agent
 * ~100 tokens of structured learning guidance
 */
export const CURIOSITY_DIRECTIVE = `
## Curiosity Protocol

1. **Before implementing**: "What pattern does this reveal?"
2. **After completing**: "What did I learn that applies universally?"
3. **When stuck**: "What would Oracle see that I don't?"

Your curiosity budget: 3 deep questions per task
Your learning goal: 1 universal insight per session
`.trim();

/**
 * Curiosity budget constraints
 * Prevents token burn from unbounded exploration
 */
export interface CuriosityBudget {
  maxTokensPerQuestion: number;
  maxQuestionsPerTask: number;
  prioritizeDepth: boolean;
}

export const DEFAULT_CURIOSITY_BUDGET: CuriosityBudget = {
  maxTokensPerQuestion: 500,  // Keep questions focused
  maxQuestionsPerTask: 3,     // Quality over quantity
  prioritizeDepth: true,      // One deep > five shallow
};

/**
 * Reflection questions for different contexts
 */
export const REFLECTION_QUESTIONS = {
  beforeTask: [
    'What pattern does this reveal?',
    'What similar problem have I solved before?',
    'What could go wrong here?',
  ],
  afterTask: [
    'What did I learn that applies universally?',
    'What would I do differently next time?',
    'What would benefit other agents?',
  ],
  whenStuck: [
    'What would Oracle see that I dont?',
    'Am I solving the right problem?',
    'What assumption am I making?',
  ],
  onError: [
    'What caused this failure?',
    'Is this a pattern or an anomaly?',
    'How can this be prevented?',
  ],
};

/**
 * Get the curiosity directive for agent injection
 */
export function getCuriosityDirective(): string {
  return CURIOSITY_DIRECTIVE;
}

/**
 * Get reflection questions for a specific phase
 */
export function getReflectionQuestions(
  phase: keyof typeof REFLECTION_QUESTIONS
): string[] {
  return REFLECTION_QUESTIONS[phase] ?? REFLECTION_QUESTIONS.afterTask;
}

/**
 * Build a reflection prompt with budget constraints
 */
export function buildReflectionPrompt(
  task: string,
  result: string,
  budget: Partial<CuriosityBudget> = {}
): string {
  const { maxTokensPerQuestion, maxQuestionsPerTask } = {
    ...DEFAULT_CURIOSITY_BUDGET,
    ...budget,
  };

  const questions = REFLECTION_QUESTIONS.afterTask.slice(0, maxQuestionsPerTask);

  return `
## Reflection (Budget: ${maxTokensPerQuestion} tokens)

**Task**: ${task}
**Result**: ${result}

Answer ONE of these questions with a universal insight:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Keep your answer under ${maxTokensPerQuestion} tokens.
Focus on patterns that transcend this specific task.
`.trim();
}

/**
 * Check if a reflection is worth capturing
 * Simple heuristic: must mention patterns, learning, or universal concepts
 */
export function isReflectionValuable(reflection: string): boolean {
  const valuableIndicators = [
    /pattern/i,
    /universal/i,
    /always|never|should|must/i,
    /learned|insight|realize/i,
    /applies to|beyond this/i,
  ];

  return valuableIndicators.some((regex) => regex.test(reflection));
}
