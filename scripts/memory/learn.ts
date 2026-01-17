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

async function saveLearning(category: Category, title: string, context?: string, description?: string) {
  console.log('\n💾 Saving learning...\n');

  await initVectorDB();

  const agentIdStr = process.env.MEMORY_AGENT_ID;
  const agentId = agentIdStr ? parseInt(agentIdStr) : null;

  // All quick learnings start at 'low' - use 'bun memory save' for medium confidence
  const defaultConfidence = 'low';

  // 1. Save to SQLite
  const learningId = createLearning({
    category,
    title,
    description,
    context,
    confidence: defaultConfidence,
    agent_id: agentId,
    visibility: agentId === null ? 'public' : 'private',
  });

  // 2. Save to ChromaDB
  const searchText = `${title} ${description || ''} ${context || ''}`;
  await saveLearningToChroma(learningId, title, description || context || '', {
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
  console.log(`  Title:      ${title}`);
  if (context) console.log(`  Context:    ${context}`);
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

  const title = await prompt('Title (what you learned): ');
  if (!title) {
    console.error('\n❌ Title is required\n');
    process.exit(1);
  }

  const context = await prompt('Context (when/why this applies, optional): ');
  const description = await prompt('Details (optional, for deeper explanation): ');

  await saveLearning(category, title, context || undefined, description || undefined);
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
  bun memory learn --interactive

Options:
  --interactive, -i   Interactive mode with prompts
  --help, -h          Show this help

Quick Examples:
  bun memory learn tooling "jq parses JSON in shell" "Use with Claude statusline"
  bun memory learn philosophy "Simplicity over cleverness" "Code should be readable first"
  bun memory learn insight "Tests document behavior" "Not just for catching bugs"
  bun memory learn pattern "Feature creep from trying to help" "Stay focused on the ask"
`);
    printCategories();
    return;
  }

  const category = args[0]?.toLowerCase() as Category;
  const title = args[1];
  const context = args[2];

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

  await saveLearning(category, title, context);
}

main().catch(console.error);
