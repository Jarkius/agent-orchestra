/**
 * Code Analyzer - Extract learnings from source code
 *
 * Analyzes actual code to find patterns, architecture decisions,
 * and "gems" - clever solutions worth learning from.
 *
 * Sources of truth in code:
 * - JSDoc comments and docstrings
 * - Function/class names and signatures
 * - Directory structure (architecture)
 * - Package.json (purpose, dependencies)
 * - Config files (tooling decisions)
 * - Meaningful inline comments
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { basename, join, extname, relative } from 'path';
import type { LearningCategory } from '../interfaces/learning';
import { upsertCodePattern, clearPatternsForFile, getPatternStats } from '../db';

// ============ Interfaces ============

export interface CodeLearning {
  title: string;
  category: LearningCategory;
  lesson: string;
  source_file: string;
  source_line?: number;
  confidence: 'low';
  type: 'jsdoc' | 'pattern' | 'architecture' | 'dependency' | 'config' | 'gem';
}

export interface AnalysisResult {
  learnings: CodeLearning[];
  stats: {
    filesAnalyzed: number;
    patternsFound: number;
    gemsFound: number;
  };
}

export interface AnalyzeOptions {
  maxFiles?: number;
  includeTests?: boolean;
  languages?: string[];
}

// ============ File Type Detection ============

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  rust: ['.rs'],
  go: ['.go'],
};

const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  '.eslintrc.json',
  '.prettierrc',
];

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'target'];

// ============ JSDoc/Comment Extraction ============

interface ExtractedComment {
  type: 'jsdoc' | 'block' | 'line' | 'docstring';
  content: string;
  line: number;
  associatedCode?: string;
}

/**
 * Extract JSDoc comments and meaningful block comments from TypeScript/JavaScript
 */
function extractJSDocComments(content: string): ExtractedComment[] {
  const comments: ExtractedComment[] = [];
  const lines = content.split('\n');

  // Match JSDoc: /** ... */
  const jsdocPattern = /\/\*\*[\s\S]*?\*\//g;
  let match;

  while ((match = jsdocPattern.exec(content)) !== null) {
    const beforeMatch = content.slice(0, match.index);
    const lineNumber = beforeMatch.split('\n').length;

    // Get the code that follows this JSDoc
    const afterMatch = content.slice(match.index + match[0].length);
    const nextLineMatch = afterMatch.match(/^\s*\n?\s*(.+)/);
    const associatedCode = nextLineMatch?.[1]?.trim();

    // Clean up JSDoc content
    const cleanContent = match[0]
      .replace(/\/\*\*|\*\//g, '')
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, '').trim())
      .filter(line => line && !line.startsWith('@'))
      .join(' ')
      .trim();

    if (cleanContent.length > 20) {
      comments.push({
        type: 'jsdoc',
        content: cleanContent,
        line: lineNumber,
        associatedCode,
      });
    }
  }

  // Match meaningful single-line comments (TODO, HACK, NOTE, IMPORTANT, etc.)
  const meaningfulLinePattern = /\/\/\s*(TODO|HACK|NOTE|IMPORTANT|FIXME|BUG|OPTIMIZE|WARNING):\s*(.+)/gi;
  while ((match = meaningfulLinePattern.exec(content)) !== null) {
    const beforeMatch = content.slice(0, match.index);
    const lineNumber = beforeMatch.split('\n').length;

    comments.push({
      type: 'line',
      content: `${match[1]}: ${match[2]}`,
      line: lineNumber,
    });
  }

  return comments;
}

/**
 * Extract docstrings from Python files
 */
function extractPythonDocstrings(content: string): ExtractedComment[] {
  const comments: ExtractedComment[] = [];

  // Match triple-quoted strings at the start of functions/classes
  const docstringPattern = /(?:def|class)\s+(\w+)[^:]*:\s*\n\s*("""[\s\S]*?"""|'''[\s\S]*?''')/g;
  let match;

  while ((match = docstringPattern.exec(content)) !== null) {
    const beforeMatch = content.slice(0, match.index);
    const lineNumber = beforeMatch.split('\n').length;

    const cleanContent = match[2]
      .replace(/"""|'''/g, '')
      .trim();

    if (cleanContent.length > 20) {
      comments.push({
        type: 'docstring',
        content: cleanContent,
        line: lineNumber,
        associatedCode: `${match[0].split('\n')[0]}`,
      });
    }
  }

  return comments;
}

// ============ Pattern Detection ============

interface DetectedPattern {
  name: string;
  category: LearningCategory;
  description: string;
  evidence: string;
  line?: number;
}

const CODE_PATTERNS: Array<{
  name: string;
  category: LearningCategory;
  patterns: RegExp[];
  description: string;
}> = [
  {
    name: 'Singleton Pattern',
    category: 'architecture',
    patterns: [/private\s+static\s+instance/, /getInstance\s*\(\)/],
    description: 'Single instance pattern for shared state',
  },
  {
    name: 'Factory Pattern',
    category: 'architecture',
    patterns: [/create\w+\s*\([^)]*\)\s*:\s*\w+/, /factory/i],
    description: 'Factory for creating objects without exposing instantiation logic',
  },
  {
    name: 'Repository Pattern',
    category: 'architecture',
    patterns: [/Repository\s*{/, /findBy\w+/, /getAll\s*\(\)/],
    description: 'Data access abstraction layer',
  },
  {
    name: 'Circuit Breaker',
    category: 'architecture',
    patterns: [/circuitBreaker/i, /isOpen|isClosed|halfOpen/i],
    description: 'Fault tolerance pattern to prevent cascade failures',
  },
  {
    name: 'Retry Logic',
    category: 'debugging',
    patterns: [/retry|maxRetries|retryCount/i, /exponentialBackoff/i],
    description: 'Automatic retry with backoff for transient failures',
  },
  {
    name: 'Error Boundary',
    category: 'debugging',
    patterns: [/ErrorBoundary/, /componentDidCatch/, /onError\s*=/],
    description: 'Graceful error handling that prevents full crashes',
  },
  {
    name: 'Memoization',
    category: 'performance',
    patterns: [/useMemo|useCallback|memo\(/, /memoize|cache\s*=/i],
    description: 'Caching computed values to avoid redundant calculations',
  },
  {
    name: 'Debounce/Throttle',
    category: 'performance',
    patterns: [/debounce|throttle/i, /setTimeout.*clear/],
    description: 'Rate limiting for performance-sensitive operations',
  },
  {
    name: 'Event Emitter',
    category: 'architecture',
    patterns: [/EventEmitter|on\(.*emit\(/, /addEventListener.*dispatch/],
    description: 'Pub/sub pattern for decoupled communication',
  },
  {
    name: 'Middleware Pattern',
    category: 'architecture',
    patterns: [/middleware/i, /next\s*\(\s*\)/, /use\s*\(\s*\w+\s*\)/],
    description: 'Chain of responsibility for request processing',
  },
  {
    name: 'State Machine',
    category: 'architecture',
    patterns: [/state\s*:\s*['"]?\w+['"]?.*transition/i, /StateMachine|states\s*:/],
    description: 'Finite state machine for predictable state transitions',
  },
  {
    name: 'Builder Pattern',
    category: 'architecture',
    patterns: [/\.set\w+\([^)]+\)\s*\.\s*set/, /build\s*\(\s*\)\s*{/],
    description: 'Fluent interface for constructing complex objects',
  },
];

function detectPatterns(content: string, filePath: string): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  for (const pattern of CODE_PATTERNS) {
    for (const regex of pattern.patterns) {
      const match = regex.exec(content);
      if (match) {
        const beforeMatch = content.slice(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        // Avoid duplicates
        if (!patterns.find(p => p.name === pattern.name)) {
          patterns.push({
            name: pattern.name,
            category: pattern.category,
            description: pattern.description,
            evidence: match[0].slice(0, 50),
            line: lineNumber,
          });
        }
        break;
      }
    }
  }

  return patterns;
}

/**
 * Persist detected patterns to the database
 * @param patterns Detected patterns
 * @param codeFileId The code file ID (usually relative file path)
 * @returns Number of patterns persisted
 */
export function persistPatterns(patterns: DetectedPattern[], codeFileId: string): number {
  if (patterns.length === 0) return 0;

  let persisted = 0;
  for (const pattern of patterns) {
    try {
      upsertCodePattern({
        code_file_id: codeFileId,
        pattern_name: pattern.name,
        category: pattern.category,
        description: pattern.description,
        evidence: pattern.evidence,
        line_number: pattern.line,
        confidence: 0.5, // Initial detection confidence
      });
      persisted++;
    } catch (error) {
      console.error(`[CodeAnalyzer] Failed to persist pattern ${pattern.name}:`, error);
    }
  }

  return persisted;
}

/**
 * Detect and persist patterns for a file
 * Combines detection and persistence in one call
 */
export function analyzeAndPersistPatterns(content: string, filePath: string): {
  detected: DetectedPattern[];
  persisted: number;
} {
  const patterns = detectPatterns(content, filePath);
  const persisted = persistPatterns(patterns, filePath);
  return { detected: patterns, persisted };
}

// ============ Gem Detection (Clever Code) ============

interface CodeGem {
  title: string;
  description: string;
  code: string;
  line: number;
  category: LearningCategory;
}

function detectGems(content: string, filePath: string): CodeGem[] {
  const gems: CodeGem[] = [];
  const lines = content.split('\n');

  // Look for well-documented utility functions
  const utilityPattern = /\/\*\*[\s\S]*?\*\/\s*\n\s*(?:export\s+)?(?:function|const)\s+(\w+)/g;
  let match;

  while ((match = utilityPattern.exec(content)) !== null) {
    const jsdoc = match[0].match(/\/\*\*([\s\S]*?)\*\//)?.[1] || '';
    const funcName = match[1];

    // Look for utility-like names
    if (/^(is|has|can|should|get|set|format|parse|validate|transform|convert|create|build|make)/i.test(funcName || '')) {
      const cleanDoc = jsdoc
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(l => l && !l.startsWith('@'))
        .join(' ')
        .trim();

      if (cleanDoc.length > 30) {
        const beforeMatch = content.slice(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        gems.push({
          title: `Utility: ${funcName}`,
          description: cleanDoc,
          code: funcName || '',
          line: lineNumber,
          category: 'tooling',
        });
      }
    }
  }

  // Look for clever one-liners with comments
  const cleverPattern = /\/\/\s*(?:clever|trick|hack|neat|elegant):\s*(.+)\n\s*(.+)/gi;
  while ((match = cleverPattern.exec(content)) !== null) {
    const beforeMatch = content.slice(0, match.index);
    const lineNumber = beforeMatch.split('\n').length;

    gems.push({
      title: 'Clever technique',
      description: match[1],
      code: match[2].trim(),
      line: lineNumber,
      category: 'insight',
    });
  }

  return gems;
}

// ============ Package.json Analysis ============

interface PackageAnalysis {
  purpose?: string;
  keyDependencies: Array<{ name: string; purpose: string }>;
  scripts: Array<{ name: string; command: string }>;
  insights: string[];
}

const KNOWN_DEPENDENCIES: Record<string, string> = {
  // Runtime
  'express': 'HTTP server framework',
  'fastify': 'Fast HTTP server framework',
  'koa': 'Lightweight HTTP middleware framework',
  'hono': 'Ultrafast web framework',
  'bun': 'Fast JavaScript runtime',

  // Database
  'better-sqlite3': 'Synchronous SQLite with good performance',
  'prisma': 'Type-safe ORM with migrations',
  'drizzle-orm': 'Lightweight TypeScript ORM',
  'mongoose': 'MongoDB ODM',
  'pg': 'PostgreSQL client',
  'chromadb': 'Vector database for embeddings',

  // AI/ML
  '@anthropic-ai/sdk': 'Claude API client',
  'openai': 'OpenAI API client',
  '@xenova/transformers': 'Local ML models in JavaScript',
  'langchain': 'LLM application framework',

  // Testing
  'jest': 'JavaScript testing framework',
  'vitest': 'Fast Vite-native testing',
  'playwright': 'Browser automation and testing',
  'cypress': 'E2E testing framework',

  // Build
  'typescript': 'Type-safe JavaScript',
  'esbuild': 'Fast JavaScript bundler',
  'vite': 'Fast dev server and bundler',
  'webpack': 'Module bundler',

  // Utils
  'zod': 'TypeScript-first schema validation',
  'lodash': 'Utility functions',
  'date-fns': 'Date manipulation',
  'chalk': 'Terminal string styling',
};

function analyzePackageJson(packagePath: string): PackageAnalysis | null {
  if (!existsSync(packagePath)) return null;

  try {
    const content = JSON.parse(readFileSync(packagePath, 'utf-8'));
    const analysis: PackageAnalysis = {
      keyDependencies: [],
      scripts: [],
      insights: [],
    };

    // Get purpose from description
    if (content.description) {
      analysis.purpose = content.description;
    }

    // Analyze dependencies
    const allDeps = { ...content.dependencies, ...content.devDependencies };
    for (const [name, version] of Object.entries(allDeps)) {
      if (KNOWN_DEPENDENCIES[name]) {
        analysis.keyDependencies.push({
          name,
          purpose: KNOWN_DEPENDENCIES[name],
        });
      }
    }

    // Extract meaningful scripts
    if (content.scripts) {
      for (const [name, command] of Object.entries(content.scripts)) {
        if (['dev', 'build', 'test', 'start', 'lint'].includes(name)) {
          analysis.scripts.push({ name, command: String(command) });
        }
      }
    }

    // Generate insights
    if (analysis.keyDependencies.find(d => d.name.includes('sqlite'))) {
      analysis.insights.push('Uses SQLite for local/embedded database');
    }
    if (analysis.keyDependencies.find(d => d.name.includes('chroma'))) {
      analysis.insights.push('Uses ChromaDB for vector search');
    }
    if (analysis.keyDependencies.find(d => d.name === 'typescript')) {
      analysis.insights.push('TypeScript project with type safety');
    }
    if (content.type === 'module') {
      analysis.insights.push('ESM modules (modern JavaScript)');
    }

    return analysis;
  } catch {
    return null;
  }
}

// ============ Directory Structure Analysis ============

interface ArchitectureInsight {
  pattern: string;
  description: string;
  evidence: string[];
}

function analyzeDirectoryStructure(repoPath: string): ArchitectureInsight[] {
  const insights: ArchitectureInsight[] = [];

  const topLevelDirs = readdirSync(repoPath)
    .filter(f => {
      const fullPath = join(repoPath, f);
      return statSync(fullPath).isDirectory() && !SKIP_DIRS.includes(f) && !f.startsWith('.');
    });

  // Detect common patterns
  if (topLevelDirs.includes('src')) {
    insights.push({
      pattern: 'Standard src/ layout',
      description: 'Source code separated from config/docs',
      evidence: ['src/'],
    });
  }

  if (topLevelDirs.includes('lib') || topLevelDirs.includes('packages')) {
    insights.push({
      pattern: 'Library/Monorepo structure',
      description: 'Reusable code packaged separately',
      evidence: topLevelDirs.filter(d => ['lib', 'packages'].includes(d)),
    });
  }

  if (topLevelDirs.includes('tests') || topLevelDirs.includes('__tests__')) {
    insights.push({
      pattern: 'Dedicated test directory',
      description: 'Tests separated from source',
      evidence: topLevelDirs.filter(d => d.includes('test')),
    });
  }

  if (topLevelDirs.includes('docs')) {
    insights.push({
      pattern: 'Documentation-first',
      description: 'Dedicated documentation directory',
      evidence: ['docs/'],
    });
  }

  // Check for specific architecture patterns in src/
  const srcPath = join(repoPath, 'src');
  if (existsSync(srcPath)) {
    const srcDirs = readdirSync(srcPath).filter(f => {
      const fullPath = join(srcPath, f);
      return statSync(fullPath).isDirectory();
    });

    if (srcDirs.some(d => ['controllers', 'routes', 'handlers'].includes(d))) {
      insights.push({
        pattern: 'MVC/Handler architecture',
        description: 'Request handlers separated from business logic',
        evidence: srcDirs.filter(d => ['controllers', 'routes', 'handlers'].includes(d)),
      });
    }

    if (srcDirs.some(d => ['services', 'domain'].includes(d))) {
      insights.push({
        pattern: 'Service layer',
        description: 'Business logic encapsulated in services',
        evidence: srcDirs.filter(d => ['services', 'domain'].includes(d)),
      });
    }

    if (srcDirs.some(d => ['models', 'entities', 'schemas'].includes(d))) {
      insights.push({
        pattern: 'Data modeling layer',
        description: 'Explicit data models/schemas',
        evidence: srcDirs.filter(d => ['models', 'entities', 'schemas'].includes(d)),
      });
    }

    if (srcDirs.includes('utils') || srcDirs.includes('helpers')) {
      insights.push({
        pattern: 'Utility module',
        description: 'Shared utilities extracted',
        evidence: srcDirs.filter(d => ['utils', 'helpers'].includes(d)),
      });
    }
  }

  return insights;
}

// ============ Main Analysis Function ============

/**
 * Analyze a repository and extract learnings from code
 */
export function analyzeRepository(
  repoPath: string,
  options: AnalyzeOptions = {}
): AnalysisResult {
  const {
    maxFiles = 50,
    includeTests = false,
    languages = ['typescript', 'javascript'],
  } = options;

  const learnings: CodeLearning[] = [];
  let filesAnalyzed = 0;
  let patternsFound = 0;
  let gemsFound = 0;

  // Get allowed extensions
  const allowedExtensions = languages.flatMap(lang => LANGUAGE_EXTENSIONS[lang] || []);

  // 1. Analyze package.json
  const packageAnalysis = analyzePackageJson(join(repoPath, 'package.json'));
  if (packageAnalysis) {
    if (packageAnalysis.purpose) {
      learnings.push({
        title: `Project purpose: ${basename(repoPath)}`,
        category: 'architecture',
        lesson: packageAnalysis.purpose,
        source_file: 'package.json',
        confidence: 'low',
        type: 'config',
      });
    }

    for (const dep of packageAnalysis.keyDependencies.slice(0, 5)) {
      learnings.push({
        title: `Uses ${dep.name}`,
        category: 'tooling',
        lesson: `${dep.name}: ${dep.purpose}`,
        source_file: 'package.json',
        confidence: 'low',
        type: 'dependency',
      });
    }

    for (const insight of packageAnalysis.insights) {
      learnings.push({
        title: insight,
        category: 'architecture',
        lesson: insight,
        source_file: 'package.json',
        confidence: 'low',
        type: 'config',
      });
    }
  }

  // 2. Analyze directory structure
  const archInsights = analyzeDirectoryStructure(repoPath);
  for (const insight of archInsights) {
    learnings.push({
      title: insight.pattern,
      category: 'architecture',
      lesson: `${insight.description}. Evidence: ${insight.evidence.join(', ')}`,
      source_file: '(directory structure)',
      confidence: 'low',
      type: 'architecture',
    });
  }

  // 3. Find and analyze source files
  function walkDir(dir: string, files: string[] = []): string[] {
    if (files.length >= maxFiles) return files;

    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (SKIP_DIRS.includes(entry)) continue;
      if (!includeTests && (entry.includes('test') || entry.includes('spec'))) continue;

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walkDir(fullPath, files);
      } else if (stat.isFile()) {
        const ext = extname(entry);
        if (allowedExtensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
    return files;
  }

  const sourceFiles = walkDir(repoPath);

  for (const filePath of sourceFiles) {
    filesAnalyzed++;
    const content = readFileSync(filePath, 'utf-8');
    const relativePath = filePath.replace(repoPath + '/', '');
    const ext = extname(filePath);

    // Extract comments based on language
    let comments: ExtractedComment[] = [];
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      comments = extractJSDocComments(content);
    } else if (ext === '.py') {
      comments = extractPythonDocstrings(content);
    }

    // Add JSDoc learnings (limit per file)
    for (const comment of comments.slice(0, 3)) {
      if (comment.type === 'jsdoc' || comment.type === 'docstring') {
        learnings.push({
          title: comment.associatedCode?.slice(0, 60) || 'Code documentation',
          category: 'insight',
          lesson: comment.content,
          source_file: relativePath,
          source_line: comment.line,
          confidence: 'low',
          type: 'jsdoc',
        });
      }
    }

    // Detect patterns and persist to database for querying
    const patterns = detectPatterns(content, filePath);
    if (patterns.length > 0) {
      // Persist patterns to code_patterns table for fast lookups
      persistPatterns(patterns, relativePath);
    }
    for (const pattern of patterns) {
      patternsFound++;
      learnings.push({
        title: pattern.name,
        category: pattern.category,
        lesson: `${pattern.description}. Found in ${relativePath}`,
        source_file: relativePath,
        source_line: pattern.line,
        confidence: 'low',
        type: 'pattern',
      });
    }

    // Find gems
    const gems = detectGems(content, filePath);
    for (const gem of gems) {
      gemsFound++;
      learnings.push({
        title: gem.title,
        category: gem.category,
        lesson: gem.description,
        source_file: relativePath,
        source_line: gem.line,
        confidence: 'low',
        type: 'gem',
      });
    }
  }

  // Deduplicate by title
  const uniqueLearnings = learnings.filter((learning, index) => {
    return learnings.findIndex(l => l.title === learning.title) === index;
  });

  return {
    learnings: uniqueLearnings,
    stats: {
      filesAnalyzed,
      patternsFound,
      gemsFound,
    },
  };
}

export default {
  analyzeRepository,
  analyzePackageJson,
  analyzeDirectoryStructure,
  detectPatterns,
  detectGems,
  persistPatterns,
  analyzeAndPersistPatterns,
};
