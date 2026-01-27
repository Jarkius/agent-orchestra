#!/usr/bin/env bun
/**
 * /distill - Extract learnings from sessions
 *
 * Usage:
 *   bun memory distill                     # From last session (heuristic)
 *   bun memory distill --smart             # Use Claude Sonnet for extraction
 *   bun memory distill --smart --dedupe    # Also run smart deduplication
 *   bun memory distill session_123         # From specific session
 *   bun memory distill --last 5            # From last N sessions
 *   bun memory distill --yes               # Auto-accept all suggestions
 */

// Check for flags early
const autoAccept = process.argv.includes('--yes') || process.argv.includes('-y');
const useSmartMode = process.argv.includes('--smart');
const runDedupe = process.argv.includes('--dedupe');

// Remove flags from argv for downstream parsing
process.argv = process.argv.filter(a =>
  a !== '--yes' && a !== '-y' && a !== '--smart' && a !== '--dedupe'
);

import { initVectorDB, saveLearning as saveLearningToChroma, findSimilarLearnings } from '../../src/vector-db';
import { smartDistill } from '../../src/learning/distill-engine';
import { runSmartConsolidation } from '../../src/learning/consolidation';
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
export function suggestCategory(text: string): Category {
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
  const agentIdStr = process.env.MEMORY_AGENT_ID;
  const agentId = agentIdStr ? parseInt(agentIdStr) : null;

  // Distilled learnings start at 'low' - validate to increase confidence
  const defaultConfidence = 'low';

  // 1. Save to SQLite FIRST (fast, always works)
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

  // 2. Try vector operations (may fail/timeout, that's OK)
  try {
    await initVectorDB();

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
  } catch (error) {
    // Vector ops are best-effort - learning is already saved to SQLite
    console.log('      ⚠ Vector indexing skipped (can rebuild later with: bun memory reindex)');
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
    const item = extracted[i]!;
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

  if (useSmartMode) {
    console.log('\n🧠 Smart Distill (Claude Sonnet)\n');
  } else {
    console.log('\n🧪 Distill Learnings from Sessions\n');
  }
  console.log('═'.repeat(60));

  // Note: Vector DB init moved to saveLearningFromDistill (SQLite-first pattern)

  let sessions: SessionRecord[] = [];

  if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage:
  bun memory distill                     # From last session (heuristic)
  bun memory distill --smart             # Use Claude Sonnet for extraction
  bun memory distill --smart --dedupe    # Also run smart deduplication
  bun memory distill session_123         # From specific session
  bun memory distill --last 5            # From last N sessions
  bun memory distill --all               # From ALL sessions
  bun memory distill --yes               # Auto-accept all suggestions
  bun memory distill --all --yes         # Distill all with auto-accept

Options:
  --smart      Use Claude Sonnet for higher-quality extraction
  --dedupe     Run smart deduplication after extraction (requires --smart)
  --yes, -y    Auto-accept all suggestions (no prompts)
  --all        Process ALL sessions (use with --yes for batch mode)

This extracts learnings, wins, and challenges from session context
and saves them as proper learnings with category and confidence.

Smart mode uses Claude Sonnet to extract more nuanced learnings with:
- Reasoning: Why this learning matters
- Applicability: When to apply this
- Counterexamples: When NOT to apply
- Related concepts: Links to other knowledge
`);
    return;
  }

  if (args[0] === '--all' || args.includes('--all')) {
    sessions = listSessionsFromDb({ limit: 10000 }); // Effectively all
    console.log(`\nDistilling from ALL ${sessions.length} session(s)...\n`);
  } else if (args[0] === '--last') {
    const count = parseInt(args[1] ?? '5') || 5;
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
    if (useSmartMode) {
      await smartDistillSession(session);
    } else {
      await distillSession(session);
    }
  }

  // Run smart deduplication if requested
  if (runDedupe && useSmartMode) {
    console.log('\n🔍 Running Smart Deduplication...\n');
    console.log('─'.repeat(60));

    const dedupeStats = await runSmartConsolidation({
      dryRun: !autoAccept,  // Dry run unless --yes
      minSimilarity: 0.85,
      limit: 20,
    });

    console.log(`\n   Candidates found: ${dedupeStats.candidatesFound}`);
    console.log(`   Duplicates detected: ${dedupeStats.totalDuplicates}`);
    if (!autoAccept) {
      console.log('   (Dry run - use --yes to merge)');
    } else {
      console.log(`   Merged: ${dedupeStats.merged}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('\n✅ Distillation complete!\n');
}

/**
 * Smart distill using Claude Sonnet
 */
async function smartDistillSession(session: SessionRecord) {
  console.log(`\n🧠 Session: ${session.id}`);
  console.log(`   Summary: ${session.summary?.substring(0, 60)}...`);
  console.log('─'.repeat(60));

  if (!session.full_context) {
    console.log('\n   No context to distill.\n');
    return;
  }

  // Build content from session context
  const ctx = session.full_context as any;
  const contentParts: string[] = [];

  if (session.summary) contentParts.push(`## Summary\n${session.summary}`);
  if (Array.isArray(ctx.wins)) contentParts.push(`## Wins\n${ctx.wins.map((w: string) => `- ${w}`).join('\n')}`);
  if (Array.isArray(ctx.challenges)) contentParts.push(`## Challenges\n${ctx.challenges.map((c: string) => `- ${c}`).join('\n')}`);
  if (Array.isArray(ctx.learnings)) contentParts.push(`## Learnings\n${ctx.learnings.map((l: string) => `- ${l}`).join('\n')}`);
  if (Array.isArray(ctx.nextSteps)) contentParts.push(`## Next Steps\n${ctx.nextSteps.map((n: string) => `- ${n}`).join('\n')}`);

  const content = contentParts.join('\n\n');

  if (!content.trim()) {
    console.log('\n   No content to distill.\n');
    return;
  }

  console.log('\n   🔄 Analyzing with Claude Sonnet...');

  try {
    const result = await smartDistill(content, {
      sourcePath: `session:${session.id}`,
      maxLearnings: 10,
    });

    if (result.learnings.length === 0) {
      console.log('   No learnings extracted.\n');
      return;
    }

    console.log(`\n   Found ${result.learnings.length} learning(s):\n`);

    let saved = 0;

    for (let i = 0; i < result.learnings.length; i++) {
      const learning = result.learnings[i]!;
      const icon = CATEGORY_ICONS[learning.category as Category] || '📝';

      console.log(`   ${i + 1}. ${icon} [${learning.category}] ${learning.title}`);
      if (learning.reasoning) {
        console.log(`      └─ ${learning.reasoning}`);
      }

      let shouldSave = autoAccept;

      if (!autoAccept) {
        const answer = await prompt(`      Save? [Y/n/s(kip all)] `);
        const lower = answer.toLowerCase();

        if (lower === 's') {
          console.log('\n   Skipping remaining learnings.\n');
          break;
        }
        if (lower === 'n') continue;
        shouldSave = true;
      }

      if (shouldSave) {
        // Build structured learning
        const structuredLearning: StructuredLearning = {
          title: learning.title,
          what_happened: learning.reasoning,
          lesson: learning.lesson,
          prevention: learning.applicability?.join('; '),
        };

        const learningId = await saveLearningFromDistill(
          learning.category as Category,
          structuredLearning,
          session.id,
          `Smart distilled from session ${session.id}. ` +
          (learning.relatedConcepts?.length ? `Related: ${learning.relatedConcepts.join(', ')}` : '')
        );

        console.log(`      ✅ Saved as learning #${learningId}`);
        saved++;
      }
    }

    console.log(`\n   📊 Saved ${saved} of ${result.learnings.length} learnings (${result.stats.itemsAnalyzed} lines analyzed).\n`);
  } catch (error) {
    console.error(`   ❌ Smart distill failed: ${error}`);
    console.log('   Falling back to heuristic mode...\n');
    await distillSession(session);
  }
}

main().catch(console.error);
