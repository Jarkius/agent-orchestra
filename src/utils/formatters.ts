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
  const fields: Array<{ key: keyof FullContext; label: string }> = [
    { key: 'what_worked', label: 'What worked' },
    { key: 'what_didnt_work', label: "What didn't work" },
    { key: 'learnings', label: 'Learnings' },
    { key: 'key_decisions', label: 'Key decisions' },
    { key: 'blockers_resolved', label: 'Blockers resolved' },
    { key: 'future_ideas', label: 'Future ideas' },
    { key: 'next_steps', label: 'Next steps' },
    { key: 'challenges', label: 'Challenges' },
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
