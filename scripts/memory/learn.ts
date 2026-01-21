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

async function learnFromFile(path: string): Promise<void> {
  console.log(`\n📄 Learning from file: ${path}\n`);

  const content = readFileSync(path, 'utf-8');
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const title = basename(path).replace(/\.[^.]+$/, '');

  // Remove frontmatter if present (for markdown)
  let cleanContent = content;
  if (content.startsWith('---')) {
    const endFrontmatter = content.indexOf('---', 3);
    if (endFrontmatter > 0) {
      cleanContent = content.substring(endFrontmatter + 3).trim();
    }
  }

  // Smart detection: use the right tool for the file type
  if (ext === 'md' || ext === 'markdown') {
    // Markdown: extract structured learnings
    const result = distillFromContent(cleanContent, { sourcePath: path });

    if (result.learnings.length > 0) {
      console.log(`  📊 Extracted ${result.learnings.length} learnings from ${result.stats.sectionsProcessed} sections\n`);

      for (const learning of result.learnings) {
        await saveLearning(learning.category, {
          title: learning.title,
          what_happened: `Extracted from ${path} (section: ${learning.source_section})`,
          lesson: learning.lesson,
          prevention: learning.prevention,
          source_url: `file://${path}#L${learning.source_line}`,
        });
      }
      console.log(`  ✅ Saved ${result.learnings.length} learnings\n`);
    } else {
      // Fallback: save as reference
      await saveLearning('pattern', {
        title: title,
        what_happened: `Reference from: ${path}`,
        lesson: cleanContent.slice(0, 5000),
        source_url: `file://${path}`,
      });
      console.log(`  📝 Saved as reference (no extractable learnings)\n`);
    }

  } else if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go'].includes(ext)) {
    // Source code: analyze for patterns and gems
    console.log(`  🔬 Analyzing source code...\n`);

    const dir = path.substring(0, path.lastIndexOf('/'));
    const codeAnalysis = analyzeRepository(dir, { maxFiles: 1 });

    // Also extract JSDoc/comments directly from this file
    const patterns = codeAnalysis.learnings.filter(l => l.source_file.endsWith(basename(path)));

    if (patterns.length > 0) {
      console.log(`  Found ${patterns.length} patterns/insights\n`);
      for (const learning of patterns) {
        await saveLearning(learning.category, {
          title: learning.title,
          what_happened: `Code analysis: ${path}`,
          lesson: learning.lesson,
          source_url: `file://${path}#L${learning.source_line || 1}`,
        });
      }
    } else {
      // Save key functions/exports as reference
      await saveLearning('pattern', {
        title: `Code: ${title}`,
        what_happened: `Analyzed source file: ${path}`,
        lesson: `Source file with ${content.split('\n').length} lines`,
        source_url: `file://${path}`,
      });
    }
    console.log(`  ✅ Analysis complete\n`);

  } else {
    // Other files: save as reference
    await saveLearning('pattern', {
      title: title,
      what_happened: `Learned from file: ${path}`,
      lesson: cleanContent.slice(0, 5000),
      context: `Source: ${path}`,
      source_url: `file://${path}`,
    });

    const lineCount = cleanContent.split('\n').length;
    console.log(`  📝 Saved as reference (${lineCount} lines)\n`);
  }
}

async function learnFromUrl(url: string): Promise<void> {
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

    // For raw text/markdown, extract learnings
    if (isRawText) {
      const filename = new URL(fetchUrl).pathname.split('/').pop() || 'document';
      const title = filename.replace(/\.[^.]+$/, '');
      const ext = filename.split('.').pop()?.toLowerCase() || '';

      // Remove frontmatter if present
      let cleanContent = content;
      if (content.startsWith('---')) {
        const endFrontmatter = content.indexOf('---', 3);
        if (endFrontmatter > 0) {
          cleanContent = content.substring(endFrontmatter + 3).trim();
        }
      }

      // Smart extraction based on file type
      if (ext === 'md' || ext === 'markdown' || !ext) {
        const result = distillFromContent(cleanContent, { sourceUrl: url });

        if (result.learnings.length > 0) {
          console.log(`  📊 Extracted ${result.learnings.length} learnings\n`);

          for (const learning of result.learnings) {
            await saveLearning(learning.category, {
              title: learning.title,
              what_happened: `Extracted from ${url} (section: ${learning.source_section})`,
              lesson: learning.lesson,
              prevention: learning.prevention,
              source_url: url,
            });
          }
          console.log(`  ✅ Saved ${result.learnings.length} learnings\n`);
        } else {
          // Fallback: save as reference
          await saveLearning('pattern', {
            title: `${title}`,
            what_happened: `Reference from: ${url}`,
            lesson: cleanContent.slice(0, 5000),
            source_url: url,
          });
          console.log(`  📝 Saved as reference\n`);
        }
      } else {
        // Source code file from URL
        await saveLearning('pattern', {
          title: `Code: ${title}`,
          what_happened: `Source from: ${url}`,
          lesson: cleanContent.slice(0, 5000),
          source_url: url,
        });
        console.log(`  📝 Saved source reference\n`);
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

async function learnFromGitRepo(repoUrl: string): Promise<void> {
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

    // Step 4: Learn from documentation
    console.log(`\n  📚 Scanning documentation...\n`);

    const findMdFiles = execSync(
      `find "${ghqPath}" -name "*.md" -type f ! -path "*/node_modules/*" ! -path "*/.git/*" | head -20`,
      { encoding: 'utf-8' }
    ).trim();

    const mdFiles = findMdFiles ? findMdFiles.split('\n').filter(f => f) : [];
    let docLearnings = 0;

    if (mdFiles.length > 0) {
      console.log(`  Found ${mdFiles.length} markdown file(s)\n`);

      for (const mdFile of mdFiles) {
        const relativePath = mdFile.replace(ghqPath + '/', '');
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
          console.log(`  ━━━ ${relativePath}: ${result.learnings.length} learnings`);

          for (const learning of result.learnings) {
            await saveLearning(learning.category, {
              title: learning.title,
              what_happened: `Extracted from ${repoName}/${relativePath} (section: ${learning.source_section})`,
              lesson: learning.lesson,
              prevention: learning.prevention,
              source_url: `${repoUrl.replace('.git', '')}/blob/main/${relativePath}#L${learning.source_line}`,
            });
            docLearnings++;
          }
        }
      }
    }

    // Step 5: Analyze source code
    console.log(`\n  🔬 Analyzing source code...\n`);
    const codeAnalysis = analyzeRepository(ghqPath, { maxFiles: 30 });

    console.log(`     Files: ${codeAnalysis.stats.filesAnalyzed} | Patterns: ${codeAnalysis.stats.patternsFound} | Gems: ${codeAnalysis.stats.gemsFound}\n`);

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

    console.log(`\n  ✅ Total: ${docLearnings} from docs + ${codeLearnings} from code = ${docLearnings + codeLearnings} learnings\n`);

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

Smart Mode (auto-detects input type and uses best approach):
  bun memory learn ./docs/file.md              # Markdown → extract learnings
  bun memory learn ./src/utils.ts              # Source → analyze patterns
  bun memory learn https://example.com/article # URL → extract content
  bun memory learn https://github.com/u/r.git  # Repo → full analysis (docs + code)
  bun memory learn HEAD~3                       # Git → extract from commits

Traditional Mode:
  bun memory learn <category> "title" ["context"]
  bun memory learn <category> "title" --lesson "..." --prevention "..."
  bun memory learn --interactive

Options:
  --interactive, -i   Interactive mode with structured prompts
  --lesson "..."      What you learned (key insight)
  --prevention "..."  How to prevent/apply in future
  --source "URL"      External reference URL
  --confidence <lvl>  Confidence level: low, medium, high, proven
  --help, -h          Show this help

Examples:
  bun memory learn ./README.md                  # Auto-extracts learnings
  bun memory learn https://github.com/x/y.git  # Clone + analyze entire repo
  bun memory learn HEAD~5                       # Last 5 commits
  bun memory learn tooling "jq parses JSON"    # Manual category mode
`);
    printCategories();
    return;
  }

  // Smart detection: check if first arg is file/url/youtube/git
  const firstArg = args[0]!;
  const inputType = detectInputType(firstArg);

  if (inputType !== 'category') {
    // Smart mode: auto-detect and process
    switch (inputType) {
      case 'file':
        await learnFromFile(firstArg);
        return;
      case 'url':
        await learnFromUrl(firstArg);
        return;
      case 'youtube':
        await learnFromYoutube(firstArg);
        return;
      case 'git':
        await learnFromGit(firstArg);
        return;
      case 'git_repo':
        await learnFromGitRepo(firstArg);
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
