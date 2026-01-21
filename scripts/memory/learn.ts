#!/usr/bin/env bun
/**
 * /learn - Capture learnings, insights, and wisdom
 *
 * Smart Learn - Auto-detects input type:
 *   bun memory learn ./docs/file.md              # → reads file content
 *   bun memory learn https://example.com/article # → fetches URL
 *   bun memory learn https://youtube.com/watch?v=x # → extracts from YouTube
 *   bun memory learn HEAD~3                       # → extracts from git commits
 *   bun memory learn architecture "Manual title"  # → existing category behavior
 *   bun memory learn --interactive               # → interactive mode
 *
 * Categories:
 *   Technical: performance, architecture, tooling, debugging, security, testing
 *   Wisdom:    philosophy, principle, insight, pattern, retrospective
 */

import { initVectorDB, saveLearning as saveLearningToChroma, findSimilarLearnings } from '../../src/vector-db';
import { createLearning, createLearningLink, extractAndLinkEntities } from '../../src/db';
import { distillFromContent } from '../../src/learning/distill-engine';
import { analyzeRepository } from '../../src/learning/code-analyzer';
import * as readline from 'readline';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import { execSync } from 'child_process';

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
  source_url?: string;
  confidence?: 'low' | 'medium' | 'high' | 'proven';
}

// ============ Smart Input Detection ============

type InputType = 'file' | 'url' | 'youtube' | 'git' | 'git_repo' | 'category';

function detectInputType(input: string): InputType {
  // File: exists on disk
  if (existsSync(input)) return 'file';

  // YouTube: youtube.com or youtu.be
  if (/youtube\.com|youtu\.be/i.test(input)) return 'youtube';

  // Git repo URL: ends with .git or SSH-style git@host:user/repo
  if (/^(https?:\/\/|git@).*\.git\b/i.test(input) ||
      /^git@[^:]+:[^\/]+\/[^\/]+$/i.test(input)) return 'git_repo';

  // URL: starts with http
  if (/^https?:\/\//i.test(input)) return 'url';

  // Git: HEAD, commit hash (7-40 hex chars), or ref~N patterns
  if (/^(HEAD|[a-f0-9]{7,40}|[\w\-\/]+~\d+|[\w\-\/]+\^+)$/i.test(input)) return 'git';

  // Default: category (existing behavior)
  return 'category';
}

// ============ Smart Learn Handlers ============

async function learnFromFile(path: string, options?: { deep?: boolean }): Promise<void> {
  console.log(`\n📄 Learning from file: ${path}\n`);

  const content = readFileSync(path, 'utf-8');
  const title = basename(path).replace(/\.[^.]+$/, ''); // Remove extension

  // Remove frontmatter if present
  let cleanContent = content;
  if (content.startsWith('---')) {
    const endFrontmatter = content.indexOf('---', 3);
    if (endFrontmatter > 0) {
      cleanContent = content.substring(endFrontmatter + 3).trim();
    }
  }

  if (options?.deep) {
    // Deep extraction mode: parse and extract individual learnings
    console.log('  🔍 Deep extraction mode...\n');
    const result = distillFromContent(cleanContent, { sourcePath: path });

    console.log(`  📊 Found ${result.learnings.length} learnings in ${result.stats.sectionsProcessed} sections`);
    console.log(`     (analyzed ${result.stats.itemsAnalyzed} items, skipped ${result.stats.skippedLowRelevance} low-relevance)\n`);

    if (result.learnings.length === 0) {
      console.log('  ⚠️  No actionable learnings extracted. Try without --deep for bulk save.\n');
      return;
    }

    for (const learning of result.learnings) {
      await saveLearning(learning.category, {
        title: learning.title,
        what_happened: `Extracted from ${path} (section: ${learning.source_section})`,
        lesson: learning.lesson,
        prevention: learning.prevention,
        source_url: `file://${path}#L${learning.source_line}`,
      });
    }

    console.log(`\n  ✅ Saved ${result.learnings.length} learnings from ${path}\n`);
  } else {
    // Quick save mode: save full content as single learning
    await saveLearning('pattern', {
      title: title,
      what_happened: `Learned from file: ${path}`,
      lesson: cleanContent,
      context: `Source: ${path}`,
      source_url: `file://${path}`,
    });

    const lineCount = cleanContent.split('\n').length;
    console.log(`  📝 Saved full content (${lineCount} lines)\n`);
  }
}

async function learnFromUrl(url: string, options?: { deep?: boolean }): Promise<void> {
  // Auto-convert GitHub blob URLs to raw URLs
  let fetchUrl = url;
  if (url.includes('github.com') && url.includes('/blob/')) {
    fetchUrl = url
      .replace('github.com', 'raw.githubusercontent.com')
      .replace('/blob/', '/');
    console.log(`\n🌐 Learning from URL: ${url}`);
    console.log(`  📎 Converted to raw: ${fetchUrl}\n`);
  } else {
    console.log(`\n🌐 Learning from URL: ${url}\n`);
  }

  try {
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const isRawText = contentType.includes('text/plain') ||
                      fetchUrl.includes('raw.githubusercontent.com') ||
                      !content.includes('<html');

    // For raw text/markdown, save full content
    if (isRawText) {
      const filename = new URL(fetchUrl).pathname.split('/').pop() || 'document';
      const title = filename.replace(/\.[^.]+$/, '');

      // Remove frontmatter if present
      let cleanContent = content;
      if (content.startsWith('---')) {
        const endFrontmatter = content.indexOf('---', 3);
        if (endFrontmatter > 0) {
          cleanContent = content.substring(endFrontmatter + 3).trim();
        }
      }

      if (options?.deep) {
        // Deep extraction mode
        console.log('  🔍 Deep extraction mode...\n');
        const result = distillFromContent(cleanContent, { sourceUrl: url });

        console.log(`  📊 Found ${result.learnings.length} learnings in ${result.stats.sectionsProcessed} sections`);
        console.log(`     (analyzed ${result.stats.itemsAnalyzed} items, skipped ${result.stats.skippedLowRelevance} low-relevance)\n`);

        if (result.learnings.length === 0) {
          console.log('  ⚠️  No actionable learnings extracted. Try without --deep for bulk save.\n');
          return;
        }

        for (const learning of result.learnings) {
          await saveLearning(learning.category, {
            title: learning.title,
            what_happened: `Extracted from ${url} (section: ${learning.source_section})`,
            lesson: learning.lesson,
            prevention: learning.prevention,
            source_url: url,
          });
        }

        console.log(`\n  ✅ Saved ${result.learnings.length} learnings from ${url}\n`);
      } else {
        // Quick save mode
        await saveLearning('pattern', {
          title: `${title}`,
          what_happened: `Learned from URL: ${url}`,
          lesson: cleanContent,
          context: `Source: ${url}`,
          source_url: url,
        });

        const lineCount = cleanContent.split('\n').length;
        console.log(`  📝 Saved full content (${lineCount} lines)\n`);
      }
    } else {
      // HTML page - extract title and description
      const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
      const descMatch = content.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
        || content.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);

      const title = titleMatch?.[1]?.trim() || new URL(url).hostname;
      const description = descMatch?.[1]?.trim() || '';

      // Extract text content (strip tags)
      const textContent = content
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 2000);

      await saveLearning('insight', {
        title: `Web: ${title}`,
        what_happened: `Extracted insights from: ${url}`,
        lesson: description || textContent.substring(0, 500) + '...',
        source_url: url,
      });

      console.log(`  ✅ Saved learning from: ${title}\n`);
    }
  } catch (error) {
    console.error(`  ❌ Failed to fetch URL: ${error}\n`);
    console.log('  💡 Tip: Make sure the URL is accessible and try again.\n');
    process.exit(1);
  }
}

async function learnFromYoutube(url: string): Promise<void> {
  console.log(`\n📺 Learning from YouTube: ${url}\n`);

  // Extract video ID
  const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (!videoIdMatch) {
    console.error('  ❌ Could not extract YouTube video ID\n');
    process.exit(1);
  }

  const videoId = videoIdMatch[1];
  console.log(`  🎬 Video ID: ${videoId}`);

  // Try to get video info from oEmbed (no API key required)
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(oembedUrl);
    const data = await response.json() as { title: string; author_name: string };

    await saveLearning('insight', {
      title: `YouTube: ${data.title}`,
      what_happened: `Watched YouTube video by ${data.author_name}`,
      lesson: 'Video content - add your key takeaways manually',
      source_url: url,
      context: `Video: ${data.title} by ${data.author_name}`,
    });

    console.log(`\n  ✅ Created placeholder learning for: ${data.title}`);
    console.log(`  📝 Edit the learning to add your key takeaways\n`);
  } catch (error) {
    // Fallback: save with URL only
    await saveLearning('insight', {
      title: `YouTube: ${videoId}`,
      what_happened: `Watched YouTube video`,
      lesson: 'Video content - add your key takeaways manually',
      source_url: url,
    });

    console.log(`\n  ✅ Created placeholder learning for video: ${videoId}`);
    console.log(`  📝 Edit the learning to add your key takeaways\n`);
  }
}

async function learnFromGit(ref: string): Promise<void> {
  console.log(`\n📜 Learning from git: ${ref}\n`);

  try {
    // Get commit log
    const logOutput = execSync(`git log ${ref} --oneline -n 10`, { encoding: 'utf-8' });
    const commits = logOutput.trim().split('\n');

    console.log(`  Found ${commits.length} commit(s):\n`);
    for (const commit of commits) {
      console.log(`    ${commit}`);
    }

    // Extract learnings from commit messages
    const learnings: string[] = [];
    for (const commit of commits) {
      const match = commit.match(/^[a-f0-9]+\s+(.+)$/);
      if (match) {
        const msg = match[1]!;
        // Skip merge commits and trivial commits
        if (!msg.toLowerCase().startsWith('merge') && msg.length > 10) {
          learnings.push(msg);
        }
      }
    }

    if (learnings.length === 0) {
      console.log('\n  ⚠️  No significant commits found\n');
      return;
    }

    // Get diff stats for context
    let diffStats = '';
    try {
      diffStats = execSync(`git diff ${ref} --stat | tail -1`, { encoding: 'utf-8' }).trim();
    } catch { /* ignore */ }

    await saveLearning('retrospective', {
      title: `Git learnings from: ${ref}`,
      what_happened: `Analyzed ${commits.length} commit(s) from ${ref}`,
      lesson: learnings.slice(0, 5).join(' | '),
      context: diffStats ? `Changes: ${diffStats}` : undefined,
    });

    console.log(`\n  ✅ Extracted ${learnings.length} learning(s) from git history\n`);
  } catch (error) {
    console.error(`  ❌ Git command failed: ${error}\n`);
    console.log('  💡 Tip: Make sure you\'re in a git repository and the ref is valid.\n');
    process.exit(1);
  }
}

async function learnFromGitRepo(repoUrl: string, options?: { deep?: boolean }): Promise<void> {
  console.log(`\n📦 Learning from git repository: ${repoUrl}\n`);

  // Extract repo name from URL
  const repoNameMatch = repoUrl.match(/\/([^\/]+?)(\.git)?$/);
  const repoName = repoNameMatch?.[1]?.replace(/\.git$/, '') || 'repo';

  try {
    // Step 1: Clone with ghq
    console.log(`  📥 Cloning with ghq...`);
    execSync(`ghq get ${repoUrl}`, { encoding: 'utf-8', stdio: 'inherit' });

    // Step 2: Find the cloned path (use exact match on repo name at end of path)
    const ghqPath = execSync(`ghq list -p | grep -E "/${repoName}$" | head -1`, { encoding: 'utf-8' }).trim();

    if (!ghqPath) {
      throw new Error('Could not find cloned repository path');
    }

    console.log(`  📁 Cloned to: ${ghqPath}`);

    // Step 3: Create symlink to exploring directory (if it exists)
    const exploringDir = `${process.env.HOME}/workspace/exploring`;
    if (existsSync(exploringDir)) {
      const symlinkPath = `${exploringDir}/${repoName}`;
      if (!existsSync(symlinkPath)) {
        execSync(`ln -s "${ghqPath}" "${symlinkPath}"`, { encoding: 'utf-8' });
        console.log(`  🔗 Symlinked to: ${symlinkPath}`);
      } else {
        // Verify symlink points to correct target
        try {
          const currentTarget = execSync(`readlink "${symlinkPath}"`, { encoding: 'utf-8' }).trim();
          if (currentTarget !== ghqPath) {
            console.log(`  ⚠️  Symlink exists but points to: ${currentTarget}`);
            console.log(`  🔗 Expected: ${ghqPath}`);
          } else {
            console.log(`  🔗 Symlink verified: ${symlinkPath}`);
          }
        } catch {
          console.log(`  🔗 Symlink exists: ${symlinkPath}`);
        }
      }
    }

    // Step 4: Learn from markdown files
    if (options?.deep) {
      // Deep mode: scan all markdown files in the repo
      console.log(`\n  🔍 Deep mode: scanning all markdown files...\n`);

      const findMdFiles = execSync(
        `find "${ghqPath}" -name "*.md" -type f ! -path "*/node_modules/*" ! -path "*/.git/*" | head -20`,
        { encoding: 'utf-8' }
      ).trim();

      const mdFiles = findMdFiles ? findMdFiles.split('\n').filter(f => f) : [];

      if (mdFiles.length === 0) {
        console.log('  ⚠️  No markdown files found\n');
        await saveLearning('tooling', {
          title: `Cloned: ${repoName}`,
          what_happened: `Cloned git repository: ${repoUrl}`,
          lesson: `Repository available at ${ghqPath}`,
          context: `Source: ${repoUrl}`,
          source_url: repoUrl,
        });
      } else {
        console.log(`  📚 Found ${mdFiles.length} markdown file(s)\n`);

        let totalLearnings = 0;
        for (const mdFile of mdFiles) {
          const relativePath = mdFile.replace(ghqPath + '/', '');
          console.log(`  ━━━ ${relativePath} ━━━`);

          // Use deep extraction on each file
          const content = readFileSync(mdFile, 'utf-8');
          let cleanContent = content;
          if (content.startsWith('---')) {
            const endFrontmatter = content.indexOf('---', 3);
            if (endFrontmatter > 0) {
              cleanContent = content.substring(endFrontmatter + 3).trim();
            }
          }

          const result = distillFromContent(cleanContent, { sourcePath: mdFile });

          if (result.learnings.length > 0) {
            console.log(`     Found ${result.learnings.length} learnings\n`);

            for (const learning of result.learnings) {
              await saveLearning(learning.category, {
                title: learning.title,
                what_happened: `Extracted from ${repoName}/${relativePath} (section: ${learning.source_section})`,
                lesson: learning.lesson,
                prevention: learning.prevention,
                source_url: `${repoUrl.replace('.git', '')}/blob/main/${relativePath}#L${learning.source_line}`,
              });
              totalLearnings++;
            }
          } else {
            console.log(`     No actionable learnings\n`);
          }
        }

        console.log(`\n  ✅ Extracted ${totalLearnings} learnings from ${mdFiles.length} markdown files\n`);
      }

      // Step 5: Analyze source code
      console.log(`  🔬 Analyzing source code...\n`);
      const codeAnalysis = analyzeRepository(ghqPath, { maxFiles: 30 });

      console.log(`     Files analyzed: ${codeAnalysis.stats.filesAnalyzed}`);
      console.log(`     Patterns found: ${codeAnalysis.stats.patternsFound}`);
      console.log(`     Gems found: ${codeAnalysis.stats.gemsFound}\n`);

      let codeLearnings = 0;
      for (const learning of codeAnalysis.learnings) {
        await saveLearning(learning.category, {
          title: learning.title,
          what_happened: `Code analysis: ${repoName}/${learning.source_file}`,
          lesson: learning.lesson,
          source_url: learning.source_line
            ? `${repoUrl.replace('.git', '')}/blob/main/${learning.source_file}#L${learning.source_line}`
            : `${repoUrl.replace('.git', '')}/blob/main/${learning.source_file}`,
        });
        codeLearnings++;
      }

      console.log(`\n  ✅ Extracted ${codeLearnings} learnings from source code\n`);
    } else {
      // Quick mode: just README
      const readmePath = `${ghqPath}/README.md`;
      if (existsSync(readmePath)) {
        console.log(`\n  📄 Found README.md, learning from it...`);
        await learnFromFile(readmePath);
      } else {
        await saveLearning('tooling', {
          title: `Cloned: ${repoName}`,
          what_happened: `Cloned git repository: ${repoUrl}`,
          lesson: `Repository available at ${ghqPath}`,
          context: `Source: ${repoUrl}`,
          source_url: repoUrl,
        });
      }
    }

    console.log(`\n  ✅ Repository ready for exploration at: ${ghqPath}\n`);
    console.log(`  💡 Tip: Use 'bun memory learn ${ghqPath}/path/to/file.md --deep' for more files\n`);
  } catch (error) {
    console.error(`  ❌ Failed to clone repository: ${error}\n`);
    console.log(`  💡 Tip: Make sure ghq is installed (brew install ghq) and the URL is valid.\n`);
    process.exit(1);
  }
}

async function saveLearning(category: Category, input: StructuredLearningInput) {
  console.log('\n💾 Saving learning...\n');

  const agentIdStr = process.env.MEMORY_AGENT_ID;
  const agentId = agentIdStr ? parseInt(agentIdStr) : null;
  const confidence = input.confidence || 'low';

  // 1. Save to SQLite FIRST (fast, always works)
  const learningId = createLearning({
    category,
    title: input.title,
    description: input.description,
    context: input.context,
    confidence: confidence,
    agent_id: agentId,
    visibility: agentId === null ? 'public' : 'private',
    what_happened: input.what_happened,
    lesson: input.lesson,
    prevention: input.prevention,
    source_url: input.source_url,
  });

  // 2. Extract and link entities (SQLite only, fast)
  const entityText = `${input.title} ${input.lesson || ''} ${input.prevention || ''}`;
  const entities = extractAndLinkEntities(learningId, entityText);

  // 3. Try vector operations (may fail/timeout, that's OK)
  let autoLinked: Array<{ id: string; similarity: number }> = [];
  let suggested: Array<{ id: string; similarity: number }> = [];

  try {
    await initVectorDB();

    const searchText = `${input.title} ${input.lesson || input.description || ''} ${input.what_happened || input.context || ''}`;
    await saveLearningToChroma(learningId, input.title, input.lesson || input.description || input.context || '', {
      category,
      confidence: confidence,
      created_at: new Date().toISOString(),
      agent_id: agentId,
      visibility: agentId === null ? 'public' : 'private',
    });

    const autoLinkOptions: { excludeId: number; agentId?: number; crossAgentLinking: boolean } = {
      excludeId: learningId,
      crossAgentLinking: false,
    };
    if (agentId !== null) {
      autoLinkOptions.agentId = agentId;
    }
    const linkResult = await findSimilarLearnings(searchText, autoLinkOptions);
    autoLinked = linkResult.autoLinked;
    suggested = linkResult.suggested;

    for (const link of autoLinked) {
      createLearningLink(learningId, parseInt(link.id), 'auto_strong', link.similarity);
    }
  } catch (error) {
    console.log('  ⚠ Vector indexing skipped (can rebuild later with: bun memory reindex)');
  }

  // Output
  console.log(`  ${CATEGORY_ICONS[category]} Learning #${learningId} saved\n`);
  console.log(`  Category:   ${category}`);
  console.log(`  Title:      ${input.title}`);
  if (input.what_happened) console.log(`  What happened: ${input.what_happened}`);
  if (input.lesson) console.log(`  Lesson:     ${input.lesson}`);
  if (input.prevention) console.log(`  Prevention: ${input.prevention}`);
  if (input.source_url) console.log(`  Source:     ${input.source_url}`);
  if (input.context) console.log(`  Context:    ${input.context}`);
  console.log(`  Confidence: ${confidence}`);
  if (entities.length > 0) console.log(`  Entities:   ${entities.slice(0, 10).join(', ')}${entities.length > 10 ? '...' : ''}`);

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
🧠 Memory Learn - Smart Knowledge Capture

Smart Mode (auto-detects input type):
  bun memory learn ./docs/file.md              # Learn from file (bulk save)
  bun memory learn ./docs/file.md --deep       # Extract individual learnings
  bun memory learn https://example.com/article # Learn from URL
  bun memory learn https://youtube.com/watch?v=x # Learn from YouTube
  bun memory learn HEAD~3                       # Learn from git commits
  bun memory learn https://github.com/u/r.git  # Clone repo with ghq + learn

Traditional Mode:
  bun memory learn <category> "title" ["context"]
  bun memory learn <category> "title" --lesson "..." --prevention "..."
  bun memory learn --interactive

Options:
  --deep, -d          Extract individual learnings from markdown (vs bulk save)
  --interactive, -i   Interactive mode with structured prompts
  --lesson "..."      What you learned (key insight)
  --prevention "..."  How to prevent/apply in future
  --source "URL"      External reference URL (article, paper, etc.)
  --confidence <lvl>  Confidence level: low, medium, high, proven (default: low)
  --help, -h          Show this help

Quick Examples:
  bun memory learn ./README.md                  # Bulk save file content
  bun memory learn ./README.md --deep           # Extract learnings from sections
  bun memory learn HEAD~5                       # Last 5 commits
  bun memory learn tooling "jq parses JSON"    # Traditional category mode
`);
    printCategories();
    return;
  }

  // Check for --deep flag
  const deepMode = args.includes('--deep') || args.includes('-d');
  const filteredArgs = args.filter(a => a !== '--deep' && a !== '-d');

  // Smart detection: check if first arg is file/url/youtube/git
  const firstArg = filteredArgs[0]!;
  const inputType = detectInputType(firstArg);

  if (inputType !== 'category') {
    // Smart mode: auto-detect and process
    switch (inputType) {
      case 'file':
        await learnFromFile(firstArg, { deep: deepMode });
        return;
      case 'url':
        await learnFromUrl(firstArg, { deep: deepMode });
        return;
      case 'youtube':
        await learnFromYoutube(firstArg);
        return;
      case 'git':
        await learnFromGit(firstArg);
        return;
      case 'git_repo':
        await learnFromGitRepo(firstArg, { deep: deepMode });
        return;
    }
  }

  // Traditional mode: category + title
  const category = args[0]?.toLowerCase() as Category;
  let title = '';
  let context: string | undefined;
  let lesson: string | undefined;
  let prevention: string | undefined;
  let source_url: string | undefined;
  let confidence: 'low' | 'medium' | 'high' | 'proven' | undefined;

  const validConfidenceLevels = ['low', 'medium', 'high', 'proven'];

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--lesson' && args[i + 1]) {
      lesson = args[i + 1];
      i++;
    } else if (args[i] === '--prevention' && args[i + 1]) {
      prevention = args[i + 1];
      i++;
    } else if (args[i] === '--source' && args[i + 1]) {
      source_url = args[i + 1];
      i++;
    } else if (args[i] === '--confidence' && args[i + 1]) {
      const level = args[i + 1]!.toLowerCase();
      if (validConfidenceLevels.includes(level)) {
        confidence = level as 'low' | 'medium' | 'high' | 'proven';
      } else {
        console.warn(`⚠️  Invalid confidence level: ${args[i + 1]}. Using 'low'. Valid: ${validConfidenceLevels.join(', ')}`);
      }
      i++;
    } else if (!title) {
      title = args[i]!;
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
    source_url,
    confidence,
    what_happened: context, // Use context as what_happened for backward compatibility
  });
}

main().catch(console.error);
