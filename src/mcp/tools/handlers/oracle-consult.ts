/**
 * Oracle Consultation Tool Handlers
 * Enables agents to consult the Oracle for guidance during task execution
 *
 * Features:
 * - Query relevant learnings for current task
 * - Find similar successful task approaches
 * - Get recommended next steps
 * - Escalation recommendations for complex tasks
 */

import { z } from 'zod';
import { successResponse, errorResponse } from '../../utils/response';
import {
  getHighConfidenceLearnings,
  searchLearningsFTS,
  logConsultation,
  getActiveDecisions,
  recordDecision,
  type LearningRecord,
  type Decision,
} from '../../../db';
import {
  searchLearnings,
  searchSimilarResults,
  isInitialized,
  initVectorDB,
} from '../../../vector-db';
import { getOracleOrchestrator } from '../../../oracle';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Input Validation ============

const ConsultSchema = z.object({
  agent_id: z.number(),
  task_id: z.string().optional(),
  question: z.string().min(5, 'Question must be at least 5 characters'),
  question_type: z.enum(['approach', 'stuck', 'review', 'escalate']),
  context: z.string().optional(),
});

type ConsultInput = z.infer<typeof ConsultSchema>;

const RecordDecisionSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters'),
  decision: z.string().min(10, 'Decision must be at least 10 characters'),
  rationale: z.string().optional(),
  context: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  related_task_id: z.string().optional(),
  agent_id: z.number().optional(),
});

type RecordDecisionInput = z.infer<typeof RecordDecisionSchema>;

// ============ Tool Definitions ============

export const oracleConsultTools: ToolDefinition[] = [
  {
    name: 'oracle_consult',
    description: 'Consult the Oracle for guidance during task execution. Use when: stuck on a problem, need approach recommendations, want to review progress, or considering escalation.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'number', description: 'Agent ID requesting consultation' },
        task_id: { type: 'string', description: 'Current task ID (optional)' },
        question: { type: 'string', description: 'What guidance do you need?' },
        question_type: {
          type: 'string',
          enum: ['approach', 'stuck', 'review', 'escalate'],
          description: 'Type of consultation: approach (how to start), stuck (blocked on something), review (check progress), escalate (need more capable agent)'
        },
        context: { type: 'string', description: 'What you have tried so far (optional)' },
      },
      required: ['agent_id', 'question', 'question_type'],
    },
  },
  {
    name: 'record_decision',
    description: 'Record an architectural decision for future AI sessions to reference. Use after making significant design choices that other sessions should know about.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the decision (e.g., "Use SQLite FTS5 for search")' },
        decision: { type: 'string', description: 'The decision made - what was chosen and why briefly' },
        rationale: { type: 'string', description: 'Detailed reasoning behind the decision (optional)' },
        context: { type: 'string', description: 'What prompted this decision (optional)' },
        alternatives: {
          type: 'array',
          items: { type: 'string' },
          description: 'Rejected alternatives and why (optional)'
        },
        related_task_id: { type: 'string', description: 'Link to related task ID (optional)' },
        agent_id: { type: 'number', description: 'Agent ID recording the decision (optional)' },
      },
      required: ['title', 'decision'],
    },
  },
];

// ============ Handlers ============

interface ConsultResponse {
  guidance: string;
  suggestedApproach?: string;
  relevantLearnings: Array<{
    title: string;
    description: string;
    confidence: string;
    category: string;
  }>;
  similarSuccesses: Array<{
    task: string;
    outcome: string;
    duration?: string;
  }>;
  existingDecisions: Decision[];
  escalate?: boolean;
  escalateReason?: string;
  suggestRecordDecision?: boolean;
}

async function oracleConsult(args: unknown): Promise<ReturnType<typeof successResponse>> {
  const input = ConsultSchema.parse(args) as ConsultInput;
  const { agent_id, task_id, question, question_type, context } = input;

  const response: ConsultResponse = {
    guidance: '',
    relevantLearnings: [],
    similarSuccesses: [],
    existingDecisions: [],
  };

  // 0. Check for existing relevant decisions first (AI-to-AI coordination)
  const relevantDecisions = getActiveDecisions(question, 3);
  if (relevantDecisions.length > 0) {
    response.existingDecisions = relevantDecisions;
    // Add decision context to guidance
    const mostRecent = relevantDecisions[0]!;
    response.guidance = `**Previous decision found:** "${mostRecent.title}"\n\n`;
    response.guidance += `Decision: ${mostRecent.decision}\n`;
    if (mostRecent.rationale) {
      response.guidance += `Rationale: ${mostRecent.rationale}\n`;
    }
    response.guidance += '\n---\n\n';
  }

  // Ensure vector DB is ready for semantic search
  if (!isInitialized()) {
    try {
      await initVectorDB();
    } catch {
      // Fall back to FTS-only if vector DB not available
    }
  }

  // 1. Get relevant learnings (semantic + FTS hybrid)
  const searchQuery = `${question} ${context || ''}`;

  try {
    // Semantic search for relevant learnings
    const vectorResults = await searchLearnings(searchQuery, 5);
    if (vectorResults.ids?.length) {
      const vectorLearnings = vectorResults.ids.map((id, i) => {
        const meta = vectorResults.metadatas?.[i] || {};
        return {
          title: String(meta.title || 'Untitled'),
          description: String(meta.description || vectorResults.documents?.[i] || ''),
          confidence: String(meta.confidence || 'medium'),
          category: String(meta.category || 'unknown'),
        };
      });
      response.relevantLearnings.push(...vectorLearnings);
    }
  } catch {
    // Vector search failed, use FTS fallback
  }

  // FTS fallback for keyword matching
  if (response.relevantLearnings.length < 3) {
    const ftsResults = searchLearningsFTS(question, 5);
    for (const learning of ftsResults) {
      // Avoid duplicates
      if (!response.relevantLearnings.some(l => l.title === learning.title)) {
        response.relevantLearnings.push({
          title: learning.title,
          description: learning.description || '',
          confidence: learning.confidence,
          category: learning.category,
        });
      }
    }
  }

  // Add high-confidence learnings as baseline
  const highConfidence = getHighConfidenceLearnings(3);
  for (const learning of highConfidence) {
    if (!response.relevantLearnings.some(l => l.title === learning.title)) {
      response.relevantLearnings.push({
        title: learning.title,
        description: learning.description || '',
        confidence: learning.confidence,
        category: learning.category,
      });
    }
  }

  // Limit to top 5 most relevant
  response.relevantLearnings = response.relevantLearnings.slice(0, 5);

  // 2. Find similar successful task results
  try {
    const resultSearch = await searchSimilarResults(searchQuery, 3);
    if (resultSearch.ids?.length) {
      for (let i = 0; i < resultSearch.ids.length; i++) {
        const meta = resultSearch.metadatas?.[i] || {};
        if (meta.status === 'completed') {
          response.similarSuccesses.push({
            task: String(meta.prompt || resultSearch.documents?.[i] || 'Unknown task'),
            outcome: String(meta.output || 'Completed successfully'),
            duration: meta.duration_ms ? `${Math.round(Number(meta.duration_ms) / 1000)}s` : undefined,
          });
        }
      }
    }
  } catch {
    // Vector search not available
  }

  // 3. Get Oracle for complexity analysis and escalation recommendation
  const oracle = getOracleOrchestrator();
  const complexity = oracle.analyzeTaskComplexity(question, context);

  // 4. Generate guidance based on question type
  switch (question_type) {
    case 'approach':
      response.guidance += generateApproachGuidance(question, complexity, response.relevantLearnings);
      response.suggestedApproach = generateSuggestedApproach(question, complexity, response.relevantLearnings);
      // Suggest recording decision if no relevant decisions exist
      if (response.existingDecisions.length === 0) {
        response.suggestRecordDecision = true;
      }
      break;

    case 'stuck':
      response.guidance += generateStuckGuidance(question, context, response.relevantLearnings);
      // Check if escalation might help
      if (complexity.tier === 'complex' || (context && context.length > 500)) {
        response.escalate = true;
        response.escalateReason = 'Task appears complex. A more capable agent (opus) might be better suited.';
      }
      break;

    case 'review':
      response.guidance += generateReviewGuidance(question, context, response.relevantLearnings);
      break;

    case 'escalate':
      response.escalate = true;
      response.escalateReason = complexity.reasoning;
      response.guidance += `Escalation requested. Task complexity: ${complexity.tier}. Recommended model: ${complexity.recommendedModel}. Signals: ${complexity.signals.join(', ')}`;
      break;
  }

  // Format response
  const parts: string[] = [];
  parts.push(`## Oracle Guidance for Agent ${agent_id}`);
  parts.push('');
  parts.push(`**Question Type:** ${question_type}`);
  parts.push(`**Question:** ${question}`);
  parts.push('');
  parts.push(`### Guidance`);
  parts.push(response.guidance);

  if (response.suggestedApproach) {
    parts.push('');
    parts.push(`### Suggested Approach`);
    parts.push(response.suggestedApproach);
  }

  if (response.relevantLearnings.length > 0) {
    parts.push('');
    parts.push(`### Relevant Learnings (${response.relevantLearnings.length})`);
    for (const learning of response.relevantLearnings) {
      const badge = learning.confidence === 'proven' ? '✓' : '•';
      parts.push(`${badge} **[${learning.category}]** ${learning.title}`);
      if (learning.description) {
        parts.push(`  ${learning.description.slice(0, 200)}${learning.description.length > 200 ? '...' : ''}`);
      }
    }
  }

  if (response.similarSuccesses.length > 0) {
    parts.push('');
    parts.push(`### Similar Successful Tasks`);
    for (const success of response.similarSuccesses) {
      parts.push(`- ${success.task.slice(0, 100)}${success.task.length > 100 ? '...' : ''}`);
      parts.push(`  Outcome: ${success.outcome.slice(0, 100)}${success.outcome.length > 100 ? '...' : ''}`);
    }
  }

  if (response.existingDecisions.length > 0) {
    parts.push('');
    parts.push(`### 📋 Related Past Decisions (${response.existingDecisions.length})`);
    for (const decision of response.existingDecisions) {
      parts.push(`- **${decision.title}** (${decision.status})`);
      parts.push(`  ${decision.decision.slice(0, 150)}${decision.decision.length > 150 ? '...' : ''}`);
    }
  }

  if (response.escalate) {
    parts.push('');
    parts.push(`### ⚠️ Escalation Recommended`);
    parts.push(response.escalateReason || 'Consider handing off to a more capable agent.');
  }

  if (response.suggestRecordDecision) {
    parts.push('');
    parts.push(`### 💡 Tip: Record Your Decision`);
    parts.push(`Consider using \`record_decision\` tool to save your approach decision for future sessions.`);
  }

  // Log the consultation for analytics and audit trail
  logConsultation({
    agent_id,
    task_id,
    question,
    question_type,
    guidance_given: response.guidance,
    learnings_cited: [], // TODO: Track learning IDs when we have them
    escalated: response.escalate,
  });

  return successResponse(parts.join('\n'));
}

// ============ Guidance Generators ============

function generateApproachGuidance(
  question: string,
  complexity: { tier: string; recommendedModel: string; signals: string[] },
  learnings: ConsultResponse['relevantLearnings']
): string {
  const parts: string[] = [];

  parts.push(`Task complexity: **${complexity.tier}** (recommended: ${complexity.recommendedModel})`);

  if (complexity.signals.length > 0) {
    parts.push(`\nDetected patterns: ${complexity.signals.join(', ')}`);
  }

  // Extract approach hints from learnings
  const approachHints = learnings
    .filter(l => l.category === 'pattern' || l.category === 'architecture' || l.category === 'process')
    .map(l => `- ${l.title}`)
    .slice(0, 3);

  if (approachHints.length > 0) {
    parts.push(`\n**Relevant patterns from knowledge base:**`);
    parts.push(approachHints.join('\n'));
  }

  return parts.join('\n');
}

function generateSuggestedApproach(
  question: string,
  complexity: { tier: string; signals: string[] },
  learnings: ConsultResponse['relevantLearnings']
): string {
  const steps: string[] = [];

  // Analyze question for task type
  const lowerQuestion = question.toLowerCase();

  if (lowerQuestion.includes('implement') || lowerQuestion.includes('add') || lowerQuestion.includes('create')) {
    steps.push('1. Review existing code patterns in the codebase');
    steps.push('2. Check for similar implementations to follow as reference');
    steps.push('3. Write implementation with tests');
    steps.push('4. Verify against acceptance criteria');
  } else if (lowerQuestion.includes('fix') || lowerQuestion.includes('bug') || lowerQuestion.includes('debug')) {
    steps.push('1. Reproduce the issue consistently');
    steps.push('2. Identify root cause (not just symptoms)');
    steps.push('3. Check related code for similar issues');
    steps.push('4. Implement fix with regression test');
  } else if (lowerQuestion.includes('refactor') || lowerQuestion.includes('improve') || lowerQuestion.includes('optimize')) {
    steps.push('1. Understand current behavior and constraints');
    steps.push('2. Ensure test coverage before changes');
    steps.push('3. Make incremental changes with verification');
    steps.push('4. Validate no regressions');
  } else {
    steps.push('1. Clarify requirements and acceptance criteria');
    steps.push('2. Research existing solutions and patterns');
    steps.push('3. Plan implementation approach');
    steps.push('4. Execute and verify');
  }

  // Add complexity-specific advice
  if (complexity.tier === 'complex') {
    steps.push('');
    steps.push('**Note:** This is a complex task. Consider:');
    steps.push('- Breaking into smaller subtasks');
    steps.push('- Requesting checkpoint reviews');
    steps.push('- Consulting Oracle when blocked');
  }

  return steps.join('\n');
}

function generateStuckGuidance(
  question: string,
  context: string | undefined,
  learnings: ConsultResponse['relevantLearnings']
): string {
  const parts: string[] = [];

  parts.push('**Unblocking strategies:**');
  parts.push('');

  // Generic debugging advice
  parts.push('1. **Simplify the problem** - Can you create a minimal reproduction?');
  parts.push('2. **Check assumptions** - Are your inputs/outputs what you expect?');
  parts.push('3. **Review recent changes** - Did something change that could cause this?');
  parts.push('4. **Search for similar issues** - Check learnings and past tasks');

  // Context-specific advice
  if (context) {
    const contextLower = context.toLowerCase();

    if (contextLower.includes('error') || contextLower.includes('exception')) {
      parts.push('');
      parts.push('**Error-specific:**');
      parts.push('- Read the full error stack trace');
      parts.push('- Check if the error message provides clues');
      parts.push('- Search the codebase for similar error handling');
    }

    if (contextLower.includes('test') || contextLower.includes('failing')) {
      parts.push('');
      parts.push('**Test-specific:**');
      parts.push('- Run the test in isolation');
      parts.push('- Check for timing/async issues');
      parts.push('- Verify test setup/teardown');
    }

    if (contextLower.includes('performance') || contextLower.includes('slow')) {
      parts.push('');
      parts.push('**Performance-specific:**');
      parts.push('- Profile to find the actual bottleneck');
      parts.push('- Check for N+1 queries or expensive loops');
      parts.push('- Consider caching or batching');
    }
  }

  // Add relevant debugging learnings
  const debugLearnings = learnings
    .filter(l => l.category === 'debugging' || l.category === 'process')
    .slice(0, 2);

  if (debugLearnings.length > 0) {
    parts.push('');
    parts.push('**From knowledge base:**');
    for (const learning of debugLearnings) {
      parts.push(`- ${learning.title}`);
    }
  }

  return parts.join('\n');
}

function generateReviewGuidance(
  question: string,
  context: string | undefined,
  learnings: ConsultResponse['relevantLearnings']
): string {
  const parts: string[] = [];

  parts.push('**Review checklist:**');
  parts.push('');
  parts.push('- [ ] Does the implementation match the requirements?');
  parts.push('- [ ] Are there any edge cases not handled?');
  parts.push('- [ ] Is error handling comprehensive?');
  parts.push('- [ ] Are tests covering the critical paths?');
  parts.push('- [ ] Is the code maintainable and documented?');

  // Add relevant review learnings
  const reviewLearnings = learnings
    .filter(l => l.category === 'testing' || l.category === 'pattern' || l.category === 'security')
    .slice(0, 2);

  if (reviewLearnings.length > 0) {
    parts.push('');
    parts.push('**Quality patterns to verify:**');
    for (const learning of reviewLearnings) {
      parts.push(`- ${learning.title}`);
    }
  }

  return parts.join('\n');
}

// ============ Record Decision Handler ============

async function handleRecordDecision(args: unknown): Promise<ReturnType<typeof successResponse>> {
  try {
    const input = RecordDecisionSchema.parse(args) as RecordDecisionInput;

    const decisionId = recordDecision({
      title: input.title,
      decision: input.decision,
      rationale: input.rationale,
      context: input.context,
      alternatives: input.alternatives,
      related_task_id: input.related_task_id,
      agent_id: input.agent_id,
    });

    const parts: string[] = [];
    parts.push(`## ✅ Decision Recorded`);
    parts.push('');
    parts.push(`**ID:** ${decisionId}`);
    parts.push(`**Title:** ${input.title}`);
    parts.push('');
    parts.push(`**Decision:** ${input.decision}`);

    if (input.rationale) {
      parts.push('');
      parts.push(`**Rationale:** ${input.rationale}`);
    }

    if (input.alternatives && input.alternatives.length > 0) {
      parts.push('');
      parts.push(`**Rejected alternatives:**`);
      for (const alt of input.alternatives) {
        parts.push(`- ${alt}`);
      }
    }

    parts.push('');
    parts.push('---');
    parts.push('_This decision will be surfaced in future oracle_consult calls for related questions._');

    return successResponse(parts.join('\n'));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Invalid input: ${error.errors.map(e => e.message).join(', ')}`);
    }
    return errorResponse(`Failed to record decision: ${error}`);
  }
}

// ============ Export Handlers Map ============

export const oracleConsultHandlers: Record<string, ToolHandler> = {
  oracle_consult: oracleConsult,
  record_decision: handleRecordDecision,
};
