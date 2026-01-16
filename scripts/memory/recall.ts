#!/usr/bin/env bun
/**
 * /recall - Quick semantic search for past sessions and learnings
 * Usage: bun scripts/memory/recall.ts "your search query"
 */

import { initVectorDB, searchSessions, searchLearnings } from '../../src/vector-db';
import { getSessionById, getLearningById } from '../../src/db';

const query = process.argv[2];

if (!query) {
  console.log('Usage: bun scripts/memory/recall.ts "search query"');
  console.log('');
  console.log('Examples:');
  console.log('  bun scripts/memory/recall.ts "embedding performance"');
  console.log('  bun scripts/memory/recall.ts "docker chromadb"');
  process.exit(1);
}

async function recall() {
  console.log(`\n🔍 Searching for: "${query}"\n`);

  await initVectorDB();

  // Search sessions
  console.log('━━━ Sessions ━━━');
  const sessionResults = await searchSessions(query, 3);

  if (sessionResults.ids[0]?.length) {
    for (let i = 0; i < sessionResults.ids[0].length; i++) {
      const id = sessionResults.ids[0][i];
      const distance = sessionResults.distances?.[0]?.[i] || 0;
      const relevance = (1 - distance).toFixed(3);
      const session = getSessionById(id);

      console.log(`\n  [${relevance}] ${id}`);
      console.log(`  ${session?.summary?.substring(0, 100)}...`);
      console.log(`  Tags: ${session?.tags?.join(', ') || 'none'}`);
    }
  } else {
    console.log('  No matching sessions found');
  }

  // Search learnings
  console.log('\n━━━ Learnings ━━━');
  const learningResults = await searchLearnings(query, 5);

  if (learningResults.ids[0]?.length) {
    for (let i = 0; i < learningResults.ids[0].length; i++) {
      const id = learningResults.ids[0][i];
      const numId = parseInt(id.replace('learning_', ''));
      const distance = learningResults.distances?.[0]?.[i] || 0;
      const relevance = (1 - distance).toFixed(3);
      const learning = getLearningById(numId);

      if (learning) {
        const badge = learning.confidence === 'proven' ? '**' : learning.confidence === 'high' ? '*' : '';
        console.log(`\n  [${relevance}] #${learning.id} ${badge}${learning.title}${badge}`);
        console.log(`  Category: ${learning.category} | Confidence: ${learning.confidence}`);
        if (learning.description) {
          console.log(`  ${learning.description.substring(0, 80)}...`);
        }
      }
    }
  } else {
    console.log('  No matching learnings found');
  }

  console.log('\n');
}

recall().catch(console.error);
