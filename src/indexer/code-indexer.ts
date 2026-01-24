/**
 * Code Indexer - Semantic code indexing for reduced grep/glob reliance
 *
 * Uses ChromaDB to store code embeddings for semantic search.
 * Supports:
 * - File watching for automatic re-indexing on save
 * - One-time full codebase indexing
 * - Language-aware chunking
 * - Function/class extraction for metadata
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { readFile, stat } from 'fs/promises';
import { realpathSync, existsSync } from 'fs';
import { extname, relative, basename } from 'path';
import { glob } from 'glob';
import {
  initVectorDB,
  embedCodeFile,
  searchCodeVector,
  deleteCodeFile,
  getCodeIndexStats,
} from '../vector-db';
import {
  upsertCodeFile,
  removeCodeFile as removeCodeFileFromDb,
} from '../db';

// Supported file extensions and their language mappings
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.sh': 'bash',
  '.zsh': 'bash',
  '.bash': 'bash',
  '.sql': 'sql',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
};

// Default ignore patterns
const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/bun.lockb',
  '**/.env*',
  '**/agents.db',
  '**/agents.db-*',
  '**/.chromadb_data/**',
];

// Max file size to index (500KB)
const MAX_FILE_SIZE = 500 * 1024;

// Get project ID from environment or folder name
function getProjectId(rootPath: string): string {
  return process.env.MATRIX_ID || basename(rootPath);
}

// Detect if file is external (symlinked from outside project root)
function getFileInfo(filePath: string, projectRoot: string): {
  realPath: string;
  isExternal: boolean;
} {
  try {
    const realPath = realpathSync(filePath);
    const realRoot = realpathSync(projectRoot);
    const isExternal = !realPath.startsWith(realRoot);
    return { realPath, isExternal };
  } catch {
    // If realpath fails, assume internal
    return { realPath: filePath, isExternal: false };
  }
}

export interface IndexerConfig {
  rootPath: string;
  patterns?: string[];
  ignore?: string[];
  maxFileSize?: number;
}

export interface IndexStats {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  errors: number;
  lastIndexedAt?: Date;
  watcherActive: boolean;
}

export class CodeIndexer {
  private watcher: FSWatcher | null = null;
  private config: Required<IndexerConfig>;
  private stats: IndexStats = {
    totalFiles: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    errors: 0,
    watcherActive: false,
  };
  private indexedFiles: Set<string> = new Set();
  private initialized = false;

  constructor(config: IndexerConfig) {
    this.config = {
      rootPath: config.rootPath,
      patterns: config.patterns || ['**/*.{ts,tsx,js,jsx,py,go,rs,md,json}'],
      ignore: [...DEFAULT_IGNORE, ...(config.ignore || [])],
      maxFileSize: config.maxFileSize || MAX_FILE_SIZE,
    };
  }

  /**
   * Initialize the indexer (must be called before other methods)
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await initVectorDB();
    this.initialized = true;
  }

  /**
   * Start file watcher for automatic re-indexing
   */
  async startWatcher(): Promise<void> {
    await this.init();

    if (this.watcher) {
      console.error('[CodeIndexer] Watcher already running');
      return;
    }

    const watchPatterns = this.config.patterns.map(p =>
      `${this.config.rootPath}/${p}`
    );

    this.watcher = chokidar.watch(watchPatterns, {
      ignored: this.config.ignore,
      persistent: true,
      ignoreInitial: true, // Don't index existing files on start
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', async (path) => {
      console.error(`[CodeIndexer] File added: ${relative(this.config.rootPath, path)}`);
      await this.indexFile(path);
    });

    this.watcher.on('change', async (path) => {
      console.error(`[CodeIndexer] File changed: ${relative(this.config.rootPath, path)}`);
      await this.indexFile(path);
    });

    this.watcher.on('unlink', async (path) => {
      console.error(`[CodeIndexer] File removed: ${relative(this.config.rootPath, path)}`);
      await this.removeFile(path);
    });

    this.watcher.on('error', (error) => {
      console.error('[CodeIndexer] Watcher error:', error);
      this.stats.errors++;
    });

    this.stats.watcherActive = true;
    console.error(`[CodeIndexer] Watcher started for ${this.config.rootPath}`);
  }

  /**
   * Stop the file watcher
   */
  async stopWatcher(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.stats.watcherActive = false;
      console.error('[CodeIndexer] Watcher stopped');
    }
  }

  /**
   * Index a single file
   */
  async indexFile(filePath: string): Promise<boolean> {
    await this.init();

    try {
      // Check file size
      const fileStat = await stat(filePath);
      if (fileStat.size > this.config.maxFileSize) {
        console.error(`[CodeIndexer] Skipping large file: ${filePath} (${Math.round(fileStat.size / 1024)}KB)`);
        this.stats.skippedFiles++;
        return false;
      }

      // Read file content
      const content = await readFile(filePath, 'utf-8');
      if (!content.trim()) {
        this.stats.skippedFiles++;
        return false;
      }

      // Detect language
      const ext = extname(filePath).toLowerCase();
      const language = LANGUAGE_MAP[ext] || 'unknown';

      // Extract metadata
      const metadata = this.extractMetadata(content, language, filePath);

      // Generate relative path for ID
      const relativePath = relative(this.config.rootPath, filePath);

      // Get real path and external flag for symlink support
      const { realPath, isExternal } = getFileInfo(filePath, this.config.rootPath);
      const projectId = getProjectId(this.config.rootPath);

      // Count lines
      const lineCount = content.split('\n').length;

      // Index the file in ChromaDB
      await embedCodeFile(relativePath, content, {
        file_path: relativePath,
        language,
        file_name: basename(filePath),
        ...metadata,
        indexed_at: new Date().toISOString(),
      });

      // Calculate chunk count (matches vector-db.ts chunking: 300 chars, 50 overlap)
      const chunkSize = 300;
      const overlap = 50;
      const chunkCount = Math.max(1, Math.ceil((content.length - overlap) / (chunkSize - overlap)));

      // Sync to SQLite for fast lookups
      upsertCodeFile({
        id: relativePath,
        file_path: relativePath,
        real_path: realPath,
        project_id: projectId,
        file_name: basename(filePath),
        language,
        line_count: lineCount,
        size_bytes: fileStat.size,
        chunk_count: chunkCount,
        functions: metadata.functions ? JSON.stringify(metadata.functions) : null,
        classes: metadata.classes ? JSON.stringify(metadata.classes) : null,
        imports: metadata.imports ? JSON.stringify(metadata.imports) : null,
        exports: metadata.exports ? JSON.stringify(metadata.exports) : null,
        is_external: isExternal ? 1 : 0,
      });

      this.indexedFiles.add(relativePath);
      this.stats.indexedFiles++;
      this.stats.lastIndexedAt = new Date();

      return true;
    } catch (error) {
      console.error(`[CodeIndexer] Error indexing ${filePath}:`, error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Remove a file from the index
   */
  async removeFile(filePath: string): Promise<void> {
    const relativePath = relative(this.config.rootPath, filePath);
    const projectId = getProjectId(this.config.rootPath);

    // Remove from ChromaDB
    await deleteCodeFile(relativePath);

    // Remove from SQLite
    removeCodeFileFromDb(relativePath, projectId);

    this.indexedFiles.delete(relativePath);
  }

  /**
   * Index all files matching patterns (one-time full index)
   */
  async indexAll(options?: {
    onProgress?: (current: number, total: number) => void;
    force?: boolean;
  }): Promise<IndexStats> {
    await this.init();

    const { onProgress, force = false } = options || {};

    // Find all matching files
    const files: string[] = [];
    for (const pattern of this.config.patterns) {
      const matches = await glob(pattern, {
        cwd: this.config.rootPath,
        ignore: this.config.ignore,
        absolute: true,
        nodir: true,
      });
      files.push(...matches);
    }

    // Deduplicate
    const uniqueFiles = Array.from(new Set(files));
    this.stats.totalFiles = uniqueFiles.length;

    console.error(`[CodeIndexer] Found ${uniqueFiles.length} files to index`);

    // Index each file
    let processed = 0;
    for (const file of uniqueFiles) {
      const relativePath = relative(this.config.rootPath, file);

      // Skip if already indexed (unless force)
      if (!force && this.indexedFiles.has(relativePath)) {
        processed++;
        continue;
      }

      await this.indexFile(file);
      processed++;

      if (onProgress) {
        onProgress(processed, uniqueFiles.length);
      }

      // Yield to event loop periodically
      if (processed % 50 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    console.error(`[CodeIndexer] Indexed ${this.stats.indexedFiles} files (${this.stats.skippedFiles} skipped, ${this.stats.errors} errors)`);

    return this.getStats();
  }

  /**
   * Extract metadata from code content
   */
  private extractMetadata(
    content: string,
    language: string,
    _filePath: string
  ): {
    functions: string[];
    classes: string[];
    imports: string[];
    exports: string[];
    line_count: number;
  } {
    const lines = content.split('\n');
    const functions: string[] = [];
    const classes: string[] = [];
    const imports: string[] = [];
    const exports: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Function detection (basic patterns for common languages)
      if (language === 'typescript' || language === 'javascript') {
        // function name(), async function name(), const name = () =>
        const funcMatch = trimmed.match(/(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
        if (funcMatch) {
          functions.push(funcMatch[1] || funcMatch[2]);
        }
        // export function name
        const exportFuncMatch = trimmed.match(/export\s+(?:async\s+)?function\s+(\w+)/);
        if (exportFuncMatch) {
          exports.push(exportFuncMatch[1]);
        }
      } else if (language === 'python') {
        // def name():, async def name():
        const funcMatch = trimmed.match(/(?:async\s+)?def\s+(\w+)\s*\(/);
        if (funcMatch) {
          functions.push(funcMatch[1]);
        }
      } else if (language === 'go') {
        // func name(), func (r *Type) name()
        const funcMatch = trimmed.match(/func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/);
        if (funcMatch) {
          functions.push(funcMatch[1]);
        }
      }

      // Class detection
      if (language === 'typescript' || language === 'javascript') {
        const classMatch = trimmed.match(/(?:export\s+)?class\s+(\w+)/);
        if (classMatch) {
          classes.push(classMatch[1]);
          if (trimmed.startsWith('export')) {
            exports.push(classMatch[1]);
          }
        }
      } else if (language === 'python') {
        const classMatch = trimmed.match(/class\s+(\w+)/);
        if (classMatch) {
          classes.push(classMatch[1]);
        }
      }

      // Import detection
      if (language === 'typescript' || language === 'javascript') {
        const importMatch = trimmed.match(/import\s+.*from\s+['"]([^'"]+)['"]/);
        if (importMatch) {
          imports.push(importMatch[1]);
        }
      } else if (language === 'python') {
        const importMatch = trimmed.match(/(?:from\s+(\S+)\s+)?import\s+/);
        if (importMatch && importMatch[1]) {
          imports.push(importMatch[1]);
        }
      } else if (language === 'go') {
        const importMatch = trimmed.match(/import\s+(?:"([^"]+)"|(\w+)\s+"([^"]+)")/);
        if (importMatch) {
          imports.push(importMatch[1] || importMatch[3]);
        }
      }

      // Export detection (additional patterns)
      if (language === 'typescript' || language === 'javascript') {
        const exportMatch = trimmed.match(/export\s+(?:const|let|var|type|interface)\s+(\w+)/);
        if (exportMatch) {
          exports.push(exportMatch[1]);
        }
      }
    }

    // Limit array sizes to prevent metadata bloat
    return {
      functions: functions.slice(0, 50),
      classes: classes.slice(0, 20),
      imports: imports.slice(0, 50),
      exports: exports.slice(0, 50),
      line_count: lines.length,
    };
  }

  /**
   * Search indexed code
   */
  async search(query: string, options?: {
    language?: string;
    limit?: number;
  }): Promise<Array<{
    file_path: string;
    content: string;
    language: string;
    relevance: number;
    metadata: Record<string, unknown>;
  }>> {
    await this.init();

    const results = await searchCodeVector(query, {
      limit: options?.limit || 10,
      language: options?.language,
    });

    return results.ids[0].map((id, i) => {
      const metadata = results.metadatas?.[0]?.[i] || {};
      // Use metadata.file_path if available, otherwise extract from ID (remove :chunk:N suffix)
      const filePath = (metadata.file_path as string) || id.split(':chunk:')[0];
      return {
        file_path: filePath,
        content: results.documents[0][i] || '',
        language: (metadata.language as string) || 'unknown',
        relevance: results.distances?.[0]?.[i]
          ? 1 - results.distances[0][i]
          : 0,
        metadata,
      };
    });
  }

  /**
   * Get current index statistics
   */
  getStats(): IndexStats {
    return { ...this.stats };
  }

  /**
   * Get detailed vector DB stats for indexed code
   */
  async getVectorStats(): Promise<{
    totalDocuments: number;
    languages: Record<string, number>;
  }> {
    await this.init();
    return getCodeIndexStats();
  }
}

// Singleton instance for CLI use
let defaultIndexer: CodeIndexer | null = null;

export function getDefaultIndexer(rootPath?: string): CodeIndexer {
  if (!defaultIndexer) {
    defaultIndexer = new CodeIndexer({
      rootPath: rootPath || process.cwd(),
    });
  }
  return defaultIndexer;
}
