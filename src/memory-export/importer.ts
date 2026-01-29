/**
 * Memory Importer - Import markdown files into database
 *
 * Parses markdown files with YAML frontmatter and imports them
 * as learnings, sessions, or decisions.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, extname, basename } from 'path';
import {
  createLearning,
  getLearningById,
  updateLearning,
  type LearningRecord,
} from '../db';

// ============================================================================
// Types
// ============================================================================

export interface ParsedMarkdown {
  frontmatter: Record<string, any>;
  content: string;
  title?: string;
  sections: Record<string, string>;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// ============================================================================
// Frontmatter Parsing
// ============================================================================

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = match[1]!;
  const body = content.slice(match[0].length);

  // Simple YAML parser (handles basic key: value pairs)
  const frontmatter: Record<string, any> = {};
  const lines = yamlContent.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: any = line.slice(colonIndex + 1).trim();

    // Parse arrays [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => s.trim());
    }
    // Parse numbers
    else if (/^\d+$/.test(value)) {
      value = parseInt(value, 10);
    }
    // Parse booleans
    else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    }
    // Remove quotes from strings
    else if ((value.startsWith('"') && value.endsWith('"')) ||
             (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Extract sections from markdown body
 */
export function extractSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const sectionRegex = /^##\s+(.+)$/gm;

  let lastMatch: RegExpExecArray | null = null;
  let lastIndex = 0;
  const matches: { title: string; start: number }[] = [];

  // Find all section headers
  while ((lastMatch = sectionRegex.exec(body)) !== null) {
    matches.push({
      title: lastMatch[1]!.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      start: lastMatch.index + lastMatch[0].length,
    });
  }

  // Extract content between sections
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!;
    const next = matches[i + 1];
    const end = next ? next.start - (body.slice(0, next.start).lastIndexOf('\n##') - body.slice(0, current.start).lastIndexOf('\n')) : body.length;

    const content = body.slice(current.start, next ? body.lastIndexOf('\n##', next.start) : body.length).trim();
    sections[current.title] = content;
  }

  return sections;
}

/**
 * Extract title from markdown (first # heading)
 */
export function extractTitle(body: string): string | undefined {
  const titleMatch = body.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1] : undefined;
}

/**
 * Parse a complete markdown file
 */
export function parseMarkdownFile(content: string): ParsedMarkdown {
  const { frontmatter, body } = parseFrontmatter(content);
  const title = extractTitle(body) || frontmatter.title;
  const sections = extractSections(body);

  // Get content before first section as description
  const firstSectionMatch = body.match(/^##\s+/m);
  const contentBeforeSections = firstSectionMatch
    ? body.slice(0, firstSectionMatch.index).replace(/^#\s+.+\n/, '').trim()
    : body.replace(/^#\s+.+\n/, '').trim();

  return {
    frontmatter,
    content: contentBeforeSections,
    title,
    sections,
  };
}

// ============================================================================
// Import Functions
// ============================================================================

/**
 * Import a learning from parsed markdown
 */
export function importLearning(parsed: ParsedMarkdown): LearningRecord {
  const fm = parsed.frontmatter;

  const learning: LearningRecord = {
    id: fm.id,
    category: fm.category || 'uncategorized',
    title: parsed.title || fm.title || 'Untitled',
    description: parsed.content || undefined,
    confidence: fm.confidence || 'medium',
    maturity_stage: fm.maturity || undefined,
    times_validated: fm.validated || undefined,
    source_session_id: fm.source_session || undefined,
    source_url: fm.source_url || undefined,
  };

  // Map sections to structured fields
  if (parsed.sections.what_happened) {
    learning.what_happened = parsed.sections.what_happened;
  }
  if (parsed.sections.lesson) {
    learning.lesson = parsed.sections.lesson;
  }
  if (parsed.sections.prevention) {
    learning.prevention = parsed.sections.prevention;
  }
  if (parsed.sections.context) {
    learning.context = parsed.sections.context;
  }

  return learning;
}

/**
 * Import a single markdown file as a learning
 */
export async function importMarkdownFile(filepath: string): Promise<{ learning: LearningRecord | null; error?: string }> {
  try {
    const content = await readFile(filepath, 'utf-8');
    const parsed = parseMarkdownFile(content);

    // Skip non-learning files (indices, resonance files, etc.)
    if (parsed.frontmatter.type === 'index' ||
        parsed.frontmatter.type === 'resonance' ||
        parsed.frontmatter.type === 'master-index') {
      return { learning: null, error: 'Skipped: not a learning file' };
    }

    const learning = importLearning(parsed);
    return { learning };
  } catch (err) {
    return { learning: null, error: `Parse error: ${err}` };
  }
}

/**
 * Import a learning into the database
 * If ID exists, updates; otherwise creates new
 */
export async function importLearningToDb(learning: LearningRecord): Promise<{ action: 'created' | 'updated' | 'skipped'; id?: number; error?: string }> {
  try {
    // Check if learning with this ID already exists
    if (learning.id) {
      const existing = getLearningById(learning.id);
      if (existing) {
        // Update existing
        updateLearning(learning.id, {
          title: learning.title,
          description: learning.description,
          context: learning.context,
          confidence: learning.confidence,
          what_happened: learning.what_happened,
          lesson: learning.lesson,
          prevention: learning.prevention,
        });
        return { action: 'updated', id: learning.id };
      }
    }

    // Create new learning
    const id = createLearning(learning);
    return { action: 'created', id };
  } catch (err) {
    return { action: 'skipped', error: `Database error: ${err}` };
  }
}

/**
 * Recursively scan directory for markdown files
 */
async function scanDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await scanDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        files.push(fullPath);
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read
  }

  return files;
}

/**
 * Import all markdown files from a directory
 */
export async function scanAndImport(dir: string, options: { dryRun?: boolean } = {}): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // Find all markdown files
  const files = await scanDirectory(dir);

  for (const filepath of files) {
    const { learning, error } = await importMarkdownFile(filepath);

    if (error) {
      if (!error.includes('Skipped')) {
        result.errors.push(`${basename(filepath)}: ${error}`);
      }
      result.skipped++;
      continue;
    }

    if (!learning) {
      result.skipped++;
      continue;
    }

    if (options.dryRun) {
      console.log(`[DRY RUN] Would import: ${learning.title}`);
      result.imported++;
      continue;
    }

    const { action, id, error: dbError } = await importLearningToDb(learning);

    if (dbError) {
      result.errors.push(`${basename(filepath)}: ${dbError}`);
      result.skipped++;
    } else if (action === 'created') {
      result.imported++;
    } else if (action === 'updated') {
      result.updated++;
    } else {
      result.skipped++;
    }
  }

  return result;
}
