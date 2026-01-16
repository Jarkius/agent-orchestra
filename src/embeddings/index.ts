/**
 * Embedding Providers Module
 * Supports multiple embedding backends for semantic search
 *
 * Providers:
 * - fastembed: Local ONNX models via fastembed (bge-small-en-v1.5)
 * - transformers: Transformers.js with EmbeddingGemma or Nomic
 *
 * Configure via EMBEDDING_PROVIDER env var
 */

import type { IEmbeddingFunction } from "chromadb";

export type EmbeddingProvider = "fastembed" | "transformers";

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model?: string;
  dimensions?: number;
  cacheDir?: string;
  batchSize?: number;
}

// Get config from environment
export function getEmbeddingConfig(): EmbeddingConfig {
  const provider = (process.env.EMBEDDING_PROVIDER || "transformers") as EmbeddingProvider;

  return {
    provider,
    model: process.env.EMBEDDING_MODEL,
    dimensions: process.env.EMBEDDING_DIMS ? parseInt(process.env.EMBEDDING_DIMS) : undefined,
    cacheDir: process.env.EMBEDDING_CACHE_DIR,
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || "32"),
  };
}

// Factory function to create the appropriate embedding function
export async function createEmbeddingFunction(
  config?: Partial<EmbeddingConfig>
): Promise<IEmbeddingFunction> {
  const finalConfig = { ...getEmbeddingConfig(), ...config };

  switch (finalConfig.provider) {
    case "transformers":
      const { TransformersEmbeddingFunction } = await import("./transformers-provider");
      return new TransformersEmbeddingFunction(finalConfig);

    case "fastembed":
    default:
      const { FastEmbedFunction } = await import("./fastembed-provider");
      return new FastEmbedFunction(finalConfig);
  }
}

// Export individual providers for direct use
export { FastEmbedFunction } from "./fastembed-provider";
export { TransformersEmbeddingFunction } from "./transformers-provider";
