#!/usr/bin/env bun
/**
 * /distill - Extract learnings from sessions
 *
 * Usage:
 *   bun memory distill                     # From last session
 *   bun memory distill session_123         # From specific session
 *   bun memory distill --last 5            # From last N sessions
 *   bun memory distill --yes               # Auto-accept all suggestions
 */

// Check for --yes flag early
const autoAccept = process.argv.includes('--yes') || process.argv.includes('-y');
// Remove flag from argv for downstream parsing
process.argv = process.argv.filter(a => a !== '--yes' && a !== '-y');

import { initVectorDB, saveLearning as saveLearningToChroma, findSimilarLearnings } from '../../src/vector-db';
import { getSessionById, listSessionsFromDb, createLearning, createLearningLink, type SessionRecord } from '../../src/db';
import * as readline from 'readline';

const TECHNICAL_CATEGORIES = ['performance', 'architecture', 'tooling', 'debugging', 'security', 'testing', 'process'] as const;
const WISDOM_CATEGORIES = ['philosophy', 'principle', 'insight', 'pattern', 'retrospective'] as const;
const ALL_CATEGORIES = [...TECHNICAL_CATEGORIES, ...WISDOM_CATEGORIES] as const;

type Category = typeof ALL_CATEGORIES[number];

const CATEGORY_ICONS: Record<Category, string> = {
  performance: '⚡',
  architecture: '🏛️',
  tooling: '🔧',
  debugging: '🔍',
  security: '🔒',
  testing: '🧪',
  process: '📋',
  philosophy: '🌟',
  principle: '⚖️',
  insight: '💡',
  pattern: '🔄',
  retrospective: '📖',
};

// Simple category suggestion based on keywords
function suggestCategory(text: string): Category {
  const lower = text.toLowerCase();

  // Technical patterns
  if (/\b(fast|slow|latency|memory|cache|optimize|performance)\b/.test(lower)) return 'performance';
  if (/\b(pattern|design|structure|layer|component|module)\b/.test(lower)) return 'architecture';
  if (/\b(tool|config|setup|install|cli|command|script)\b/.test(lower)) return 'tooling';
  if (/\b(bug|error|fix|issue|debug|trace|log)\b/.test(lower)) return 'debugging';
  if (/\b(security|auth|token|secret|encrypt|vulnerability)\b/.test(lower)) return 'security';
  if (/\b(test|spec|coverage|mock|assert)\b/.test(lower)) return 'testing';
  if (/\b(workflow|process|method|team|review)\b/.test(lower)) return 'process';

  // Wisdom patterns
  if (/\b(believe|philosophy|approach|mindset|way of)\b/.test(lower)) return 'philosophy';
  if (/\b(always|never|must|rule|principle|guideline)\b/.test(lower)) return 'principle';
  if (/\b(realized|understood|discovered|insight|aha)\b/.test(lower)) return 'insight';
  if (/\b(pattern|recurring|often|usually|tend to)\b/.test(lower)) return 'pattern';
  if (/\b(learned|retrospective|looking back|in hindsight)\b/.test(lower)) return 'retrospective';

  // Default to insight for wisdom-type content
  return 'insight';
}

function isWisdomCategory(category: string): boolean {
  return (WISDOM_CATEGORIES as readonly string[]).includes(category);
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

interface ExtractedLearning {
  text: string;
  suggestedCategory: Category;
  source: 'learnings' | 'wins' | 'challenges';
}

function extractFromSession(session: SessionRecord): ExtractedLearning[] {
  const extracted: ExtractedLearning[] = [];

  if (!session.full_context) return extracted;

  const ctx = session.full_context as any;

  // Extract from learnings array
  if (Array.isArray(ctx.learnings)) {
    for (const learning of ctx.learnings) {
      if (typeof learning === 'string' && learning.trim()) {
        extracted.push({
          text: learning.trim(),
          suggestedCategory: suggestCategory(learning),
          source: 'learnings',
        });
      }
    }
  }

  // Extract from wins array (often contains reusable insights)
  if (Array.isArray(ctx.wins)) {
    for (const item of ctx.wins) {
      if (typeof item === 'string' && item.trim()) {
        extracted.push({
          text: item.trim(),
          suggestedCategory: suggestCategory(item),
          source: 'wins',
        });
      }
    }
  }

  // Extract from challenges (lessons learned)
  if (Array.isArray(ctx.challenges)) {
    for (const item of ctx.challenges) {
      if (typeof item === 'string' && item.trim()) {
        extracted.push({
          text: item.trim(),
          suggestedCategory: suggestCategory(item),
          source: 'challenges',
        });
      }
    }
  }

  return extracted;
}

interface StructuredLearning {
  title: string;
  what_happened?: string;
  lesson?: string;
  prevention?: string;
}

async function saveLearningFromDistill(
  category: Category,
  learning: StructuredLearning,
  sourceSessionId: string,
  context?: string
): Promise<number> {
  await initVectorDB();

  const agentIdStr = process.env.MEMORY_AGENT_ID;
  const agentId = agentIdStr ? parseInt(agentIdStr) : null;

  // Distilled learnings start at 'low' - validate to increase confidence
  const defaultConfidence = 'low';

  // 1. Save to SQLite with structured fields
  const learningId = createLearning({
    category,
    title: learning.title,
    context,
    source_session_id: sourceSessionId,
    confidence: defaultConfidence,
    agent_id: agentId,
    visibility: agentId === null ? 'public' : 'private',
    what_happened: learning.what_happened,
    lesson: learning.lesson,
    prevention: learning.prevention,
  });

  // 2. Save to ChromaDB
  const searchContent = `${learning.title} ${learning.lesson || ''} ${learning.what_happened || ''} ${context || ''}`;
  await saveLearningToChroma(learningId, learning.title, learning.lesson || context || '', {
    category,
    confidence: defaultConfidence,
    source_session_id: sourceSessionId,
    created_at: new Date().toISOString(),
    agent_id: agentId,
    visibility: agentId === null ? 'public' : 'private',
  });

  // 3. Auto-link to similar learnings
  const autoLinkOptions: { excludeId: number; agentId?: number; crossAgentLinking: boolean } = {
    excludeId: learningId,
    crossAgentLinking: false,
  };
  if (agentId !== null) {
    autoLinkOptions.agentId = agentId;
  }
  const { autoLinked } = await findSimilarLearnings(searchContent, autoLinkOptions);

  for (const link of autoLinked) {
    createLearningLink(learningId, parseInt(link.id), 'auto_strong', link.similarity);
  }

  return learningId;
}

async function distillSession(session: SessionRecord) {
  console.log(`\n📖 Session: ${session.id}`);
  console.log(`   Summary: ${session.summary?.substring(0, 60)}...`);
  console.log('─'.repeat(60));

  const extracted = extractFromSession(session);

  if (extracted.length === 0) {
    console.log('\n   No learnings found in this session\'s context.\n');
    return;
  }

  console.log(`\n   Found ${extracted.length} potential learning(s):\n`);

  let saved = 0;

  for (let i = 0; i < extracted.length; i++) {
    const item = extracted[i];
    const icon = CATEGORY_ICONS[item.suggestedCategory];
    const sourceLabel = item.source === 'learnings' ? '💡' : item.source === 'wins' ? '✓' : '⚠️';

    console.log(`   ${i + 1}. ${sourceLabel} [${item.suggestedCategory}] ${item.text.substring(0, 70)}${item.text.length > 70 ? '...' : ''}`);

    let category = item.suggestedCategory;
    let shouldSave = autoAccept;

    if (!autoAccept) {
      const answer = await prompt(`      Save as ${icon} ${item.suggestedCategory}? [Y/n/c(ategory)/s(kip all)] `);
      const lower = answer.toLowerCase();

      if (lower === 's') {
        console.log('\n   Skipping remaining learnings.\n');
        break;
      }

      if (lower === 'n') {
        continue;
      }

      if (lower === 'c') {
        const newCat = await prompt('      Category: ');
        if (ALL_CATEGORIES.includes(newCat.toLowerCase() as Category)) {
          category = newCat.toLowerCase() as Category;
        }
      }

      shouldSave = true;
    }

    if (shouldSave) {
      // Auto-populate structured fields from source
      const sourceLabel = item.source === 'wins' ? 'Win' :
                          item.source === 'challenges' ? 'Challenge' : 'Learning';

      const structuredLearning: StructuredLearning = {
        title: item.text,
        what_happened: `${sourceLabel} from session: ${item.text}`,
      };

      // In interactive mode, allow refinement of structured fields
      if (!autoAccept) {
        console.log('\n      📝 Refine structured details (or Enter to keep defaults):');

        const whatHappened = await prompt('      What happened? > ');
        if (whatHappened) structuredLearning.what_happened = whatHappened;

        const lesson = await prompt('      Key lesson? > ');
        if (lesson) structuredLearning.lesson = lesson;

        const prevention = await prompt('      How to apply? > ');
        if (prevention) structuredLearning.prevention = prevention;
      }

      // Save the learning
      const learningId = await saveLearningFromDistill(
        category,
        structuredLearning,
        session.id,
        `Distilled from session ${session.id} (${item.source})`
      );

      console.log(`      ✅ Saved as learning #${learningId}`);
      saved++;
    }
  }

  console.log(`\n   📊 Saved ${saved} of ${extracted.length} learnings from this session.\n`);
}

async function main() {
  const args = process.argv.slice(2);

  console.log('\n🧪 Distill Learnings from Sessions\n');
  console.log('═'.repeat(60));

  await initVectorDB();

  let sessions: SessionRecord[] = [];

  if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage:
  bun memory distill                     # From last session
  bun memory distill session_123         # From specific session
  bun memory distill --last 5            # From last N sessions
  bun memory distill --yes               # Auto-accept all suggestions
  bun memory distill --last 5 --yes      # Combine flags

Options:
  --yes, -y    Auto-accept all suggestions (no prompts)

This extracts learnings, wins, and challenges from session context
and saves them as proper learnings with category and confidence.
`);
    return;
  }

  if (args[0] === '--last') {
    const count = parseInt(args[1]) || 5;
    sessions = listSessionsFromDb({ limit: count });
    console.log(`\nDistilling from last ${sessions.length} session(s)...\n`);
  } else if (args[0]?.startsWith('session_')) {
    const session = getSessionById(args[0]);
    if (!session) {
      console.error(`\n❌ Session not found: ${args[0]}\n`);
      process.exit(1);
    }
    sessions = [session];
  } else {
    // Default: last session
    sessions = listSessionsFromDb({ limit: 1 });
    if (sessions.length === 0) {
      console.log('\n   No sessions found.\n');
      return;
    }
    console.log('\nDistilling from last session...\n');
  }

  for (const session of sessions) {
    await distillSession(session);
  }

  console.log('═'.repeat(60));
  console.log('\n✅ Distillation complete!\n');
}

main().catch(console.error);
