/**
 * Save current session with the enhanced session memory system
 */

import {
  createSession,
  createSessionLink,
  createLearning,
  getSessionStats,
  type SessionRecord,
  type FullContext,
} from '../../src/db';
import {
  initVectorDB,
  saveSession as saveSessionToChroma,
  findSimilarSessions,
} from '../../src/vector-db';

async function saveCurrentSession() {
  console.log('Initializing vector DB...');
  await initVectorDB();

  const sessionId = `session_${Date.now()}`;
  const now = new Date().toISOString();

  const fullContext: FullContext = {
    what_worked: [
      'Transformers.js embeddings 25x faster than FastEmbed (2ms vs 74ms)',
      'Docker for ChromaDB with auto-restart policy',
      'SQLite as source of truth, ChromaDB as search index',
      'Dual-storage pattern with sync on write',
      'Auto-linking based on similarity thresholds',
    ],
    what_didnt_work: [
      'Python 3.14 + onnxruntime incompatibility',
      'ChromaDB metadata arrays (had to convert to CSV strings)',
      'pipx install chromadb failed due to binary deps',
      'ChromaDB v1 API deprecated (410 errors)',
    ],
    learnings: [
      'Docker > venv for Python dependencies with binary compatibility issues',
      'ChromaDB only supports primitive metadata values (string, number, boolean)',
      'SQLite + ChromaDB dual-storage gives reliability + semantic search',
      'Auto-link threshold 0.85, suggest threshold 0.70 works well',
    ],
    future_ideas: [
      'Test nomic-embed-text-v1.5 model in production',
      'Explore pure-JS vector DB options',
      'Learning confidence auto-progression based on validation count',
      'Graph visualization of session/learning relationships',
    ],
    key_decisions: [
      'Port 8100 for ChromaDB (avoid conflict with 8000)',
      'Removed FastEmbed completely (Transformers.js is better)',
      'Keep both SQLite and ChromaDB (complementary strengths)',
      'Auto-link > 0.85 similarity, suggest 0.70-0.85',
    ],
    blockers_resolved: [
      'onnxruntime Python 3.14 compatibility → Docker',
      'ChromaDB v1 API deprecated → v2 endpoint',
      'Metadata array error → CSV string conversion',
    ],
  };

  const session: SessionRecord = {
    id: sessionId,
    summary: 'Built enhanced session memory system with SQLite + ChromaDB sync, auto-linking, and knowledge graph. Added 4 SQLite tables (sessions, learnings, session_links, learning_links), ChromaDB learnings collection, and rewrote session.ts with 5 enhanced MCP tools. Removed FastEmbed in favor of Transformers.js (25x faster).',
    full_context: fullContext,
    duration_mins: 180,
    commits_count: 5,
    tags: ['memory-system', 'sqlite', 'chromadb', 'auto-linking', 'mcp-tools', 'transformers-js'],
  };

  console.log('\n1. Saving to SQLite...');
  createSession(session);
  console.log(`   ✓ Session ${sessionId} saved to SQLite`);

  console.log('\n2. Saving to ChromaDB...');
  const searchContent = `${session.summary} ${session.tags?.join(' ') || ''}`;
  await saveSessionToChroma(sessionId, searchContent, {
    tags: session.tags || [],
    created_at: now,
  });
  console.log('   ✓ Session indexed in ChromaDB');

  console.log('\n3. Finding similar sessions for auto-linking...');
  const { autoLinked, suggested } = await findSimilarSessions(searchContent, sessionId);

  if (autoLinked.length > 0) {
    console.log(`   ✓ Auto-linked to ${autoLinked.length} sessions:`);
    for (const link of autoLinked) {
      createSessionLink(sessionId, link.id, 'auto_strong', link.similarity);
      console.log(`     - ${link.id} (similarity: ${link.similarity.toFixed(3)})`);
    }
  } else {
    console.log('   ℹ No sessions similar enough for auto-linking');
  }

  if (suggested.length > 0) {
    console.log(`   ℹ Suggested links (${suggested.length}):`);
    for (const s of suggested) {
      console.log(`     - ${s.id} (similarity: ${s.similarity.toFixed(3)}): ${s.summary?.substring(0, 50)}...`);
    }
  }

  console.log('\n4. Adding learnings from this session...');
  const learnings = [
    {
      category: 'tooling',
      title: 'Transformers.js outperforms FastEmbed by 25x',
      description: 'Query time: 2ms vs 74ms. Use Transformers.js for embeddings in Node/Bun.',
      context: 'When choosing embedding providers for TypeScript projects',
    },
    {
      category: 'architecture',
      title: 'SQLite + ChromaDB dual-storage pattern',
      description: 'SQLite as source of truth for reliability, ChromaDB as search index for semantic queries. Sync on write.',
      context: 'Building memory systems that need both structured queries and semantic search',
    },
    {
      category: 'debugging',
      title: 'ChromaDB metadata only supports primitives',
      description: 'Arrays must be converted to CSV strings. Objects not supported. String, number, boolean only.',
      context: 'When storing metadata in ChromaDB collections',
    },
    {
      category: 'tooling',
      title: 'Docker > venv for Python binary dependencies',
      description: 'When Python packages have binary deps (onnxruntime), Docker is more reliable than venv due to platform compatibility.',
      context: 'Setting up ChromaDB or similar Python tools',
    },
  ];

  for (const learning of learnings) {
    const learningId = createLearning({
      ...learning,
      source_session_id: sessionId,
      confidence: 'medium',
    });
    console.log(`   ✓ Learning #${learningId}: ${learning.title}`);
  }

  console.log('\n5. Session stats:');
  const stats = getSessionStats();
  console.log(`   Total sessions: ${stats.total_sessions}`);
  console.log(`   Average duration: ${stats.avg_duration_mins?.toFixed(1) || 'N/A'} mins`);
  console.log(`   Total commits: ${stats.total_commits}`);
  console.log(`   Top tags: ${stats.top_tags.slice(0, 5).map(t => `${t.tag}(${t.count})`).join(', ')}`);

  console.log('\n✅ Session saved successfully!');
  console.log(`   Session ID: ${sessionId}`);
  console.log(`   Summary length: ${session.summary.length} chars`);
  console.log(`   Tags: ${session.tags?.join(', ')}`);
  console.log(`   Auto-linked: ${autoLinked.length} sessions`);
  console.log(`   Learnings added: ${learnings.length}`);

  return sessionId;
}

saveCurrentSession().catch(console.error);
