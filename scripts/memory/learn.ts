#!/usr/bin/env bun
/**
 * /learn - Capture learnings, insights, and wisdom
 *
 * Usage:
 *   bun memory learn <category> "title" ["context"]
 *   bun memory learn --interactive
 *
 * Categories:
 *   Technical: performance, architecture, tooling, debugging, security, testing
 *   Wisdom:    philosophy, principle, insight, pattern, retrospective
 */

import { initVectorDB, saveLearning as saveLearningToChroma, findSimilarLearnings } from '../../src/vector-db';
import { createLearning, createLearningLink } from '../../src/db';
import * as readline from 'readline';

const TECHNICAL_CATEGORIES = ['performance', 'architecture', 'tooling', 'debugging', 'security', 'testing', 'process'] as const;
const WISDOM_CATEGORIES = ['philosophy', 'principle', 'insight', 'pattern', 'retrospective'] as const;
const ALL_CATEGORIES = [...TECHNICAL_CATEGORIES, ...WISDOM_CATEGORIES] as const;

type Category = typeof ALL_CATEGORIES[number];

const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  // Technical
  performance: 'Speed, memory, optimization techniques',
  architecture: 'System design, patterns, structure decisions',
  tooling: 'Tools, configs, development environment',
  debugging: 'Problem diagnosis, error patterns, troubleshooting',
  security: 'Security practices, vulnerabilities, hardening',
  testing: 'Test strategies, coverage, quality assurance',
  process: 'Workflow, methodology, collaboration',
  // Wisdom
  philosophy: 'Core beliefs, approaches to work and life',
  principle: 'Guiding rules, non-negotiables, values',
  insight: 'Deep realizations, "aha" moments, understanding',
  pattern: 'Recurring observations across projects/situations',
  retrospective: 'Reflection on past work, lessons from experience',
};

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

function printCategories() {
  console.log('\n📚 Available Categories\n');

  console.log('  Technical:');
  for (const cat of TECHNICAL_CATEGORIES) {
    console.log(`    ${CATEGORY_ICONS[cat]} ${cat.padEnd(14)} - ${CATEGORY_DESCRIPTIONS[cat]}`);
  }

  console.log('\n  Wisdom:');
  for (const cat of WISDOM_CATEGORIES) {
    console.log(`    ${CATEGORY_ICONS[cat]} ${cat.padEnd(14)} - ${CATEGORY_DESCRIPTIONS[cat]}`);
  }
  console.log('');
}

interface StructuredLearningInput {
  title: string;
  context?: string;
  description?: string;
  what_happened?: string;
  lesson?: string;
  prevention?: string;
}

async function saveLearning(category: Category, input: StructuredLearningInput) {
  console.log('\n💾 Saving learning...\n');

  await initVectorDB();

  const agentIdStr = process.env.MEMORY_AGENT_ID;
  const agentId = agentIdStr ? parseInt(agentIdStr) : null;

  // All quick learnings start at 'low' - use 'bun memory save' for medium confidence
  const defaultConfidence = 'low';

  // 1. Save to SQLite with structured fields
  const learningId = createLearning({
    category,
    title: input.title,
    description: input.description,
    context: input.context,
    confidence: defaultConfidence,
    agent_id: agentId,
    visibility: agentId === null ? 'public' : 'private',
    what_happened: input.what_happened,
    lesson: input.lesson,
    prevention: input.prevention,
  });

  // 2. Save to ChromaDB
  const searchText = `${input.title} ${input.lesson || input.description || ''} ${input.what_happened || input.context || ''}`;
  await saveLearningToChroma(learningId, input.title, input.lesson || input.description || input.context || '', {
    category,
    confidence: defaultConfidence,
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
  const { autoLinked, suggested } = await findSimilarLearnings(searchText, autoLinkOptions);

  for (const link of autoLinked) {
    createLearningLink(learningId, parseInt(link.id), 'auto_strong', link.similarity);
  }

  // Output
  console.log(`  ${CATEGORY_ICONS[category]} Learning #${learningId} saved\n`);
  console.log(`  Category:   ${category}`);
  console.log(`  Title:      ${input.title}`);
  if (input.what_happened) console.log(`  What happened: ${input.what_happened}`);
  if (input.lesson) console.log(`  Lesson:     ${input.lesson}`);
  if (input.prevention) console.log(`  Prevention: ${input.prevention}`);
  if (input.context) console.log(`  Context:    ${input.context}`);
  console.log(`  Confidence: ${defaultConfidence}`);

  if (autoLinked.length > 0) {
    console.log(`\n  🔗 Auto-linked to ${autoLinked.length} similar learning(s):`);
    for (const link of autoLinked) {
      console.log(`     → #${link.id} (${(link.similarity * 100).toFixed(0)}% similar)`);
    }
  }

  if (suggested.length > 0) {
    console.log(`\n  💭 Related learnings you might want to link:`);
    for (const s of suggested.slice(0, 3)) {
      console.log(`     #${s.id}: ${s.summary?.substring(0, 50)}...`);
    }
  }

  console.log('\n✅ Learning captured!\n');
}

async function interactiveMode() {
  console.log('\n🧠 Capture Learning\n');
  console.log('═'.repeat(50));

  printCategories();

  const categoryInput = await prompt('Category: ');
  const category = categoryInput.toLowerCase() as Category;

  if (!ALL_CATEGORIES.includes(category)) {
    console.error(`\n❌ Invalid category: ${categoryInput}`);
    console.log('   Use one of the categories listed above.\n');
    process.exit(1);
  }

  const title = await prompt('Title (short description): ');
  if (!title) {
    console.error('\n❌ Title is required\n');
    process.exit(1);
  }

  console.log('\n  📝 Structured Learning Details (all optional):');
  const what_happened = await prompt('  What happened? (situation/context) > ');
  const lesson = await prompt('  What did you learn? (key insight) > ');
  const prevention = await prompt('  How to prevent/apply? (future action) > ');

  await saveLearning(category, {
    title,
    what_happened: what_happened || undefined,
    lesson: lesson || undefined,
    prevention: prevention || undefined,
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--interactive' || args[0] === '-i') {
    await interactiveMode();
    return;
  }

  if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
🧠 Memory Learn - Capture knowledge and wisdom

Usage:
  bun memory learn <category> "title" ["context"]
  bun memory learn <category> "title" --lesson "..." --prevention "..."
  bun memory learn --interactive

Options:
  --interactive, -i   Interactive mode with structured prompts
  --lesson "..."      What you learned (key insight)
  --prevention "..."  How to prevent/apply in future
  --help, -h          Show this help

Quick Examples:
  bun memory learn tooling "jq parses JSON in shell"
  bun memory learn philosophy "Simplicity over cleverness" --lesson "Readable code beats clever code"
  bun memory learn insight "Tests document behavior" --lesson "Tests are documentation" --prevention "Write tests before code"
`);
    printCategories();
    return;
  }

  // Parse args: category, title, and optional flags
  const category = args[0]?.toLowerCase() as Category;
  let title = '';
  let context: string | undefined;
  let lesson: string | undefined;
  let prevention: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--lesson' && args[i + 1]) {
      lesson = args[i + 1];
      i++;
    } else if (args[i] === '--prevention' && args[i + 1]) {
      prevention = args[i + 1];
      i++;
    } else if (!title) {
      title = args[i];
    } else if (!context) {
      context = args[i];
    }
  }

  if (!ALL_CATEGORIES.includes(category)) {
    console.error(`\n❌ Invalid category: ${args[0]}`);
    printCategories();
    process.exit(1);
  }

  if (!title) {
    console.error('\n❌ Title is required');
    console.log('   Usage: bun memory learn <category> "title" ["context"]\n');
    process.exit(1);
  }

  await saveLearning(category, {
    title,
    context,
    lesson,
    prevention,
    what_happened: context, // Use context as what_happened for backward compatibility
  });
}

main().catch(console.error);
