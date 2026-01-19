#!/usr/bin/env bun
/**
 * Stress Test: Explore Oracle-v2 + Feed Learning Loop
 *
 * 1. Scans Oracle-v2 repo for interesting patterns
 * 2. Creates missions based on findings
 * 3. Runs missions through learning loop
 * 4. Verifies learnings accumulate correctly
 */

import { LearningLoop } from '../src/learning/loop';
import { initVectorDB, getCollectionStats } from '../src/vector-db';
import { listLearningsFromDb, listKnowledge, listLessons } from '../src/db';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';

const REPOS_TO_EXPLORE = [
  '/Users/jarkius/workspace/exploring/oracle-v2',
  '/Users/jarkius/workspace/exploring/oracle-framework',
  '/Users/jarkius/workspace/exploring/nat-agents-core',
  '/Users/jarkius/workspace/exploring/opensource-nat-brain-oracle',
  '/Users/jarkius/workspace/exploring/ralph-claude-code',
];

const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

interface FileInfo {
  path: string;
  name: string;
  size: number;
  ext: string;
}

interface Mission {
  id: string;
  prompt: string;
  type: 'extraction' | 'analysis' | 'synthesis' | 'review';
  output?: string;
  success: boolean;
  error?: { code: string; message: string };
}

// ─────────────────────────────────────────────────────────────
// Phase 1: Explore Oracle-v2
// ─────────────────────────────────────────────────────────────

async function exploreDirectory(dir: string, files: FileInfo[] = []): Promise<FileInfo[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    if (entry.isDirectory()) {
      await exploreDirectory(fullPath, files);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (['.ts', '.tsx', '.md', '.json'].includes(ext)) {
        const stats = await stat(fullPath);
        files.push({
          path: fullPath,
          name: entry.name,
          size: stats.size,
          ext,
        });
      }
    }
  }

  return files;
}

async function extractPatterns(file: FileInfo): Promise<string[]> {
  const patterns: string[] = [];

  try {
    const content = await readFile(file.path, 'utf-8');

    // Extract comments with insights
    const insightPatterns = [
      /\/\/\s*(Key insight|Important|Note|TODO|FIXME|Learning|Pattern):\s*(.+)/gi,
      /\/\*\*?\s*\n?\s*\*?\s*(Key insight|Important|Note|Learning|Pattern):\s*(.+)/gi,
      />\s*(Key insight|Important|Note|Learning):\s*(.+)/gi,
    ];

    for (const pattern of insightPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        patterns.push(match[2]?.trim() || match[1]?.trim());
      }
    }

    // Extract function names with descriptive comments
    const funcPattern = /\/\*\*\s*\n\s*\*\s*(.+)\s*\n[\s\S]*?\*\/\s*\n\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
    const funcMatches = content.matchAll(funcPattern);
    for (const match of funcMatches) {
      patterns.push(`Function ${match[2]}: ${match[1]}`);
    }

    // Extract interface/type definitions
    const typePattern = /(?:export\s+)?(?:interface|type)\s+(\w+)\s*[={<]/g;
    const typeMatches = content.matchAll(typePattern);
    for (const match of typeMatches) {
      patterns.push(`Type definition: ${match[1]}`);
    }

  } catch (e) {
    // Ignore read errors
  }

  return patterns.slice(0, 5); // Limit per file
}

// ─────────────────────────────────────────────────────────────
// Phase 2: Generate Missions
// ─────────────────────────────────────────────────────────────

function generateMissions(files: FileInfo[], patterns: Map<string, string[]>): Mission[] {
  const missions: Mission[] = [];
  const timestamp = Date.now();

  // Mission types based on file analysis
  const missionTemplates = [
    // Extraction missions
    { type: 'extraction' as const, template: 'Extract key patterns from {file}', successRate: 0.9 },
    { type: 'extraction' as const, template: 'Parse and index {file} for searchable content', successRate: 0.85 },

    // Analysis missions
    { type: 'analysis' as const, template: 'Analyze architecture of {file}', successRate: 0.8 },
    { type: 'analysis' as const, template: 'Review code quality in {file}', successRate: 0.75 },

    // Synthesis missions
    { type: 'synthesis' as const, template: 'Synthesize learnings from {file} patterns', successRate: 0.7 },
    { type: 'synthesis' as const, template: 'Generate documentation for {file}', successRate: 0.65 },

    // Review missions
    { type: 'review' as const, template: 'Review and validate patterns in {file}', successRate: 0.85 },
  ];

  // Generate missions for interesting files
  const interestingFiles = files
    .filter(f => f.size > 500 && f.size < 100000)
    .sort((a, b) => b.size - a.size)
    .slice(0, 30); // Top 30 files

  for (let i = 0; i < interestingFiles.length; i++) {
    const file = interestingFiles[i];
    const template = missionTemplates[i % missionTemplates.length];
    const filePatterns = patterns.get(file.path) || [];

    const success = Math.random() < template.successRate;

    const mission: Mission = {
      id: `stress-${timestamp}-${i}`,
      prompt: template.template.replace('{file}', file.name),
      type: template.type,
      success,
    };

    if (success) {
      // Generate realistic output with insights that match extractInsights patterns
      // Patterns: learned|discovered|realized|found that|key insight|important
      //           best practice|recommendation|tip
      //           should|must|always|never
      const insightPhrases = [
        'I learned that',
        'Key insight:',
        'I discovered that',
        'I realized that',
        'Best practice:',
        'Important:',
        'Recommendation:',
        'You should always',
        'You must',
        'Never',
      ];

      const insights = filePatterns.length > 0
        ? filePatterns.map((p, i) => `${insightPhrases[i % insightPhrases.length]} ${p}.`).join('\n')
        : `I learned that ${file.name} has good structure. Key insight: ${file.ext === '.ts' ? 'TypeScript provides better type safety than JavaScript' : 'Documentation should be kept close to code'}. You should always follow these patterns.`;

      mission.output = `Completed ${template.type} of ${file.name}.\n\n${insights}\n\nI discovered that ${file.ext === '.ts' ? 'type definitions improve code quality significantly' : 'markdown documentation helps onboarding'}.`;
    } else {
      // Generate realistic failure
      const errors = [
        { code: 'timeout', message: `Processing ${file.name} exceeded timeout` },
        { code: 'validation', message: `Invalid format in ${file.name}` },
        { code: 'resource', message: `Insufficient memory for ${file.name}` },
      ];
      mission.error = errors[Math.floor(Math.random() * errors.length)];
    }

    missions.push(mission);
  }

  return missions;
}

// ─────────────────────────────────────────────────────────────
// Phase 3: Run Through Learning Loop
// ─────────────────────────────────────────────────────────────

async function runMissionsThroughLoop(missions: Mission[], loop: LearningLoop): Promise<{
  completed: number;
  failed: number;
  learningsHarvested: number;
  failuresAnalyzed: number;
}> {
  let completed = 0;
  let failed = 0;
  let learningsHarvested = 0;
  let failuresAnalyzed = 0;

  for (const mission of missions) {
    if (mission.success && mission.output) {
      // Process as completed mission
      const completedMission = {
        id: mission.id,
        prompt: mission.prompt,
        type: mission.type,
        assignedTo: Math.floor(Math.random() * 5) + 1,
        status: 'completed' as const,
        result: { output: mission.output, durationMs: Math.floor(Math.random() * 10000) + 1000 },
        createdAt: new Date(),
        completedAt: new Date(),
      };

      const learnings = await loop.harvestFromMission(completedMission);
      learningsHarvested += learnings.length;
      completed++;

    } else if (mission.error) {
      // Process as failed mission
      const failedMission = {
        id: mission.id,
        prompt: mission.prompt,
        type: mission.type,
        assignedTo: Math.floor(Math.random() * 5) + 1,
        status: 'failed' as const,
        error: {
          code: mission.error.code as any,
          message: mission.error.message,
          recoverable: mission.error.code !== 'validation',
          timestamp: new Date(),
        },
        createdAt: new Date(),
      };

      await loop.analyzeFailure(failedMission);
      failuresAnalyzed++;
      failed++;
    }
  }

  return { completed, failed, learningsHarvested, failuresAnalyzed };
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log(colors.blue('  STRESS TEST: Explore Oracle-v2 + Learning Loop'));
  console.log('═'.repeat(70) + '\n');

  // Initialize
  console.log(colors.dim('Initializing VectorDB...'));
  await initVectorDB();
  const loop = new LearningLoop();

  // Get initial stats
  const initialLearnings = listLearningsFromDb(1000).length;
  const initialKnowledge = listKnowledge(1000).length;
  const initialLessons = listLessons(1000).length;

  console.log(colors.cyan('\n📊 Initial State:'));
  console.log(`   Learnings: ${initialLearnings}`);
  console.log(`   Knowledge: ${initialKnowledge}`);
  console.log(`   Lessons: ${initialLessons}`);

  // ─────────────────────────────────────────────────────────────
  // Phase 1: Explore All Repositories
  // ─────────────────────────────────────────────────────────────
  console.log(colors.yellow('\n\n▶ PHASE 1: Exploring Repositories'));
  console.log('─'.repeat(60));

  let allFiles: FileInfo[] = [];
  for (const repoPath of REPOS_TO_EXPLORE) {
    const repoName = repoPath.split('/').pop();
    console.log(colors.dim(`\nScanning ${repoName}...`));
    try {
      const repoFiles = await exploreDirectory(repoPath);
      console.log(colors.green(`  ✓ Found ${repoFiles.length} files`));
      allFiles = allFiles.concat(repoFiles);
    } catch (e) {
      console.log(colors.dim(`  (skipped - not found)`));
    }
  }

  const files = allFiles;
  console.log(colors.green(`\n✓ Total: ${files.length} files from ${REPOS_TO_EXPLORE.length} repos`));

  // Group by extension
  const byExt: Record<string, number> = {};
  files.forEach(f => { byExt[f.ext] = (byExt[f.ext] || 0) + 1; });
  console.log('   ' + Object.entries(byExt).map(([ext, count]) => `${ext}: ${count}`).join(', '));

  // Extract patterns
  console.log(colors.dim('\nExtracting patterns from files...'));
  const patterns = new Map<string, string[]>();
  let totalPatterns = 0;

  for (const file of files.slice(0, 50)) { // Limit to 50 files
    const filePatterns = await extractPatterns(file);
    if (filePatterns.length > 0) {
      patterns.set(file.path, filePatterns);
      totalPatterns += filePatterns.length;
    }
  }
  console.log(colors.green(`✓ Extracted ${totalPatterns} patterns from ${patterns.size} files`));

  // Show sample patterns
  if (totalPatterns > 0) {
    console.log(colors.dim('\nSample patterns found:'));
    let shown = 0;
    for (const [path, pats] of patterns) {
      if (shown >= 5) break;
      console.log(`   ${path.split('/').pop()}: "${pats[0]?.slice(0, 60)}..."`);
      shown++;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Phase 2: Generate Missions
  // ─────────────────────────────────────────────────────────────
  console.log(colors.yellow('\n\n▶ PHASE 2: Generating Missions'));
  console.log('─'.repeat(60));

  const missions = generateMissions(files, patterns);
  const successCount = missions.filter(m => m.success).length;
  const failCount = missions.filter(m => !m.success).length;

  console.log(colors.green(`✓ Generated ${missions.length} missions`));
  console.log(`   Expected success: ${successCount} (${(successCount/missions.length*100).toFixed(0)}%)`);
  console.log(`   Expected failure: ${failCount} (${(failCount/missions.length*100).toFixed(0)}%)`);

  // Show mission types
  const byType: Record<string, number> = {};
  missions.forEach(m => { byType[m.type] = (byType[m.type] || 0) + 1; });
  console.log('   Types: ' + Object.entries(byType).map(([t, c]) => `${t}: ${c}`).join(', '));

  // ─────────────────────────────────────────────────────────────
  // Phase 3: Run Through Learning Loop
  // ─────────────────────────────────────────────────────────────
  console.log(colors.yellow('\n\n▶ PHASE 3: Running Missions Through Learning Loop'));
  console.log('─'.repeat(60));

  const startTime = Date.now();
  console.log(colors.dim('Processing missions...'));

  const results = await runMissionsThroughLoop(missions, loop);
  const duration = Date.now() - startTime;

  console.log(colors.green(`\n✓ Completed in ${(duration/1000).toFixed(2)}s`));
  console.log(`   Missions completed: ${results.completed}`);
  console.log(`   Missions failed: ${results.failed}`);
  console.log(`   Learnings harvested: ${results.learningsHarvested}`);
  console.log(`   Failures analyzed: ${results.failuresAnalyzed}`);

  // ─────────────────────────────────────────────────────────────
  // Phase 4: Verify Results
  // ─────────────────────────────────────────────────────────────
  console.log(colors.yellow('\n\n▶ PHASE 4: Verifying Results'));
  console.log('─'.repeat(60));

  const finalLearnings = listLearningsFromDb(1000).length;
  const finalKnowledge = listKnowledge(1000).length;
  const finalLessons = listLessons(1000).length;

  const learningsAdded = finalLearnings - initialLearnings;
  const knowledgeAdded = finalKnowledge - initialKnowledge;
  const lessonsAdded = finalLessons - initialLessons;

  console.log(colors.cyan('📊 Final State:'));
  console.log(`   Learnings: ${finalLearnings} (+${learningsAdded})`);
  console.log(`   Knowledge: ${finalKnowledge} (+${knowledgeAdded})`);
  console.log(`   Lessons: ${finalLessons} (+${lessonsAdded})`);

  // Vector DB stats
  try {
    const vectorStats = await getCollectionStats();
    console.log(colors.cyan('\n📊 Vector Collections:'));
    console.log(`   orchestrator_learnings: ${vectorStats.orchestrator_learnings}`);
    console.log(`   knowledge_entries: ${vectorStats.knowledge_entries}`);
    console.log(`   lesson_entries: ${vectorStats.lesson_entries}`);
  } catch (e) {
    console.log(colors.dim('   (ChromaDB stats unavailable)'));
  }

  // Test suggestions work with new data
  console.log(colors.cyan('\n🔍 Testing Suggestions:'));
  const testPrompts = [
    'Implement MCP server with semantic search',
    'Add Drizzle ORM to database layer',
    'Create React dashboard for visualization',
  ];

  for (const prompt of testPrompts) {
    const suggestions = await loop.suggestLearnings({ prompt });
    console.log(`   "${prompt.slice(0, 40)}..." → ${suggestions.length} suggestions`);
  }

  // ─────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));

  const allPassed = results.learningsHarvested > 0 && results.failuresAnalyzed > 0;

  if (allPassed) {
    console.log(colors.green('  ✓ STRESS TEST PASSED'));
    console.log(colors.green(`    - Processed ${missions.length} missions`));
    console.log(colors.green(`    - Harvested ${results.learningsHarvested} learnings`));
    console.log(colors.green(`    - Analyzed ${results.failuresAnalyzed} failures`));
    console.log(colors.green(`    - Duration: ${(duration/1000).toFixed(2)}s`));
  } else {
    console.log(colors.red('  ✗ STRESS TEST FAILED'));
    console.log(colors.red(`    - Check learning loop configuration`));
  }

  console.log('═'.repeat(70) + '\n');
}

main().catch(console.error);
