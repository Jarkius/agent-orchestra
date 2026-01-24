#!/usr/bin/env bun
/**
 * Pre-download the embedding model for offline use.
 * Run this before deploying to ensure the model is cached.
 *
 * Usage: bun run download-model
 */

import { TransformersEmbeddingFunction } from "../src/embeddings/transformers-provider";

async function main() {
  const modelName = process.env.EMBEDDING_MODEL || "nomic-embed-text-v1.5";

  console.log(`Downloading embedding model: ${modelName}`);
  console.log("This may take a moment on first run (~250MB for nomic-embed-text-v1.5)...\n");

  const startTime = Date.now();

  const embeddingFunction = new TransformersEmbeddingFunction();

  // Test embedding to verify model works
  const testEmbedding = await embeddingFunction.generate(["hello world"]);

  const duration = Date.now() - startTime;

  console.log(`\nModel downloaded and verified in ${duration}ms`);
  console.log(`Embedding dimensions: ${testEmbedding[0]!.length}`);
  console.log("\nReady for use!");
}

main().catch((error) => {
  console.error("Failed to download model:", error);
  process.exit(1);
});
