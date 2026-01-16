/**
 * FastEmbed Provider
 * Local ONNX embeddings using fastembed library
 *
 * Default model: bge-small-en-v1.5 (384 dims, ~33MB)
 */

import { EmbeddingModel, FlagEmbedding } from "fastembed";
import type { IEmbeddingFunction } from "chromadb";
import type { EmbeddingConfig } from "./index";

const MODEL_MAP: Record<string, EmbeddingModel> = {
  "bge-small-en-v1.5": EmbeddingModel.BGESmallENV15,
  "bge-small-en": EmbeddingModel.BGESmallEN,
  "bge-base-en": EmbeddingModel.BGEBaseEN,
  "bge-base-en-v1.5": EmbeddingModel.BGEBaseENV15,
  "all-minilm-l6-v2": EmbeddingModel.AllMiniLML6V2,
  // Aliases
  BGESmallENV15: EmbeddingModel.BGESmallENV15,
  BGESmallEN: EmbeddingModel.BGESmallEN,
  BGEBaseEN: EmbeddingModel.BGEBaseEN,
  BGEBaseENV15: EmbeddingModel.BGEBaseENV15,
  AllMiniLML6V2: EmbeddingModel.AllMiniLML6V2,
};

export class FastEmbedFunction implements IEmbeddingFunction {
  private model: FlagEmbedding | null = null;
  private initPromise: Promise<void> | null = null;
  private initError: Error | null = null;
  private config: EmbeddingConfig;

  constructor(config?: Partial<EmbeddingConfig>) {
    this.config = {
      provider: "fastembed",
      model: config?.model || "bge-small-en-v1.5",
      batchSize: config?.batchSize || 32,
      cacheDir: config?.cacheDir,
      dimensions: 384, // bge-small-en-v1.5 default
    };
  }

  async generate(texts: string[]): Promise<number[][]> {
    await this.ensureInitialized();
    if (texts.length === 0) return [];

    try {
      const allEmbeddings: number[][] = [];
      for await (const batch of this.model!.embed(texts, this.config.batchSize)) {
        for (const embedding of batch) {
          allEmbeddings.push(Array.from(embedding));
        }
      }
      return allEmbeddings;
    } catch (error) {
      console.error("[FastEmbed] Embedding failed:", error);
      throw new Error(
        `Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initError) throw this.initError;
    if (this.model) return;
    if (!this.initPromise) {
      this.initPromise = this.initializeModel();
    }
    await this.initPromise;
  }

  private async initializeModel(): Promise<void> {
    try {
      console.error(`[FastEmbed] Initializing model: ${this.config.model}...`);
      const startTime = Date.now();

      const selectedModel = MODEL_MAP[this.config.model!] || EmbeddingModel.BGESmallENV15;
      if (!MODEL_MAP[this.config.model!]) {
        console.error(`[FastEmbed] Unknown model "${this.config.model}", using bge-small-en-v1.5`);
      }

      this.model = await FlagEmbedding.init({
        model: selectedModel,
        cacheDir: this.config.cacheDir,
      });

      const duration = Date.now() - startTime;
      console.error(`[FastEmbed] Model initialized in ${duration}ms`);
    } catch (error) {
      this.initError = error instanceof Error ? error : new Error(String(error));
      console.error("[FastEmbed] Failed to initialize:", this.initError);
      throw this.initError;
    }
  }

  isReady(): boolean {
    return this.model !== null && this.initError === null;
  }

  getInfo(): { provider: string; model: string; dimensions: number } {
    return {
      provider: "fastembed",
      model: this.config.model!,
      dimensions: this.config.dimensions!,
    };
  }
}
