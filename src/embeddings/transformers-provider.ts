/**
 * Transformers.js Provider
 * Embeddings using Hugging Face Transformers.js
 *
 * Supported models:
 * - nomic-embed-text-v1 (768 dims, good quality)
 * - nomic-embed-text-v1.5 (768 dims, Matryoshka support)
 * - bge-small-en-v1.5 (384 dims, fast)
 * - all-MiniLM-L6-v2 (384 dims, classic)
 */

import type { EmbeddingFunction } from "chromadb";
import type { EmbeddingConfig } from "./index";

// Model configurations
const MODEL_CONFIGS: Record<string, { id: string; dimensions: number }> = {
  "nomic-embed-text-v1": {
    id: "nomic-ai/nomic-embed-text-v1",
    dimensions: 768,
  },
  "nomic-embed-text-v1.5": {
    id: "nomic-ai/nomic-embed-text-v1.5",
    dimensions: 768,
  },
  "bge-small-en-v1.5": {
    id: "Xenova/bge-small-en-v1.5",
    dimensions: 384,
  },
  "all-minilm-l6-v2": {
    id: "Xenova/all-MiniLM-L6-v2",
    dimensions: 384,
  },
  // Default
  default: {
    id: "Xenova/bge-small-en-v1.5",
    dimensions: 384,
  },
};

export class TransformersEmbeddingFunction implements EmbeddingFunction {
  private extractor: any = null;
  private initPromise: Promise<void> | null = null;
  private initError: Error | null = null;
  private config: EmbeddingConfig;
  private modelConfig: { id: string; dimensions: number };

  constructor(config?: Partial<EmbeddingConfig>) {
    const modelName = config?.model || "bge-small-en-v1.5";
    this.modelConfig = MODEL_CONFIGS[modelName] ?? MODEL_CONFIGS["default"]!;

    this.config = {
      model: modelName,
      dimensions: config?.dimensions || this.modelConfig.dimensions,
      batchSize: config?.batchSize || 32,
      cacheDir: config?.cacheDir,
    };
  }

  async generate(texts: string[]): Promise<number[][]> {
    await this.ensureInitialized();
    if (texts.length === 0) return [];

    try {
      const allEmbeddings: number[][] = [];

      // Process in batches
      for (let i = 0; i < texts.length; i += this.config.batchSize!) {
        const batch = texts.slice(i, i + this.config.batchSize!);
        const output = await this.extractor(batch, {
          pooling: "mean",
          normalize: true,
        });

        // Extract embeddings from output tensor
        for (let j = 0; j < batch.length; j++) {
          const embedding = output[j].tolist();
          // Apply dimension truncation if configured (Matryoshka)
          if (this.config.dimensions && embedding.length > this.config.dimensions) {
            allEmbeddings.push(this.truncateAndNormalize(embedding, this.config.dimensions));
          } else {
            allEmbeddings.push(embedding);
          }
        }
      }

      return allEmbeddings;
    } catch (error) {
      console.error("[Transformers] Embedding failed:", error);
      throw new Error(
        `Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Matryoshka truncation with re-normalization
  private truncateAndNormalize(embedding: number[], dims: number): number[] {
    const truncated = embedding.slice(0, dims);
    const magnitude = Math.sqrt(truncated.reduce((sum, val) => sum + val * val, 0));
    return truncated.map((val) => val / magnitude);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initError) throw this.initError;
    if (this.extractor) return;
    if (!this.initPromise) {
      this.initPromise = this.initializeModel();
    }
    await this.initPromise;
  }

  private async initializeModel(): Promise<void> {
    try {
      console.error(`[Transformers] Initializing model: ${this.modelConfig.id}...`);
      const startTime = Date.now();

      // Dynamic import to avoid loading transformers.js if not needed
      const { pipeline } = await import("@huggingface/transformers");

      this.extractor = await pipeline("feature-extraction", this.modelConfig.id, {
        // Use quantized model for faster inference
        dtype: "q8",
      });

      const duration = Date.now() - startTime;
      console.error(`[Transformers] Model initialized in ${duration}ms`);
    } catch (error) {
      this.initError = error instanceof Error ? error : new Error(String(error));
      console.error("[Transformers] Failed to initialize:", this.initError);
      throw this.initError;
    }
  }

  isReady(): boolean {
    return this.extractor !== null && this.initError === null;
  }

  getInfo(): { provider: string; model: string; dimensions: number } {
    return {
      provider: "transformers",
      model: this.config.model!,
      dimensions: this.config.dimensions!,
    };
  }
}
