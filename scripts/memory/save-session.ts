#!/usr/bin/env bun
/**
 * Interactive Session Save
 * Save current session with full context to SQLite + ChromaDB
 *
 * Usage:
 *   bun memory save                    # Interactive mode
 *   bun memory save "summary" --tags tag1,tag2
 */

import {
  createSession,
  createSessionLink,
  createLearning,
  getSessionStats,
  listSessionsFromDb,
  type SessionRecord,
  type FullContext,
} from '../../src/db';
import {
  initVectorDB,
  saveSession as saveSessionToChroma,
  findSimilarSessions,
} from '../../src/vector-db';

// Parse arguments
const args = process.argv.slice(2);
let summary = '';
let tags: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tags' && args[i + 1]) {
    tags = args[i + 1].split(',').map(t => t.trim());
    i++;
  } else if (!args[i].startsWith('--')) {
    summary = args[i];
  }
}

async function promptInput(question: string): Promise<string> {
  process.stdout.write(question);
  const buf = Buffer.alloc(1024);
  const n = await Bun.stdin.read(buf);
  return buf.toString('utf-8', 0, n || 0).trim();
}

async function interactiveMode() {
  console.log('\n📝 Save Session - Interactive Mode\n');
  console.log('─'.repeat(50));

  // Show recent sessions for context
  const recent = listSessionsFromDb({ limit: 2 });
  if (recent.length > 0) {
    console.log('\nRecent sessions:');
    for (const s of recent) {
      console.log(`  ${s.id}: ${s.summary?.substring(0, 50)}...`);
    }
    console.log('');
  }

  // Get summary
  if (!summary) {
    summary = await promptInput('Session summary (1-2 sentences): ');
    if (!summary) {
      console.log('Summary is required. Aborting.');
      process.exit(1);
    }
  }

  // Get tags
  if (tags.length === 0) {
    const tagsInput = await promptInput('Tags (comma-separated): ');
    tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
  }

  // Get duration
  const durationInput = await promptInput('Duration in minutes (optional): ');
  const duration = durationInput ? parseInt(durationInput) : undefined;

  // Get commits
  const commitsInput = await promptInput('Commits count (optional): ');
  const commits = commitsInput ? parseInt(commitsInput) : undefined;

  // Get what worked
  const whatWorkedInput = await promptInput('What worked? (comma-separated, optional): ');
  const whatWorked = whatWorkedInput ? whatWorkedInput.split(',').map(t => t.trim()) : [];

  // Get what didn't work
  const whatDidntInput = await promptInput('What didn\'t work? (comma-separated, optional): ');
  const whatDidnt = whatDidntInput ? whatDidntInput.split(',').map(t => t.trim()) : [];

  // Get learnings
  const learningsInput = await promptInput('Key learnings? (comma-separated, optional): ');
  const learnings = learningsInput ? learningsInput.split(',').map(t => t.trim()) : [];

  return {
    summary,
    tags,
    duration,
    commits,
    fullContext: {
      what_worked: whatWorked.length > 0 ? whatWorked : undefined,
      what_didnt_work: whatDidnt.length > 0 ? whatDidnt : undefined,
      learnings: learnings.length > 0 ? learnings : undefined,
    } as FullContext,
  };
}

async function quickMode() {
  return {
    summary,
    tags,
    duration: undefined,
    commits: undefined,
    fullContext: {} as FullContext,
  };
}

async function saveCurrentSession() {
  // Initialize
  console.log('Initializing vector DB...');
  await initVectorDB();

  // Get session data
  const data = summary ? await quickMode() : await interactiveMode();

  const sessionId = `session_${Date.now()}`;
  const now = new Date().toISOString();

  const session: SessionRecord = {
    id: sessionId,
    summary: data.summary,
    full_context: data.fullContext,
    duration_mins: data.duration,
    commits_count: data.commits,
    tags: data.tags.length > 0 ? data.tags : undefined,
  };

  console.log('\n1. Saving to SQLite...');
  createSession(session);
  console.log(`   ✓ Session ${sessionId} saved to SQLite`);

  console.log('\n2. Saving to ChromaDB...');
  const searchContent = `${data.summary} ${data.tags.join(' ')}`;
  await saveSessionToChroma(sessionId, searchContent, {
    tags: data.tags,
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
    for (const s of suggested.slice(0, 3)) {
      console.log(`     - ${s.id} (${s.similarity.toFixed(3)})`);
    }
  }

  // Save learnings if provided
  const learnings = data.fullContext?.learnings || [];
  if (learnings.length > 0) {
    console.log('\n4. Adding learnings from this session...');
    for (const learning of learnings) {
      const learningId = createLearning({
        category: 'process',
        title: learning,
        source_session_id: sessionId,
        confidence: 'low',
      });
      console.log(`   ✓ Learning #${learningId}: ${learning.substring(0, 50)}...`);
    }
  }

  console.log('\n5. Session stats:');
  const stats = getSessionStats();
  console.log(`   Total sessions: ${stats.total_sessions}`);
  console.log(`   Average duration: ${stats.avg_duration_mins?.toFixed(1) || 'N/A'} mins`);
  console.log(`   Total commits: ${stats.total_commits}`);

  console.log('\n✅ Session saved successfully!');
  console.log(`   Session ID: ${sessionId}`);
  console.log(`   Summary: ${data.summary.substring(0, 60)}...`);
  if (data.tags.length > 0) {
    console.log(`   Tags: ${data.tags.join(', ')}`);
  }
  console.log(`   Auto-linked: ${autoLinked.length} sessions`);

  return sessionId;
}

saveCurrentSession().catch(console.error);
