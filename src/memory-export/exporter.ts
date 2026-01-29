/**
 * Memory Exporter - Export learnings/sessions to queryable markdown
 *
 * Implements the External Brain three-folder structure:
 * - resonance/  - Identity (philosophy, principles, high-confidence)
 * - learnings/  - Patterns by category
 * - retrospectives/ - Sessions, decisions, weekly summaries
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import {
  listLearningsFromDb,
  listSessionsFromDb,
  listAllDecisions,
  type LearningRecord,
  type SessionRecord,
  type Decision,
} from '../db';

// ============================================================================
// Types
// ============================================================================

export interface ExportConfig {
  outputDir: string;           // Default: ./ψ/memory
  includeTypes: ('learnings' | 'sessions' | 'decisions' | 'resonance')[];
  minConfidence?: 'low' | 'medium' | 'high' | 'proven';
  category?: string;
  since?: Date;
  limit?: number;
}

export interface ExportResult {
  outputDir: string;
  learnings: number;
  sessions: number;
  decisions: number;
  resonance: number;
  errors: string[];
}

// ============================================================================
// Markdown Formatting
// ============================================================================

/**
 * Generate YAML frontmatter for a learning
 */
function learningToFrontmatter(learning: LearningRecord): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${learning.id}`);
  lines.push(`category: ${learning.category}`);
  lines.push(`title: "${learning.title.replace(/"/g, '\\"')}"`);
  lines.push(`confidence: ${learning.confidence || 'medium'}`);
  if (learning.maturity_stage) {
    lines.push(`maturity: ${learning.maturity_stage}`);
  }
  lines.push(`created: ${learning.created_at?.split(' ')[0] || 'unknown'}`);
  if (learning.times_validated) {
    lines.push(`validated: ${learning.times_validated}`);
  }
  if (learning.source_session_id) {
    lines.push(`source_session: ${learning.source_session_id}`);
  }
  if (learning.source_url) {
    lines.push(`source_url: ${learning.source_url}`);
  }
  // Generate tags from category and keywords
  const tags: string[] = [learning.category];
  if (learning.maturity_stage) tags.push(learning.maturity_stage);
  if (learning.confidence === 'proven') tags.push('proven');
  lines.push(`tags: [${tags.join(', ')}]`);
  lines.push('---');
  return lines.join('\n');
}

/**
 * Convert a learning to full markdown document
 */
function learningToMarkdown(learning: LearningRecord): string {
  const parts: string[] = [];

  // Frontmatter
  parts.push(learningToFrontmatter(learning));
  parts.push('');

  // Title
  parts.push(`# ${learning.title}`);
  parts.push('');

  // Description
  if (learning.description) {
    parts.push(learning.description);
    parts.push('');
  }

  // Structured learning fields (if present)
  if (learning.what_happened) {
    parts.push('## What Happened');
    parts.push(learning.what_happened);
    parts.push('');
  }

  if (learning.lesson) {
    parts.push('## Lesson');
    parts.push(learning.lesson);
    parts.push('');
  }

  if (learning.prevention) {
    parts.push('## Prevention');
    parts.push(learning.prevention);
    parts.push('');
  }

  // Context
  if (learning.context) {
    parts.push('## Context');
    parts.push(learning.context);
    parts.push('');
  }

  // Metadata footer
  parts.push('---');
  parts.push('');
  const metaParts: string[] = [];
  if (learning.times_validated) {
    metaParts.push(`Validated ${learning.times_validated} time(s)`);
  }
  if (learning.last_validated_at) {
    metaParts.push(`Last validated: ${learning.last_validated_at}`);
  }
  if (metaParts.length > 0) {
    parts.push(`*${metaParts.join(' | ')}*`);
  }

  return parts.join('\n');
}

/**
 * Generate YAML frontmatter for a session
 */
function sessionToFrontmatter(session: SessionRecord): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${session.id}`);
  lines.push(`type: session`);
  lines.push(`created: ${session.created_at?.split(' ')[0] || 'unknown'}`);
  if (session.duration_mins) {
    lines.push(`duration_mins: ${session.duration_mins}`);
  }
  if (session.commits_count) {
    lines.push(`commits: ${session.commits_count}`);
  }
  if (session.tags) {
    try {
      const tags = JSON.parse(session.tags);
      if (Array.isArray(tags) && tags.length > 0) {
        lines.push(`tags: [${tags.join(', ')}]`);
      }
    } catch {
      // Ignore JSON parse errors
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Convert a session to markdown document
 */
function sessionToMarkdown(session: SessionRecord): string {
  const parts: string[] = [];

  // Frontmatter
  parts.push(sessionToFrontmatter(session));
  parts.push('');

  // Title from session ID or summary
  const title = session.id.replace(/_/g, ' ').replace(/session /i, '');
  parts.push(`# Session: ${title}`);
  parts.push('');

  // Summary
  if (session.summary) {
    parts.push('## Summary');
    parts.push(session.summary);
    parts.push('');
  }

  // Full context if available
  if (session.full_context) {
    parts.push('## Full Context');
    parts.push('');
    parts.push('```');
    // Truncate very long contexts
    const context = session.full_context.length > 10000
      ? session.full_context.slice(0, 10000) + '\n... (truncated)'
      : session.full_context;
    parts.push(context);
    parts.push('```');
    parts.push('');
  }

  // Metadata
  parts.push('---');
  parts.push('');
  const metaParts: string[] = [];
  if (session.duration_mins) {
    metaParts.push(`Duration: ${session.duration_mins} mins`);
  }
  if (session.commits_count) {
    metaParts.push(`Commits: ${session.commits_count}`);
  }
  if (metaParts.length > 0) {
    parts.push(`*${metaParts.join(' | ')}*`);
  }

  return parts.join('\n');
}

/**
 * Generate YAML frontmatter for a decision
 */
function decisionToFrontmatter(decision: Decision): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${decision.id}`);
  lines.push(`type: decision`);
  lines.push(`title: "${decision.title.replace(/"/g, '\\"')}"`);
  lines.push(`status: ${decision.status}`);
  lines.push(`created: ${decision.created_at?.split(' ')[0] || 'unknown'}`);
  if (decision.related_task_id) {
    lines.push(`related_task: ${decision.related_task_id}`);
  }
  if (decision.supersedes) {
    lines.push(`supersedes: ${decision.supersedes}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Convert a decision to markdown (ADR format)
 */
function decisionToMarkdown(decision: Decision): string {
  const parts: string[] = [];

  // Frontmatter
  parts.push(decisionToFrontmatter(decision));
  parts.push('');

  // Title
  parts.push(`# ${decision.title}`);
  parts.push('');

  // Status badge
  const statusBadge = decision.status === 'active' ? '✅ Active' : `⚠️ ${decision.status}`;
  parts.push(`**Status:** ${statusBadge}`);
  parts.push('');

  // Context
  if (decision.context) {
    parts.push('## Context');
    parts.push(decision.context);
    parts.push('');
  }

  // Decision
  parts.push('## Decision');
  parts.push(decision.decision);
  parts.push('');

  // Rationale
  if (decision.rationale) {
    parts.push('## Rationale');
    parts.push(decision.rationale);
    parts.push('');
  }

  // Alternatives
  if (decision.alternatives && decision.alternatives.length > 0) {
    parts.push('## Alternatives Considered');
    for (const alt of decision.alternatives) {
      parts.push(`- ${alt}`);
    }
    parts.push('');
  }

  // Supersedes
  if (decision.supersedes) {
    parts.push('## Supersedes');
    parts.push(`This decision supersedes: ${decision.supersedes}`);
    parts.push('');
  }

  return parts.join('\n');
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Ensure directory exists
 */
async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * Generate a safe filename from a title
 */
function safeFilename(title: string, id: number | string): string {
  const safe = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${id}-${safe || 'untitled'}.md`;
}

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Export learnings to markdown files organized by category
 */
export async function exportLearnings(
  outputDir: string,
  options: { minConfidence?: string; category?: string; limit?: number } = {}
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  // Get learnings from database
  const learnings = listLearningsFromDb({
    category: options.category,
    confidence: options.minConfidence,
    limit: options.limit || 1000,
  });

  // Group by category
  const byCategory = new Map<string, LearningRecord[]>();
  for (const learning of learnings) {
    const cat = learning.category || 'uncategorized';
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(learning);
  }

  // Write files by category
  for (const [category, categoryLearnings] of byCategory) {
    const categoryDir = join(outputDir, 'learnings', category);
    await ensureDir(categoryDir);

    for (const learning of categoryLearnings) {
      if (!learning.id) continue;

      try {
        const filename = safeFilename(learning.title, learning.id);
        const filepath = join(categoryDir, filename);
        const content = learningToMarkdown(learning);
        await writeFile(filepath, content, 'utf-8');
        count++;
      } catch (err) {
        errors.push(`Failed to export learning ${learning.id}: ${err}`);
      }
    }
  }

  // Generate category index
  try {
    const indexPath = join(outputDir, 'learnings', 'INDEX.md');
    const indexContent = generateLearningsIndex(byCategory);
    await writeFile(indexPath, indexContent, 'utf-8');
  } catch (err) {
    errors.push(`Failed to generate learnings index: ${err}`);
  }

  return { count, errors };
}

/**
 * Generate index file for learnings
 */
function generateLearningsIndex(byCategory: Map<string, LearningRecord[]>): string {
  const parts: string[] = [];
  parts.push('---');
  parts.push('type: index');
  parts.push(`generated: ${new Date().toISOString().split('T')[0]}`);
  parts.push('---');
  parts.push('');
  parts.push('# Learnings Index');
  parts.push('');

  let total = 0;
  for (const [category, learnings] of byCategory) {
    total += learnings.length;
    parts.push(`## ${category} (${learnings.length})`);
    parts.push('');
    for (const learning of learnings.slice(0, 20)) {
      const badge = learning.confidence === 'proven' ? '✓' : '';
      parts.push(`- [${learning.title}](./${category}/${safeFilename(learning.title, learning.id!)}) ${badge}`);
    }
    if (learnings.length > 20) {
      parts.push(`- ... and ${learnings.length - 20} more`);
    }
    parts.push('');
  }

  parts.push('---');
  parts.push(`*Total: ${total} learnings across ${byCategory.size} categories*`);

  return parts.join('\n');
}

/**
 * Export high-confidence learnings to resonance folder (identity/principles)
 */
export async function exportResonance(
  outputDir: string,
  options: { categories?: string[] } = {}
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  const resonanceDir = join(outputDir, 'resonance');
  await ensureDir(resonanceDir);

  // Export philosophy learnings
  const philosophyLearnings = listLearningsFromDb({
    category: 'philosophy',
    confidence: 'high',
    limit: 100,
  });

  if (philosophyLearnings.length > 0) {
    const content = generateResonanceFile('Philosophy', philosophyLearnings);
    await writeFile(join(resonanceDir, 'philosophy.md'), content, 'utf-8');
    count += philosophyLearnings.length;
  }

  // Export principle learnings
  const principleLearnings = listLearningsFromDb({
    category: 'principle',
    confidence: 'high',
    limit: 100,
  });

  if (principleLearnings.length > 0) {
    const content = generateResonanceFile('Principles', principleLearnings);
    await writeFile(join(resonanceDir, 'principles.md'), content, 'utf-8');
    count += principleLearnings.length;
  }

  // Export proven learnings across all categories
  const provenLearnings = listLearningsFromDb({
    confidence: 'proven',
    limit: 100,
  });

  if (provenLearnings.length > 0) {
    const content = generateResonanceFile('Proven Wisdom', provenLearnings);
    await writeFile(join(resonanceDir, 'proven-wisdom.md'), content, 'utf-8');
    // Don't double-count if already counted above
  }

  return { count, errors };
}

/**
 * Generate a resonance file (consolidated high-value learnings)
 */
function generateResonanceFile(title: string, learnings: LearningRecord[]): string {
  const parts: string[] = [];
  parts.push('---');
  parts.push(`type: resonance`);
  parts.push(`title: ${title}`);
  parts.push(`count: ${learnings.length}`);
  parts.push(`generated: ${new Date().toISOString().split('T')[0]}`);
  parts.push('---');
  parts.push('');
  parts.push(`# ${title}`);
  parts.push('');
  parts.push('*High-confidence learnings that define our approach.*');
  parts.push('');

  for (const learning of learnings) {
    const badge = learning.confidence === 'proven' ? ' ✓' : '';
    parts.push(`## ${learning.title}${badge}`);
    parts.push('');
    if (learning.description) {
      parts.push(learning.description);
      parts.push('');
    }
    if (learning.lesson) {
      parts.push(`**Lesson:** ${learning.lesson}`);
      parts.push('');
    }
    parts.push('---');
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Export sessions to retrospectives folder
 */
export async function exportSessions(
  outputDir: string,
  options: { since?: Date; limit?: number } = {}
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  const sessionsDir = join(outputDir, 'retrospectives', 'sessions');
  await ensureDir(sessionsDir);

  // Get sessions
  const sessions = listSessionsFromDb({
    limit: options.limit || 100,
  });

  // Filter by date if specified
  const filtered = options.since
    ? sessions.filter(s => new Date(s.created_at || 0) >= options.since!)
    : sessions;

  // Group by month
  const byMonth = new Map<string, SessionRecord[]>();
  for (const session of filtered) {
    const date = session.created_at ? new Date(session.created_at) : new Date();
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(month)) {
      byMonth.set(month, []);
    }
    byMonth.get(month)!.push(session);
  }

  // Write files by month
  for (const [month, monthSessions] of byMonth) {
    const monthDir = join(sessionsDir, month);
    await ensureDir(monthDir);

    for (const session of monthSessions) {
      try {
        const filename = `${session.id}.md`;
        const filepath = join(monthDir, filename);
        const content = sessionToMarkdown(session);
        await writeFile(filepath, content, 'utf-8');
        count++;
      } catch (err) {
        errors.push(`Failed to export session ${session.id}: ${err}`);
      }
    }
  }

  return { count, errors };
}

/**
 * Export decisions to retrospectives/decisions folder
 */
export async function exportDecisions(
  outputDir: string,
  options: { includeInactive?: boolean } = {}
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  const decisionsDir = join(outputDir, 'retrospectives', 'decisions');
  await ensureDir(decisionsDir);

  const decisions = listAllDecisions(options.includeInactive);

  for (const decision of decisions) {
    try {
      const filename = safeFilename(decision.title, decision.id);
      const filepath = join(decisionsDir, filename);
      const content = decisionToMarkdown(decision);
      await writeFile(filepath, content, 'utf-8');
      count++;
    } catch (err) {
      errors.push(`Failed to export decision ${decision.id}: ${err}`);
    }
  }

  return { count, errors };
}

/**
 * Generate master index file
 */
export async function generateMasterIndex(outputDir: string): Promise<void> {
  const parts: string[] = [];
  parts.push('---');
  parts.push('type: master-index');
  parts.push(`generated: ${new Date().toISOString()}`);
  parts.push('---');
  parts.push('');
  parts.push('# External Brain - Memory Index');
  parts.push('');
  parts.push('This directory contains the exported memory of the Agent Orchestra system.');
  parts.push('');
  parts.push('## Structure');
  parts.push('');
  parts.push('```');
  parts.push('ψ/memory/');
  parts.push('├── resonance/       # Identity - who we are');
  parts.push('│   ├── philosophy.md');
  parts.push('│   ├── principles.md');
  parts.push('│   └── proven-wisdom.md');
  parts.push('├── learnings/       # Patterns - what we know');
  parts.push('│   ├── architecture/');
  parts.push('│   ├── debugging/');
  parts.push('│   ├── philosophy/');
  parts.push('│   └── INDEX.md');
  parts.push('├── retrospectives/  # History - what happened');
  parts.push('│   ├── sessions/');
  parts.push('│   └── decisions/');
  parts.push('└── INDEX.md         # This file');
  parts.push('```');
  parts.push('');
  parts.push('## Quick Links');
  parts.push('');
  parts.push('- [Resonance (Identity)](./resonance/)');
  parts.push('- [Learnings Index](./learnings/INDEX.md)');
  parts.push('- [Sessions](./retrospectives/sessions/)');
  parts.push('- [Decisions](./retrospectives/decisions/)');
  parts.push('');
  parts.push('---');
  parts.push('*Generated by Agent Orchestra Memory Export*');

  await writeFile(join(outputDir, 'INDEX.md'), parts.join('\n'), 'utf-8');
}

/**
 * Full memory export - creates complete External Brain structure
 */
export async function exportMemory(config: ExportConfig): Promise<ExportResult> {
  const result: ExportResult = {
    outputDir: config.outputDir,
    learnings: 0,
    sessions: 0,
    decisions: 0,
    resonance: 0,
    errors: [],
  };

  await ensureDir(config.outputDir);

  // Export each type requested
  if (config.includeTypes.includes('learnings')) {
    const { count, errors } = await exportLearnings(config.outputDir, {
      minConfidence: config.minConfidence,
      category: config.category,
      limit: config.limit,
    });
    result.learnings = count;
    result.errors.push(...errors);
  }

  if (config.includeTypes.includes('resonance')) {
    const { count, errors } = await exportResonance(config.outputDir);
    result.resonance = count;
    result.errors.push(...errors);
  }

  if (config.includeTypes.includes('sessions')) {
    const { count, errors } = await exportSessions(config.outputDir, {
      since: config.since,
      limit: config.limit,
    });
    result.sessions = count;
    result.errors.push(...errors);
  }

  if (config.includeTypes.includes('decisions')) {
    const { count, errors } = await exportDecisions(config.outputDir);
    result.decisions = count;
    result.errors.push(...errors);
  }

  // Generate master index
  await generateMasterIndex(config.outputDir);

  return result;
}
