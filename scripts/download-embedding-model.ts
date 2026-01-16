#!/usr/bin/env bun
/**
 * Pre-download the embedding model for offline use.
 * Run this before deploying to ensure the model is cached.
 *
 * Usage: bun run download-model
 */

import { EmbeddingModel, FlagEmbedding } from "fastembed";

async function main() {
  const modelName = process.env.FASTEMBED_MODEL || "BGESmallENV15";

  const modelMap: Record<string, EmbeddingModel> = {
    "BGESmallENV15": EmbeddingModel.BGESmallENV15,
    "BGESmallEN": EmbeddingModel.BGESmallEN,
    "BGEBaseEN": EmbeddingModel.BGEBaseEN,
    "BGEBaseENV15": EmbeddingModel.BGEBaseENV15,
    "AllMiniLML6V2": EmbeddingModel.AllMiniLML6V2,
  };

  const selectedModel = modelMap[modelName] || EmbeddingModel.BGESmallENV15;

  console.log(`Downloading embedding model: ${modelName}`);
  console.log("This may take a moment on first run (~33MB for bge-small-en-v1.5)...\n");

  const startTime = Date.now();

  const model = await FlagEmbedding.init({
    model: selectedModel,
    cacheDir: process.env.FASTEMBED_CACHE_DIR,
  });

  // Test embedding to verify model works
  const testEmbedding: number[][] = [];
  for await (const batch of model.embed(["hello world"])) {
    testEmbedding.push(...batch);
  }

  const duration = Date.now() - startTime;

  console.log(`Model downloaded and verified in ${duration}ms`);
  console.log(`Embedding dimensions: ${testEmbedding[0].length}`);
  console.log("\nReady for use!");
}

main().catch((error) => {
  console.error("Failed to download model:", error);
  process.exit(1);
});
