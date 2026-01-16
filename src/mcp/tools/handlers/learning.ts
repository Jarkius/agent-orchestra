/**
 * Learning Tool Handlers
 * MCP tools for managing learnings with SQLite + ChromaDB sync
 */

import { jsonResponse, errorResponse } from '../../utils/response';
import {
  createLearning,
  getLearningById,
  listLearningsFromDb,
  validateLearning as validateLearningInDb,
  createLearningLink,
  getLinkedLearnings,
  getLearningsBySession,
  type LearningRecord,
} from '../../../db';
import {
  saveLearning as saveLearningToChroma,
  searchLearnings,
  findSimilarLearnings,
  isInitialized,
  initVectorDB,
} from '../../../vector-db';
import type { ToolDefinition, ToolHandler } from '../../types';
import { z } from 'zod';

// ============ Schemas ============

const AddLearningSchema = z.object({
  category: z.enum(['performance', 'architecture', 'tooling', 'process', 'debugging', 'security', 'testing']),
  title: z.string().min(1),
  description: z.string().optional(),
  context: z.string().optional(),
  source_session_id: z.string().optional(),
  confidence: z.enum(['low', 'medium', 'high', 'proven']).default('medium'),
});

const RecallLearningsSchema = z.object({
  query: z.string().min(1),
  category: z.string().optional(),
  limit: z.number().min(1).max(20).default(5),
});

const GetLearningSchema = z.object({
  learning_id: z.number().int().positive(),
});

const ListLearningsSchema = z.object({
  category: z.string().optional(),
  confidence: z.enum(['low', 'medium', 'high', 'proven']).optional(),
  limit: z.number().min(1).max(50).default(10),
});

const ValidateLearningSchema = z.object({
  learning_id: z.number().int().positive(),
});

const LinkLearningsSchema = z.object({
  from_id: z.number().int().positive(),
  to_id: z.number().int().positive(),
  link_type: z.enum(['related', 'contradicts', 'extends', 'supersedes']),
});

// ============ Ensure DBs ready ============

async function ensureVectorDB() {
  if (!isInitialized()) {
    await initVectorDB();
  }
}

// ============ Tool Definitions ============

export const learningTools: ToolDefinition[] = [
  {
    name: "add_learning",
    description: "Add a new learning with auto-linking to similar learnings",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["performance", "architecture", "tooling", "process", "debugging", "security", "testing"],
          description: "Category of the learning",
        },
        title: { type: "string", description: "Short title for the learning" },
        description: { type: "string", description: "Detailed description" },
        context: { type: "string", description: "When/why this learning applies" },
        source_session_id: { type: "string", description: "Session that discovered this" },
        confidence: {
          type: "string",
          enum: ["low", "medium", "high", "proven"],
          description: "Confidence level (default: medium)",
        },
      },
      required: ["category", "title"],
    },
  },
  {
    name: "recall_learnings",
    description: "Semantic search for relevant learnings",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        category: { type: "string", description: "Filter by category" },
        limit: { type: "number", description: "Max results (default: 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_learning",
    description: "Get full learning details with linked learnings and source session",
    inputSchema: {
      type: "object",
      properties: {
        learning_id: { type: "number", description: "Learning ID" },
      },
      required: ["learning_id"],
    },
  },
  {
    name: "list_learnings",
    description: "List learnings with optional filters",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category" },
        confidence: {
          type: "string",
          enum: ["low", "medium", "high", "proven"],
          description: "Filter by confidence level",
        },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
    },
  },
  {
    name: "validate_learning",
    description: "Validate a learning (increases confidence over time)",
    inputSchema: {
      type: "object",
      properties: {
        learning_id: { type: "number", description: "Learning ID to validate" },
      },
      required: ["learning_id"],
    },
  },
  {
    name: "link_learnings",
    description: "Create a link between two learnings",
    inputSchema: {
      type: "object",
      properties: {
        from_id: { type: "number", description: "Source learning ID" },
        to_id: { type: "number", description: "Target learning ID" },
        link_type: {
          type: "string",
          enum: ["related", "contradicts", "extends", "supersedes"],
          description: "Type of relationship",
        },
      },
      required: ["from_id", "to_id", "link_type"],
    },
  },
];

// ============ Tool Handlers ============

async function handleAddLearning(args: unknown) {
  await ensureVectorDB();
  const input = AddLearningSchema.parse(args);

  try {
    // 1. Save to SQLite (source of truth)
    const learningId = createLearning({
      category: input.category,
      title: input.title,
      description: input.description,
      context: input.context,
      source_session_id: input.source_session_id,
      confidence: input.confidence,
    });

    // 2. Save to ChromaDB (search index)
    const searchContent = `${input.title} ${input.description || ''} ${input.context || ''}`;
    await saveLearningToChroma(learningId, searchContent, {
      category: input.category,
      confidence: input.confidence,
      created_at: new Date().toISOString(),
    });

    // 3. Auto-link to similar learnings
    const { autoLinked, suggested } = await findSimilarLearnings(searchContent, learningId);

    // Create auto-links in SQLite
    for (const link of autoLinked) {
      createLearningLink(learningId, link.id, 'auto_strong', link.similarity);
    }

    return jsonResponse({
      success: true,
      learning_id: learningId,
      category: input.category,
      title: input.title,
      confidence: input.confidence,
      auto_linked: autoLinked,
      suggested_links: suggested.map(s => ({
        id: s.id,
        similarity: Number(s.similarity.toFixed(3)),
        title: s.title,
      })),
    });
  } catch (error) {
    return errorResponse(`Failed to add learning: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleRecallLearnings(args: unknown) {
  await ensureVectorDB();
  const input = RecallLearningsSchema.parse(args);

  try {
    const results = await searchLearnings(input.query, input.limit);

    let learnings = results.ids[0]?.map((id, i) => {
      const meta = results.metadatas[0]?.[i] as any;
      return {
        learning_id: parseInt(id.replace('learning_', '')),
        title: results.documents[0]?.[i]?.substring(0, 100) + '...',
        category: meta?.category,
        confidence: meta?.confidence,
        relevance: results.distances?.[0]?.[i] ? Number((1 - results.distances[0][i]).toFixed(3)) : null,
      };
    }) || [];

    // Filter by category if specified
    if (input.category) {
      learnings = learnings.filter(l => l.category === input.category);
    }

    return jsonResponse({
      query: input.query,
      category_filter: input.category || null,
      count: learnings.length,
      learnings,
      hint: "Use get_learning(learning_id) for full details",
    });
  } catch (error) {
    return errorResponse(`Failed to recall learnings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleGetLearning(args: unknown) {
  const input = GetLearningSchema.parse(args);

  try {
    const learning = getLearningById(input.learning_id);
    if (!learning) {
      return errorResponse(`Learning not found: ${input.learning_id}`);
    }

    // Get linked learnings
    const linkedLearnings = getLinkedLearnings(input.learning_id);

    return jsonResponse({
      learning: {
        id: learning.id,
        category: learning.category,
        title: learning.title,
        description: learning.description,
        context: learning.context,
        source_session_id: learning.source_session_id,
        confidence: learning.confidence,
        times_validated: learning.times_validated,
        last_validated_at: learning.last_validated_at,
        created_at: learning.created_at,
      },
      linked_learnings: linkedLearnings.map(l => ({
        learning_id: l.learning.id,
        title: l.learning.title,
        category: l.learning.category,
        link_type: l.link_type,
        similarity: l.similarity,
      })),
    });
  } catch (error) {
    return errorResponse(`Failed to get learning: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleListLearnings(args: unknown) {
  const input = ListLearningsSchema.parse(args);

  try {
    const learnings = listLearningsFromDb({
      category: input.category,
      confidence: input.confidence,
      limit: input.limit,
    });

    return jsonResponse({
      count: learnings.length,
      filters: { category: input.category, confidence: input.confidence },
      learnings: learnings.map(l => ({
        id: l.id,
        category: l.category,
        title: l.title,
        confidence: l.confidence,
        times_validated: l.times_validated,
        created_at: l.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(`Failed to list learnings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleValidateLearning(args: unknown) {
  const input = ValidateLearningSchema.parse(args);

  try {
    const learning = getLearningById(input.learning_id);
    if (!learning) {
      return errorResponse(`Learning not found: ${input.learning_id}`);
    }

    const previousConfidence = learning.confidence;
    const previousValidations = learning.times_validated;

    const success = validateLearningInDb(input.learning_id);
    if (!success) {
      return errorResponse(`Failed to validate learning: ${input.learning_id}`);
    }

    // Get updated learning
    const updated = getLearningById(input.learning_id);

    return jsonResponse({
      success: true,
      learning_id: input.learning_id,
      title: learning.title,
      previous_confidence: previousConfidence,
      new_confidence: updated?.confidence,
      times_validated: updated?.times_validated,
      confidence_increased: updated?.confidence !== previousConfidence,
      hint: updated?.confidence === 'proven'
        ? "This learning is now PROVEN - highest confidence!"
        : `Validate ${getValidationsNeeded(updated?.confidence || 'medium')} more times to increase confidence`,
    });
  } catch (error) {
    return errorResponse(`Failed to validate learning: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getValidationsNeeded(currentConfidence: string): number {
  switch (currentConfidence) {
    case 'low': return 1;
    case 'medium': return 2;
    case 'high': return 2;
    default: return 0;
  }
}

async function handleLinkLearnings(args: unknown) {
  const input = LinkLearningsSchema.parse(args);

  try {
    // Verify both learnings exist
    const fromLearning = getLearningById(input.from_id);
    const toLearning = getLearningById(input.to_id);

    if (!fromLearning) {
      return errorResponse(`Learning not found: ${input.from_id}`);
    }
    if (!toLearning) {
      return errorResponse(`Learning not found: ${input.to_id}`);
    }

    const success = createLearningLink(input.from_id, input.to_id, input.link_type);

    return jsonResponse({
      success,
      from_id: input.from_id,
      from_title: fromLearning.title,
      to_id: input.to_id,
      to_title: toLearning.title,
      link_type: input.link_type,
    });
  } catch (error) {
    return errorResponse(`Failed to link learnings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============ Export Handlers Map ============

export const learningHandlers: Record<string, ToolHandler> = {
  add_learning: handleAddLearning,
  recall_learnings: handleRecallLearnings,
  get_learning: handleGetLearning,
  list_learnings: handleListLearnings,
  validate_learning: handleValidateLearning,
  link_learnings: handleLinkLearnings,
};
