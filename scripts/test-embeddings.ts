#!/usr/bin/env bun
/**
 * Embedding Test Suite
 *
 * Tests Transformers.js provider for:
 * 1. Basic functionality (dimensions, output format)
 * 2. Semantic similarity quality
 * 3. Performance (latency)
 *
 * Usage:
 *   bun run scripts/test-embeddings.ts
 *   bun run scripts/test-embeddings.ts transformers
 *   bun run scripts/test-embeddings.ts nomic  # test nomic model
 */

import { TransformersEmbeddingFunction } from "../src/embeddings/transformers-provider";

// Test data - semantically grouped
const TEST_CORPUS = {
  sorting: [
    "Write a Python function to sort a list using quicksort",
    "Implement bubble sort algorithm in JavaScript",
    "Create an efficient sorting utility for arrays",
  ],
  auth: [
    "Build a user authentication system with JWT tokens",
    "Implement login and password hashing for security",
    "Design a session-based auth flow with cookies",
  ],
  database: [
    "Design a PostgreSQL schema for user profiles",
    "Write SQL queries to optimize database performance",
    "Create database migrations for the new tables",
  ],
  testing: [
    "Write unit tests for the payment module",
    "Create integration tests for the API endpoints",
    "Set up test fixtures and mocking",
  ],
};

const TEST_QUERIES = [
  { query: "sorting algorithm implementation", expectedGroup: "sorting" },
  { query: "user login and security", expectedGroup: "auth" },
  { query: "SQL database design", expectedGroup: "database" },
  { query: "automated testing", expectedGroup: "testing" },
];

// Cosine similarity calculation
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface TestResult {
  provider: string;
  model: string;
  dimensions: number;
  initTime: number;
  embedTime: number;
  avgQueryTime: number;
  semanticScore: number;
  details: {
    query: string;
    topMatch: string;
    topGroup: string;
    correct: boolean;
    similarity: number;
  }[];
}

async function testProvider(
  name: string,
  provider: { generate: (texts: string[]) => Promise<number[][]>; getInfo: () => any }
): Promise<TestResult> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log("=".repeat(60));

  const info = provider.getInfo();

  // 1. Initialize and measure init time
  console.log("\n1. Initialization...");
  const initStart = Date.now();
  await provider.generate(["warmup"]);
  const initTime = Date.now() - initStart;
  console.log(`   Init time: ${initTime}ms`);

  // 2. Embed all corpus documents
  console.log("\n2. Embedding corpus...");
  const allDocs: { text: string; group: string }[] = [];
  for (const [group, docs] of Object.entries(TEST_CORPUS)) {
    for (const doc of docs) {
      allDocs.push({ text: doc, group });
    }
  }

  const embedStart = Date.now();
  const corpusEmbeddings = await provider.generate(allDocs.map((d) => d.text));
  const embedTime = Date.now() - embedStart;
  console.log(`   Embedded ${allDocs.length} documents in ${embedTime}ms`);
  console.log(`   Dimensions: ${corpusEmbeddings[0].length}`);

  // 3. Test semantic search quality
  console.log("\n3. Testing semantic search quality...");
  const details: TestResult["details"] = [];
  let correctMatches = 0;
  let totalQueryTime = 0;

  for (const test of TEST_QUERIES) {
    const queryStart = Date.now();
    const [queryEmbedding] = await provider.generate([test.query]);
    totalQueryTime += Date.now() - queryStart;

    // Find most similar document
    let maxSim = -1;
    let bestIdx = 0;
    for (let i = 0; i < corpusEmbeddings.length; i++) {
      const sim = cosineSimilarity(queryEmbedding, corpusEmbeddings[i]);
      if (sim > maxSim) {
        maxSim = sim;
        bestIdx = i;
      }
    }

    const topMatch = allDocs[bestIdx];
    const correct = topMatch.group === test.expectedGroup;
    if (correct) correctMatches++;

    details.push({
      query: test.query,
      topMatch: topMatch.text.substring(0, 50) + "...",
      topGroup: topMatch.group,
      correct,
      similarity: maxSim,
    });

    const status = correct ? "✓" : "✗";
    console.log(`   ${status} "${test.query}" → ${topMatch.group} (sim: ${maxSim.toFixed(4)})`);
  }

  const semanticScore = correctMatches / TEST_QUERIES.length;
  console.log(`\n   Semantic accuracy: ${correctMatches}/${TEST_QUERIES.length} (${(semanticScore * 100).toFixed(0)}%)`);
  console.log(`   Avg query time: ${(totalQueryTime / TEST_QUERIES.length).toFixed(1)}ms`);

  return {
    provider: name,
    model: info.model,
    dimensions: corpusEmbeddings[0].length,
    initTime,
    embedTime,
    avgQueryTime: totalQueryTime / TEST_QUERIES.length,
    semanticScore,
    details,
  };
}

async function runTest(modelName: string = "bge-small-en-v1.5") {
  console.log("\n" + "=".repeat(60));
  console.log("EMBEDDING TEST - Transformers.js");
  console.log("=".repeat(60));

  const provider = new TransformersEmbeddingFunction({ model: modelName });
  const result = await testProvider(`Transformers.js (${modelName})`, provider);

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`\n| Metric           | Value                          |`);
  console.log(`|------------------|--------------------------------|`);
  console.log(`| Model            | ${result.model.padEnd(30)} |`);
  console.log(`| Dimensions       | ${String(result.dimensions).padEnd(30)} |`);
  console.log(`| Init Time        | ${(result.initTime + "ms").padEnd(30)} |`);
  console.log(`| Embed Time       | ${(result.embedTime + "ms").padEnd(30)} |`);
  console.log(`| Avg Query Time   | ${(result.avgQueryTime.toFixed(1) + "ms").padEnd(30)} |`);
  console.log(`| Semantic Score   | ${((result.semanticScore * 100).toFixed(0) + "%").padEnd(30)} |`);

  return result;
}

// Main
const arg = process.argv[2] || "transformers";

const modelMap: Record<string, string> = {
  transformers: "bge-small-en-v1.5",
  bge: "bge-small-en-v1.5",
  nomic: "nomic-embed-text-v1.5",
  minilm: "all-minilm-l6-v2",
};

const modelName = modelMap[arg] || arg;
runTest(modelName).catch(console.error);
