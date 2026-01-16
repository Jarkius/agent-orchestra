/**
 * Embedding Providers Module
 * Supports Transformers.js for semantic search embeddings
 *
 * Available models:
 * - bge-small-en-v1.5 (384 dims, fast, default)
 * - nomic-embed-text-v1 (768 dims)
 * - nomic-embed-text-v1.5 (768 dims, Matryoshka support)
 * - all-minilm-l6-v2 (384 dims)
 *
 * Configure via EMBEDDING_MODEL env var
 */

import type { IEmbeddingFunction } from "chromadb";

export interface EmbeddingConfig {
  model?: string;
  dimensions?: number;
  cacheDir?: string;
  batchSize?: number;
}

// Get config from environment
export function getEmbeddingConfig(): EmbeddingConfig {
  return {
    model: process.env.EMBEDDING_MODEL || "bge-small-en-v1.5",
    dimensions: process.env.EMBEDDING_DIMS ? parseInt(process.env.EMBEDDING_DIMS) : undefined,
    cacheDir: process.env.EMBEDDING_CACHE_DIR,
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || "32"),
  };
}

// Factory function to create the embedding function
export async function createEmbeddingFunction(
  config?: Partial<EmbeddingConfig>
): Promise<IEmbeddingFunction> {
  const finalConfig = { ...getEmbeddingConfig(), ...config };
  const { TransformersEmbeddingFunction } = await import("./transformers-provider");
  return new TransformersEmbeddingFunction(finalConfig);
}

// Export provider for direct use
export { TransformersEmbeddingFunction } from "./transformers-provider";
