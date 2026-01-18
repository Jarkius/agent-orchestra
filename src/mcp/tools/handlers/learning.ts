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
  type Visibility,
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

// Categories: 7 technical + 5 wisdom
const TECHNICAL_CATEGORIES = ['performance', 'architecture', 'tooling', 'process', 'debugging', 'security', 'testing'] as const;
const WISDOM_CATEGORIES = ['philosophy', 'principle', 'insight', 'pattern', 'retrospective'] as const;
const ALL_CATEGORIES = [...TECHNICAL_CATEGORIES, ...WISDOM_CATEGORIES] as const;

export function isWisdomCategory(category: string): boolean {
  return (WISDOM_CATEGORIES as readonly string[]).includes(category);
}

const AddLearningSchema = z.object({
  category: z.enum(ALL_CATEGORIES),
  title: z.string().min(1),
  description: z.string().optional(),
  context: z.string().optional(),
  source_session_id: z.string().optional(),
  confidence: z.enum(['low', 'medium', 'high', 'proven']).optional(),
  agent_id: z.number().int().nullable().optional(),
  visibility: z.enum(['private', 'shared', 'public']).optional(),
  // Structured learning fields
  what_happened: z.string().optional(),
  lesson: z.string().optional(),
  prevention: z.string().optional(),
});

const RecallLearningsSchema = z.object({
  query: z.string().min(1),
  category: z.string().optional(),
  limit: z.number().min(1).max(20).default(5),
  agent_id: z.number().int().nullable().optional(),
  include_shared: z.boolean().default(true),
});

const GetLearningSchema = z.object({
  learning_id: z.number().int().positive(),
  agent_id: z.number().int().nullable().optional(),
});

const ListLearningsSchema = z.object({
  category: z.string().optional(),
  confidence: z.enum(['low', 'medium', 'high', 'proven']).optional(),
  limit: z.number().min(1).max(50).default(10),
  agent_id: z.number().int().nullable().optional(),
  include_shared: z.boolean().default(true),
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
    description: "Add learning",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...TECHNICAL_CATEGORIES, ...WISDOM_CATEGORIES] },
        title: { type: "string" },
        description: { type: "string" },
        context: { type: "string" },
        source_session_id: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high", "proven"] },
        agent_id: { type: "number" },
        visibility: { type: "string", enum: ["private", "shared", "public"] },
        what_happened: { type: "string" },
        lesson: { type: "string" },
        prevention: { type: "string" },
      },
      required: ["category", "title"],
    },
  },
  {
    name: "recall_learnings",
    description: "Search learnings",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string" },
        limit: { type: "number" },
        agent_id: { type: "number" },
        include_shared: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_learning",
    description: "Full learning details",
    inputSchema: {
      type: "object",
      properties: {
        learning_id: { type: "number" },
        agent_id: { type: "number" },
      },
      required: ["learning_id"],
    },
  },
  {
    name: "list_learnings",
    description: "List learnings",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high", "proven"] },
        limit: { type: "number" },
        agent_id: { type: "number" },
        include_shared: { type: "boolean" },
      },
    },
  },
  {
    name: "validate_learning",
    description: "Increase confidence",
    inputSchema: {
      type: "object",
      properties: {
        learning_id: { type: "number" },
      },
      required: ["learning_id"],
    },
  },
  {
    name: "link_learnings",
    description: "Link learnings",
    inputSchema: {
      type: "object",
      properties: {
        from_id: { type: "number" },
        to_id: { type: "number" },
        link_type: { type: "string", enum: ["related", "contradicts", "extends", "supersedes"] },
      },
      required: ["from_id", "to_id", "link_type"],
    },
  },
];

// ============ Tool Handlers ============

async function handleAddLearning(args: unknown) {
  await ensureVectorDB();
  const input = AddLearningSchema.parse(args);

  const agentId = input.agent_id ?? null;
  const visibility = input.visibility || (agentId === null ? 'public' : 'private') as Visibility;

  // All learnings start at 'low' by default
  // Use 'medium' only when explicitly confirmed during session save
  const confidence = input.confidence || 'low';

  try {
    // 1. Save to SQLite (source of truth) with structured fields
    const learningId = createLearning({
      category: input.category,
      title: input.title,
      description: input.description,
      context: input.context,
      source_session_id: input.source_session_id,
      confidence,
      agent_id: agentId,
      visibility,
      what_happened: input.what_happened,
      lesson: input.lesson,
      prevention: input.prevention,
    });

    // 2. Save to ChromaDB (search index)
    const searchContent = `${input.title} ${input.lesson || input.description || ''} ${input.what_happened || input.context || ''}`;
    await saveLearningToChroma(learningId, searchContent, {
      category: input.category,
      confidence,
      created_at: new Date().toISOString(),
      agent_id: agentId,
      visibility,
    });

    // 3. Auto-link to similar learnings (with agent scoping)
    const { autoLinked, suggested } = await findSimilarLearnings(searchContent, {
      excludeId: learningId,
      agentId,
      crossAgentLinking: false,
    });

    // Create auto-links in SQLite
    for (const link of autoLinked) {
      createLearningLink(learningId, parseInt(link.id), 'auto_strong', link.similarity);
    }

    return jsonResponse({
      success: true,
      learning_id: learningId,
      category: input.category,
      title: input.title,
      confidence,
      is_wisdom: isWisdomCategory(input.category),
      agent_id: agentId,
      visibility,
      auto_linked: autoLinked,
      suggested_links: suggested.map(s => ({
        id: s.id,
        similarity: Number(s.similarity.toFixed(3)),
        title: s.summary,
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
    const results = await searchLearnings(input.query, {
      limit: input.limit,
      category: input.category,
      agentId: input.agent_id ?? undefined,
      includeShared: input.include_shared,
    });

    const learnings = results.ids[0]?.map((id, i) => {
      const meta = results.metadatas[0]?.[i] as any;
      return {
        learning_id: parseInt(id.replace('learning_', '')),
        title: results.documents[0]?.[i]?.substring(0, 100) + '...',
        category: meta?.category,
        confidence: meta?.confidence,
        agent_id: meta?.agent_id === -1 ? null : meta?.agent_id,
        visibility: meta?.visibility || 'public',
        relevance: results.distances?.[0]?.[i] ? Number((1 - results.distances[0][i]).toFixed(3)) : null,
      };
    }) || [];

    return jsonResponse({
      query: input.query,
      category_filter: input.category || null,
      agent_filter: input.agent_id ?? null,
      include_shared: input.include_shared,
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

    // Check access control if agent_id is specified
    const requestingAgentId = input.agent_id ?? null;
    if (!canAccessLearning(requestingAgentId, learning)) {
      return errorResponse(`Access denied: Learning ${input.learning_id} is not accessible to agent ${requestingAgentId}`);
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
        agent_id: learning.agent_id,
        visibility: learning.visibility,
        created_at: learning.created_at,
        // Structured learning fields
        what_happened: (learning as any).what_happened,
        lesson: (learning as any).lesson,
        prevention: (learning as any).prevention,
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

// Access control helper
function canAccessLearning(agentId: number | null, learning: LearningRecord): boolean {
  // Orchestrator (null) can access everything
  if (agentId === null) return true;
  // Owner can always access
  if (learning.agent_id === agentId) return true;
  // Orchestrator learnings are public by default
  if (learning.agent_id === null) return true;
  // Check visibility
  return learning.visibility === 'shared' || learning.visibility === 'public';
}

async function handleListLearnings(args: unknown) {
  const input = ListLearningsSchema.parse(args);

  try {
    const learnings = listLearningsFromDb({
      category: input.category,
      confidence: input.confidence,
      limit: input.limit,
      agentId: input.agent_id ?? undefined,
      includeShared: input.include_shared,
    });

    return jsonResponse({
      count: learnings.length,
      filters: { category: input.category, confidence: input.confidence, agent_id: input.agent_id ?? null },
      include_shared: input.include_shared,
      learnings: learnings.map(l => ({
        id: l.id,
        category: l.category,
        title: l.title,
        confidence: l.confidence,
        times_validated: l.times_validated,
        agent_id: l.agent_id,
        visibility: l.visibility,
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
