/**
 * Entity Extractor - LLM-based entity and relationship extraction
 *
 * Phase 6: Uses Claude Sonnet for intelligent entity extraction and relationship reasoning.
 * Falls back to heuristics when LLM is unavailable.
 */

import type { LearningRecord, EntityRecord, RelationshipType } from '../db';
import {
  getOrCreateEntity,
  linkLearningToEntity,
  addEntityRelationship,
  extractEntities as extractEntitiesHeuristic,
} from '../db';
import { ExternalLLM } from '../services/external-llm';

// ============ Types ============

export interface ExtractedEntity {
  name: string;
  type: 'concept' | 'tool' | 'pattern' | 'file' | 'category';
  confidence: number;
  reasoning?: string;
}

export interface EnhancedRelationship {
  source: string;
  target: string;
  type: RelationshipType;
  strength: number;        // 0-1
  bidirectional: boolean;
  reasoning: string;       // Why connected
}

export interface EntityExtractionResult {
  entities: ExtractedEntity[];
  relationships: EnhancedRelationship[];
  stats: {
    entitiesExtracted: number;
    relationshipsInferred: number;
    usedLLM: boolean;
  };
}

export interface EntityExtractorConfig {
  provider: 'anthropic' | 'gemini' | 'openai';
  model: string;
  enableLLM: boolean;
  maxEntities?: number;
  maxRelationships?: number;
}

const DEFAULT_CONFIG: EntityExtractorConfig = {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  enableLLM: true,
  maxEntities: 20,
  maxRelationships: 30,
};

// ============ Entity Type Patterns ============

const TYPE_PATTERNS: Record<EntityRecord['type'], RegExp[]> = {
  tool: [
    /^(bun|npm|yarn|pnpm|git|docker|kubectl|aws|gcloud)$/i,
    /^[a-z]+-cli$/i,
    /\.(js|ts|py|go|rs)$/i,
  ],
  pattern: [
    /pattern$/i,
    /^(singleton|factory|observer|decorator|adapter|facade|proxy|strategy)$/i,
    /^(mvc|mvvm|rest|graphql|grpc)$/i,
  ],
  file: [
    /\.[a-z]+$/i,
    /^(src|lib|dist|node_modules|package\.json|tsconfig)$/i,
  ],
  category: [
    /^(performance|security|testing|debugging|architecture|tooling|process)$/i,
  ],
  concept: [], // Default fallback
};

// ============ Relationship Inference Patterns ============

const RELATIONSHIP_PATTERNS: Array<{
  pattern: RegExp;
  type: RelationshipType;
  strength: number;
}> = [
  { pattern: /depends on|requires|needs/i, type: 'depends_on', strength: 0.9 },
  { pattern: /enables|allows|makes possible/i, type: 'enables', strength: 0.85 },
  { pattern: /conflicts with|incompatible with/i, type: 'conflicts_with', strength: 0.9 },
  { pattern: /alternative to|instead of|rather than/i, type: 'alternative_to', strength: 0.8 },
  { pattern: /type of|kind of|specializes|is a/i, type: 'specializes', strength: 0.9 },
  { pattern: /generalization of|abstraction of/i, type: 'generalizes', strength: 0.9 },
  { pattern: /before|precedes|comes first/i, type: 'precedes', strength: 0.75 },
  { pattern: /after|follows|comes next/i, type: 'follows', strength: 0.75 },
  { pattern: /complements|works with|pairs with/i, type: 'complements', strength: 0.8 },
];

// ============ LLM Prompt ============

const ENTITY_EXTRACTION_PROMPT = `You are an expert at extracting structured knowledge from technical text.

Given the following learning/insight, extract:
1. Key entities (concepts, tools, patterns, files)
2. Relationships between entities

For each entity, determine:
- name: The entity name (lowercase, normalized)
- type: One of: concept, tool, pattern, file, category
- confidence: 0-1 how confident you are this is a meaningful entity

For each relationship, determine:
- source: Source entity name
- target: Target entity name
- type: One of: depends_on, enables, conflicts_with, alternative_to, specializes, generalizes, precedes, follows, complements
- strength: 0-1 how strong the relationship is
- bidirectional: true if the relationship goes both ways
- reasoning: Brief explanation of why this relationship exists

Respond in JSON format:
{
  "entities": [{ "name": "...", "type": "...", "confidence": 0.9 }],
  "relationships": [{ "source": "...", "target": "...", "type": "...", "strength": 0.8, "bidirectional": false, "reasoning": "..." }]
}

Learning to analyze:
`;

// ============ EntityExtractor Class ============

export class EntityExtractor {
  private config: EntityExtractorConfig;
  private llm: ExternalLLM | null;

  constructor(config: Partial<EntityExtractorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llm = this.config.enableLLM
      ? new ExternalLLM({ provider: this.config.provider, model: this.config.model })
      : null;
  }

  /**
   * Extract entities and relationships from a learning
   */
  async extractFromLearning(learning: LearningRecord): Promise<EntityExtractionResult> {
    const text = `${learning.title}\n${learning.description || ''}`;

    if (this.llm && this.config.enableLLM) {
      try {
        return await this.extractWithLLM(text);
      } catch (error) {
        console.warn('LLM extraction failed, falling back to heuristics:', error);
      }
    }

    return this.extractWithHeuristics(text);
  }

  /**
   * Extract entities and relationships from arbitrary text
   */
  async extractFromText(text: string): Promise<EntityExtractionResult> {
    if (this.llm && this.config.enableLLM) {
      try {
        return await this.extractWithLLM(text);
      } catch (error) {
        console.warn('LLM extraction failed, falling back to heuristics:', error);
      }
    }

    return this.extractWithHeuristics(text);
  }

  /**
   * LLM-based extraction using Claude Sonnet
   */
  private async extractWithLLM(text: string): Promise<EntityExtractionResult> {
    const prompt = ENTITY_EXTRACTION_PROMPT + text;
    const response = await this.llm!.complete(prompt);

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in LLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const entities: ExtractedEntity[] = (parsed.entities || [])
      .slice(0, this.config.maxEntities)
      .map((e: any) => ({
        name: String(e.name || '').toLowerCase().trim(),
        type: this.validateEntityType(e.type),
        confidence: Math.max(0, Math.min(1, Number(e.confidence) || 0.5)),
        reasoning: e.reasoning,
      }))
      .filter((e: ExtractedEntity) => e.name.length > 0);

    const relationships: EnhancedRelationship[] = (parsed.relationships || [])
      .slice(0, this.config.maxRelationships)
      .map((r: any) => ({
        source: String(r.source || '').toLowerCase().trim(),
        target: String(r.target || '').toLowerCase().trim(),
        type: this.validateRelationshipType(r.type),
        strength: Math.max(0, Math.min(1, Number(r.strength) || 0.5)),
        bidirectional: Boolean(r.bidirectional),
        reasoning: String(r.reasoning || 'Inferred by LLM'),
      }))
      .filter((r: EnhancedRelationship) => r.source.length > 0 && r.target.length > 0);

    return {
      entities,
      relationships,
      stats: {
        entitiesExtracted: entities.length,
        relationshipsInferred: relationships.length,
        usedLLM: true,
      },
    };
  }

  /**
   * Heuristic-based extraction (fallback)
   */
  private extractWithHeuristics(text: string): EntityExtractionResult {
    // Use existing heuristic extraction
    const entityNames = extractEntitiesHeuristic(text)
      .slice(0, this.config.maxEntities); // Apply limit

    const entities: ExtractedEntity[] = entityNames.map(name => ({
      name,
      type: this.inferEntityType(name),
      confidence: 0.6, // Lower confidence for heuristic extraction
    }));

    // Infer relationships from text patterns
    const relationships: EnhancedRelationship[] = [];

    for (const pattern of RELATIONSHIP_PATTERNS) {
      const matches = text.match(pattern.pattern);
      if (matches) {
        // Try to find entities around the match
        const words = text.split(/\s+/).map(w => w.toLowerCase().replace(/[^\w-]/g, ''));
        for (let i = 0; i < words.length - 2; i++) {
          const word1 = words[i];
          const word2 = words[i + 2];
          if (
            word1 &&
            word2 &&
            entityNames.includes(word1) &&
            entityNames.includes(word2)
          ) {
            relationships.push({
              source: word1,
              target: word2,
              type: pattern.type,
              strength: pattern.strength,
              bidirectional: false,
              reasoning: `Heuristic: matched pattern "${pattern.pattern.source}"`,
            });
          }
        }
      }
    }

    return {
      entities,
      relationships: relationships.slice(0, this.config.maxRelationships),
      stats: {
        entitiesExtracted: entities.length,
        relationshipsInferred: relationships.length,
        usedLLM: false,
      },
    };
  }

  /**
   * Infer entity type from name
   */
  private inferEntityType(name: string): EntityRecord['type'] {
    for (const [type, patterns] of Object.entries(TYPE_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(name)) {
          return type as EntityRecord['type'];
        }
      }
    }
    return 'concept';
  }

  /**
   * Validate entity type
   */
  private validateEntityType(type: string): EntityRecord['type'] {
    const validTypes: EntityRecord['type'][] = ['concept', 'tool', 'pattern', 'file', 'category'];
    return validTypes.includes(type as any) ? (type as EntityRecord['type']) : 'concept';
  }

  /**
   * Validate relationship type
   */
  private validateRelationshipType(type: string): RelationshipType {
    const validTypes: RelationshipType[] = [
      'depends_on', 'enables', 'conflicts_with', 'alternative_to',
      'specializes', 'generalizes', 'precedes', 'follows', 'complements',
    ];
    return validTypes.includes(type as any) ? (type as RelationshipType) : 'complements';
  }
}

// ============ Convenience Functions ============

let defaultExtractor: EntityExtractor | null = null;

export function getEntityExtractor(config?: Partial<EntityExtractorConfig>): EntityExtractor {
  if (!defaultExtractor || config) {
    defaultExtractor = new EntityExtractor(config);
  }
  return defaultExtractor;
}

/**
 * Extract and persist entities and relationships for a learning
 */
export async function extractAndPersistEntities(
  learningId: number,
  learning: LearningRecord,
  config?: Partial<EntityExtractorConfig>
): Promise<EntityExtractionResult> {
  const extractor = getEntityExtractor(config);
  const result = await extractor.extractFromLearning(learning);

  // Persist entities
  const entityIdMap = new Map<string, number>();
  for (const entity of result.entities) {
    const entityId = getOrCreateEntity(entity.name, entity.type);
    entityIdMap.set(entity.name, entityId);
    linkLearningToEntity(learningId, entityId, entity.confidence);
  }

  // Persist relationships
  for (const rel of result.relationships) {
    const sourceId = entityIdMap.get(rel.source);
    const targetId = entityIdMap.get(rel.target);

    if (sourceId && targetId) {
      addEntityRelationship(sourceId, targetId, rel.type, {
        strength: rel.strength,
        bidirectional: rel.bidirectional,
        reasoning: rel.reasoning,
        sourceLearningId: learningId,
      });
    }
  }

  return result;
}

/**
 * Re-extract entities for all learnings (batch operation)
 */
export async function reextractAllEntities(
  learnings: LearningRecord[],
  config?: Partial<EntityExtractorConfig>,
  onProgress?: (current: number, total: number) => void
): Promise<{
  processed: number;
  totalEntities: number;
  totalRelationships: number;
}> {
  let totalEntities = 0;
  let totalRelationships = 0;

  for (let i = 0; i < learnings.length; i++) {
    const learning = learnings[i]!;
    if (!learning.id) continue;

    const result = await extractAndPersistEntities(learning.id, learning, config);
    totalEntities += result.stats.entitiesExtracted;
    totalRelationships += result.stats.relationshipsInferred;

    if (onProgress) {
      onProgress(i + 1, learnings.length);
    }
  }

  return {
    processed: learnings.length,
    totalEntities,
    totalRelationships,
  };
}
