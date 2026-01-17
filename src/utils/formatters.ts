/**
 * Shared formatting utilities for CLI and MCP outputs
 */

import type { FullContext } from '../db';

/**
 * Format full_context for display
 * Returns array of formatted lines ready for console output
 */
export function formatFullContext(ctx: FullContext | null | undefined): string[] {
  if (!ctx) return [];

  const lines: string[] = [];

  // Git context (display at top for technical context)
  if (ctx.git_branch || ctx.git_commits?.length || ctx.files_changed?.length) {
    lines.push('Git:');
    if (ctx.git_branch) {
      lines.push(`  Branch: ${ctx.git_branch}`);
    }
    if (ctx.git_commits?.length) {
      lines.push(`  Commits (${ctx.git_commits.length}):`);
      for (const commit of ctx.git_commits.slice(0, 5)) {
        lines.push(`    ${commit}`);
      }
      if (ctx.git_commits.length > 5) {
        lines.push(`    ... and ${ctx.git_commits.length - 5} more`);
      }
    }
    if (ctx.files_changed?.length) {
      lines.push(`  Files (${ctx.files_changed.length}):`);
      for (const file of ctx.files_changed.slice(0, 8)) {
        lines.push(`    ${file}`);
      }
      if (ctx.files_changed.length > 8) {
        lines.push(`    ... and ${ctx.files_changed.length - 8} more`);
      }
    }
    if (ctx.diff_summary) {
      lines.push(`  ${ctx.diff_summary}`);
    }
  }

  // Array fields
  const fields: Array<{ key: keyof FullContext; label: string }> = [
    { key: 'key_decisions', label: 'Decisions' },
    { key: 'wins', label: 'Wins' },
    { key: 'issues', label: 'Issues' },
    { key: 'challenges', label: 'Challenges' },
    { key: 'next_steps', label: 'Next steps' },
    { key: 'blockers_resolved', label: 'Resolved' },
    { key: 'learnings', label: 'Learnings' },
    { key: 'future_ideas', label: 'Ideas' },
  ];

  for (const { key, label } of fields) {
    const value = ctx[key];
    if (Array.isArray(value) && value.length > 0) {
      lines.push(`${label}:`);
      for (const item of value) {
        lines.push(`  • ${item}`);
      }
    }
  }

  return lines;
}

/**
 * Get status icon for task status
 */
export function getStatusIcon(status: string): string {
  switch (status) {
    case 'done':
      return '✓';
    case 'blocked':
      return '!';
    case 'in_progress':
      return '→';
    default:
      return '○';
  }
}

/**
 * Get confidence badge for learnings
 */
export function getConfidenceBadge(confidence: string, validationCount?: number): string {
  const countSuffix = validationCount && validationCount > 0 ? ` (${validationCount}x)` : '';
  switch (confidence) {
    case 'proven':
      return `★★${countSuffix}`;
    case 'high':
      return `★${countSuffix}`;
    case 'medium':
      return `○${countSuffix}`;
    default:
      return `·${countSuffix}`;
  }
}

/**
 * Capitalize first letter of a string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Format relevance score for display
 */
export function formatRelevance(distance: number): string {
  const relevance = 1 - distance;
  return relevance.toFixed(3);
}
