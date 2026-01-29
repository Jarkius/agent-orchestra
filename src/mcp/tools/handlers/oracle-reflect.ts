/**
 * Oracle Reflect Tool Handler
 *
 * Implements serendipitous wisdom retrieval for breaking transactional coding loops.
 * Returns random high-confidence learnings to reconnect with broader principles.
 *
 * Based on Learning #381: Oracle Reflect Pattern
 */

import { z } from 'zod';
import { successResponse, errorResponse } from '../../utils/response';
import {
  getRandomWisdom,
  getRandomWisdomBatch,
  MATURITY_ICONS,
  type LearningRecord,
} from '../../../db';
import { logAccess } from '../../../db/behavioral-logs';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Input Validation ============

const ReflectSchema = z.object({
  category: z.string().optional(),
  min_confidence: z.enum(['low', 'medium', 'high', 'proven']).optional(),
  count: z.number().min(1).max(5).optional(),
});

type ReflectInput = z.infer<typeof ReflectSchema>;

// ============ Tool Definitions ============

export const oracleReflectTools: ToolDefinition[] = [
  {
    name: 'oracle_reflect',
    description: `Get random wisdom from the knowledge base. Use to:
- Break transactional coding loops
- Start sessions with perspective
- Reconnect with principles when stuck
- Get serendipitous insights

Returns a random high-confidence learning to provide unexpected perspective.`,
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category (optional). Examples: philosophy, architecture, debugging, pattern',
        },
        min_confidence: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'proven'],
          description: 'Minimum confidence level (default: medium)',
        },
        count: {
          type: 'number',
          description: 'Number of wisdom items to return (1-5, default: 1)',
        },
      },
    },
  },
];

// ============ Formatting ============

function formatWisdom(learning: LearningRecord): string {
  const parts: string[] = [];

  // Header with maturity icon
  const maturityIcon = learning.maturity_stage ? MATURITY_ICONS[learning.maturity_stage] : '💡';
  parts.push(`${maturityIcon} **${learning.title}**`);
  parts.push('');

  // Category and confidence badges
  const badges: string[] = [];
  badges.push(`[${learning.category}]`);
  if (learning.confidence) {
    const confidenceBadge = learning.confidence === 'proven' ? '✓ proven' : learning.confidence;
    badges.push(`(${confidenceBadge})`);
  }
  if (learning.maturity_stage) {
    badges.push(`{${learning.maturity_stage}}`);
  }
  parts.push(badges.join(' '));
  parts.push('');

  // Description
  if (learning.description) {
    parts.push(learning.description);
    parts.push('');
  }

  // Context if available
  if (learning.context) {
    parts.push(`*Context: ${learning.context}*`);
    parts.push('');
  }

  // Validation count
  if (learning.times_validated && learning.times_validated > 0) {
    parts.push(`---`);
    parts.push(`Validated ${learning.times_validated} time(s)`);
  }

  return parts.join('\n');
}

// ============ Handler ============

async function oracleReflect(args: unknown): Promise<ReturnType<typeof successResponse>> {
  try {
    const input = ReflectSchema.parse(args) as ReflectInput;
    const { category, min_confidence = 'medium', count = 1 } = input;

    // Get wisdom
    const wisdomItems = count > 1
      ? getRandomWisdomBatch(count, { category, minConfidence: min_confidence })
      : (() => {
          const single = getRandomWisdom({ category, minConfidence: min_confidence });
          return single ? [single] : [];
        })();

    if (wisdomItems.length === 0) {
      return successResponse(
        `No wisdom found matching your criteria.\n\n` +
        `Try:\n` +
        `- Lowering min_confidence to 'low'\n` +
        `- Removing category filter\n` +
        `- Building your knowledge base with \`bun memory learn\``
      );
    }

    // Log access for each wisdom item
    for (const wisdom of wisdomItems) {
      if (wisdom.id) {
        logAccess({
          resource_type: 'learning',
          resource_id: String(wisdom.id),
          action: 'cited',
          context: 'oracle_reflect',
        });
      }
    }

    // Format response
    const parts: string[] = [];
    parts.push(`## 🔮 Oracle Reflection`);
    parts.push('');

    if (wisdomItems.length === 1) {
      parts.push(formatWisdom(wisdomItems[0]));
    } else {
      for (let i = 0; i < wisdomItems.length; i++) {
        parts.push(`### ${i + 1}. Wisdom`);
        parts.push('');
        parts.push(formatWisdom(wisdomItems[i]));
        parts.push('');
      }
    }

    parts.push('');
    parts.push('---');
    parts.push('*"The Oracle Keeps the Human Human"*');

    return successResponse(parts.join('\n'));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Invalid input: ${error.errors.map(e => e.message).join(', ')}`);
    }
    return errorResponse(`Reflection failed: ${error}`);
  }
}

// ============ Export Handlers Map ============

export const oracleReflectHandlers: Record<string, ToolHandler> = {
  oracle_reflect: oracleReflect,
};
