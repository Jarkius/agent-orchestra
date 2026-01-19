#!/usr/bin/env bun
/**
 * Test semantic search with FastEmbed
 * Resets vectors and verifies semantic similarity works
 */

import {
  initVectorDB,
  resetVectorCollections,
  embedTask,
  searchSimilarTasks,
  getCollectionStats,
} from "../src/vector-db";

async function main() {
  console.log("=== FastEmbed Semantic Search Test ===\n");

  // Step 1: Reset collections
  console.log("1. Resetting vector collections...");
  try {
    await resetVectorCollections();
    console.log("   Collections reset successfully\n");
  } catch (error) {
    console.log("   ChromaDB not running, initializing fresh...");
    await initVectorDB();
    console.log("   Initialized\n");
  }

  // Step 2: Add test tasks with varied topics
  console.log("2. Adding test tasks...");
  const testTasks = [
    { id: "task1", prompt: "Write a Python function to sort a list of numbers using quicksort algorithm" },
    { id: "task2", prompt: "Create a JavaScript utility to sort an array efficiently" },
    { id: "task3", prompt: "Implement a sorting algorithm in TypeScript" },
    { id: "task4", prompt: "Design a PostgreSQL database schema for user authentication" },
    { id: "task5", prompt: "Build a login system with password hashing and JWT tokens" },
    { id: "task6", prompt: "Create a REST API endpoint for user registration" },
    { id: "task7", prompt: "Write unit tests for the payment processing module" },
    { id: "task8", prompt: "Debug the memory leak in the WebSocket connection handler" },
  ];

  for (const task of testTasks) {
    await embedTask(task.id, task.prompt, {
      agent_id: 1,
      priority: "normal",
      created_at: new Date().toISOString(),
    });
    console.log(`   Embedded: ${task.id}`);
  }
  console.log("");

  // Step 3: Get collection stats
  const stats = await getCollectionStats();
  console.log("3. Collection stats:", stats, "\n");

  // Step 4: Test semantic search
  console.log("4. Testing semantic search...\n");

  const queries = [
    "sorting algorithm implementation",
    "user authentication and security",
    "API development",
    "testing code",
  ];

  for (const query of queries) {
    console.log(`   Query: "${query}"`);
    const results = await searchSimilarTasks(query, 3);

    if (results.ids[0]!.length > 0) {
      console.log("   Top matches:");
      for (let i = 0; i < results.ids[0]!.length; i++) {
        const id = results.ids[0]![i];
        const distance = results.distances?.[0]?.[i]?.toFixed(4) || "N/A";
        const doc = (results.documents[0]![i]?.substring(0, 60) ?? '') + "...";
        console.log(`     ${i + 1}. [${id}] (dist: ${distance}) ${doc}`);
      }
    } else {
      console.log("   No results found");
    }
    console.log("");
  }

  console.log("=== Test Complete ===");
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
