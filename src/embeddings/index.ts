/**
 * Embedding Providers Module
 * Supports Transformers.js for semantic search embeddings
 *
 * Available models:
 * - nomic-embed-text-v1.5 (768 dims, Matryoshka support, default - best quality)
 * - nomic-embed-text-v1 (768 dims)
 * - bge-small-en-v1.5 (384 dims, fast, use if memory constrained)
 * - all-minilm-l6-v2 (384 dims)
 *
 * Configure via EMBEDDING_MODEL env var
 *
 * Note: Changing models requires reindexing (bun memory reindex)
 */

import type { EmbeddingFunction } from "chromadb";

export interface EmbeddingConfig {
  provider?: string;
  model?: string;
  dimensions?: number;
  cacheDir?: string;
  batchSize?: number;
}

// Default batch size per model (larger models need smaller batches)
const MODEL_BATCH_SIZES: Record<string, number> = {
  'nomic-embed-text-v1.5': 64,
  'nomic-embed-text-v1': 64,
  'bge-small-en-v1.5': 32,
  'all-minilm-l6-v2': 32,
  'default': 32,
};

// Get config from environment
export function getEmbeddingConfig(): EmbeddingConfig {
  const model = process.env.EMBEDDING_MODEL || "nomic-embed-text-v1.5";
  const defaultBatchSize = MODEL_BATCH_SIZES[model] ?? MODEL_BATCH_SIZES['default'];

  return {
    model,
    dimensions: process.env.EMBEDDING_DIMS ? parseInt(process.env.EMBEDDING_DIMS) : undefined,
    cacheDir: process.env.EMBEDDING_CACHE_DIR,
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || String(defaultBatchSize)),
  };
}

// Factory function to create the embedding function
export async function createEmbeddingFunction(
  config?: Partial<EmbeddingConfig>
): Promise<EmbeddingFunction> {
  const finalConfig = { ...getEmbeddingConfig(), ...config };
  const { TransformersEmbeddingFunction } = await import("./transformers-provider");
  return new TransformersEmbeddingFunction(finalConfig);
}

// Export provider for direct use
export { TransformersEmbeddingFunction } from "./transformers-provider";
