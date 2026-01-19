#!/usr/bin/env bun
/**
 * /context - Get context bundle for starting a new session
 * Usage: bun scripts/memory/context.ts ["optional query"]
 */

import { initVectorDB, searchSessions, searchLearnings } from '../../src/vector-db';
import {
  listSessionsFromDb,
  listLearningsFromDb,
  getSessionStats,
  getSessionById
} from '../../src/db';

const query = process.argv[2];

async function getContext() {
  console.log('\n🎯 Context Bundle for New Session\n');
  console.log('═'.repeat(60));

  await initVectorDB();

  // Stats overview
  const stats = getSessionStats();
  console.log('\n📊 Quick Stats');
  console.log(`  Sessions: ${stats.total_sessions} | Commits: ${stats.total_commits}`);
  console.log(`  Top tags: ${stats.top_tags.slice(0, 5).map(t => t.tag).join(', ')}`);

  // Recent sessions
  console.log('\n─'.repeat(60));
  console.log('\n📅 Recent Sessions\n');
  const recentSessions = listSessionsFromDb({ limit: 3 });

  for (const s of recentSessions) {
    console.log(`  ${s.id}`);
    console.log(`  ${s.summary?.substring(0, 70)}...`);

    // Show wins and learnings from full_context if available
    if (s.full_context) {
      const ctx = s.full_context as any;
      if (ctx.wins?.length) {
        console.log(`  ✓ Wins: ${ctx.wins.slice(0, 2).join('; ')}`);
      }
      if (ctx.learnings?.length) {
        console.log(`  💡 Learnings: ${ctx.learnings.slice(0, 2).join('; ')}`);
      }
    }
    console.log('');
  }

  // If query provided, find relevant content
  if (query) {
    console.log('─'.repeat(60));
    console.log(`\n🔍 Relevant to: "${query}"\n`);

    // Search sessions
    const sessionResults = await searchSessions(query, 2);
    if (sessionResults.ids[0]?.length) {
      console.log('  Related sessions:');
      for (let i = 0; i < sessionResults.ids[0].length; i++) {
        const id = sessionResults.ids[0]![i]!;
        const session = getSessionById(id);
        const distance = sessionResults.distances?.[0]?.[i] || 0;
        console.log(`    [${(1 - distance).toFixed(2)}] ${id}`);
        console.log(`          ${session?.summary?.substring(0, 50)}...`);
      }
    }

    // Search learnings
    const learningResults = await searchLearnings(query, 3);
    if (learningResults.ids[0]?.length) {
      console.log('\n  Related learnings:');
      for (let i = 0; i < learningResults.ids[0].length; i++) {
        const doc = learningResults.documents[0]?.[i];
        const meta = learningResults.metadatas[0]?.[i] as any;
        const distance = learningResults.distances?.[0]?.[i] || 0;
        console.log(`    [${(1 - distance).toFixed(2)}] [${meta?.category}] ${doc?.substring(0, 60)}...`);
      }
    }
  }

  // Key learnings (high confidence)
  console.log('\n─'.repeat(60));
  console.log('\n⭐ Key Learnings (High Confidence)\n');

  const provenLearnings = listLearningsFromDb({ confidence: 'proven', limit: 5 });
  const highLearnings = listLearningsFromDb({ confidence: 'high', limit: 5 });
  const keyLearnings = [...provenLearnings, ...highLearnings].slice(0, 5);

  if (keyLearnings.length === 0) {
    const mediumLearnings = listLearningsFromDb({ confidence: 'medium', limit: 5 });
    keyLearnings.push(...mediumLearnings);
  }

  for (const l of keyLearnings) {
    const badge = l.confidence === 'proven' ? '⭐' : l.confidence === 'high' ? '✓' : '○';
    console.log(`  ${badge} [${l.category}] ${l.title}`);
    if (l.context) {
      console.log(`    → ${l.context}`);
    }
  }

  console.log('\n═'.repeat(60));
  console.log('\nUse "bun memory recall <query>" for deeper search');
  console.log('Use "bun memory list sessions" to see more sessions\n');
}

getContext().catch(console.error);
