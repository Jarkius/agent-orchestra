/**
 * Shared formatting utilities for CLI and MCP outputs
 */

import type { FullContext, ContinuationBundle, MidChangeState, StructuredNextStep } from '../db';

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
 * Maturity stage icons (Oracle Incubate pattern)
 */
const MATURITY_ICONS: Record<string, string> = {
  observation: '🥒',
  learning: '🌱',
  pattern: '🌿',
  principle: '🌳',
  wisdom: '🔮',
};

/**
 * Get maturity badge for learnings
 */
export function getMaturityBadge(maturityStage?: string): string {
  if (!maturityStage) return '';
  return MATURITY_ICONS[maturityStage] || '';
}

/**
 * Get confidence badge for learnings
 * Now includes maturity stage icon
 */
export function getConfidenceBadge(confidence: string, validationCount?: number, maturityStage?: string): string {
  const countSuffix = validationCount && validationCount > 0 ? ` (${validationCount}x)` : '';
  const maturityIcon = maturityStage ? `${MATURITY_ICONS[maturityStage] || ''} ` : '';

  switch (confidence) {
    case 'proven':
      return `${maturityIcon}★★${countSuffix}`;
    case 'high':
      return `${maturityIcon}★${countSuffix}`;
    case 'medium':
      return `${maturityIcon}○${countSuffix}`;
    default:
      return `${maturityIcon}·${countSuffix}`;
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

/**
 * Format mid-change state for display
 */
export function formatMidChangeState(state: MidChangeState | undefined): string[] {
  if (!state) return [];

  const lines: string[] = [];
  lines.push('📌 Work in Progress:');

  if (state.uncommittedFiles?.length) {
    lines.push(`  Uncommitted (${state.uncommittedFiles.length}):`);
    for (const file of state.uncommittedFiles.slice(0, 5)) {
      lines.push(`    M ${file}`);
    }
    if (state.uncommittedFiles.length > 5) {
      lines.push(`    ... and ${state.uncommittedFiles.length - 5} more`);
    }
  }

  if (state.stagedFiles?.length) {
    lines.push(`  Staged (${state.stagedFiles.length}):`);
    for (const file of state.stagedFiles.slice(0, 3)) {
      lines.push(`    + ${file}`);
    }
    if (state.stagedFiles.length > 3) {
      lines.push(`    ... and ${state.stagedFiles.length - 3} more`);
    }
  }

  if (state.partialImplementations?.length) {
    lines.push('  Partial implementations:');
    for (const impl of state.partialImplementations) {
      lines.push(`    ${impl.file}: ${impl.interface || 'unknown'}`);
      if (impl.implemented.length > 0) {
        lines.push(`      ✓ Done: ${impl.implemented.slice(0, 3).join(', ')}${impl.implemented.length > 3 ? '...' : ''}`);
      }
      if (impl.pending.length > 0) {
        lines.push(`      ○ Pending: ${impl.pending.slice(0, 3).join(', ')}${impl.pending.length > 3 ? '...' : ''}`);
      }
    }
  }

  if (state.currentFocus) {
    lines.push(`  Current focus: ${state.currentFocus.file}`);
    lines.push(`    Task: ${state.currentFocus.task}`);
  }

  return lines;
}

/**
 * Format structured next step for display
 */
export function formatStructuredNextStep(step: StructuredNextStep): string[] {
  const lines: string[] = [];
  const priority = step.priority === 'high' ? '🔴' : step.priority === 'low' ? '⚪' : '🟡';

  lines.push(`${priority} ${step.action}`);

  if (step.breadcrumbs?.length) {
    for (const bc of step.breadcrumbs.slice(0, 3)) {
      const loc = bc.line ? `${bc.file}:${bc.line}` : bc.file;
      const sym = bc.symbol ? ` (${bc.symbol})` : '';
      lines.push(`    → ${loc}${sym}`);
    }
  }

  if (step.testCommand) {
    lines.push(`    ⚡ Verify: ${step.testCommand}`);
  }

  return lines;
}

/**
 * Format continuation bundle for display
 * This is the key output for resuming work
 */
export function formatContinuationBundle(bundle: ContinuationBundle | undefined): string[] {
  if (!bundle) return [];

  const lines: string[] = [];
  lines.push('═══════════════════════════════════════');
  lines.push('  CONTINUATION BUNDLE');
  lines.push('═══════════════════════════════════════');

  // Quick context
  if (bundle.quickContext) {
    lines.push('');
    lines.push('📋 Quick Context:');
    lines.push(`  Done: ${bundle.quickContext.whatWasDone}`);
    lines.push(`  Remaining: ${bundle.quickContext.whatRemains}`);
    if (bundle.quickContext.blockers) {
      lines.push(`  ⚠ Blockers: ${bundle.quickContext.blockers}`);
    }
  }

  // Files to read
  if (bundle.filesToRead.length > 0) {
    lines.push('');
    lines.push('📖 Files to Read First:');
    for (const file of bundle.filesToRead) {
      lines.push(`  1. ${file.file}`);
      lines.push(`     Why: ${file.reason}`);
      if (file.sections?.length) {
        lines.push(`     Focus: ${file.sections.join(', ')}`);
      }
    }
  }

  // Key types
  if (bundle.keyTypes?.length) {
    lines.push('');
    lines.push('🔤 Key Types/Interfaces:');
    for (const t of bundle.keyTypes) {
      const loc = t.line ? `${t.file}:${t.line}` : t.file;
      lines.push(`  • ${t.name} → ${loc}`);
    }
  }

  // Pending work
  if (bundle.pendingWork.length > 0) {
    lines.push('');
    lines.push('📝 Pending Work:');
    for (const step of bundle.pendingWork) {
      const formatted = formatStructuredNextStep(step);
      for (const line of formatted) {
        lines.push(`  ${line}`);
      }
    }
  }

  // Verify commands
  if (bundle.verifyCommands?.length) {
    lines.push('');
    lines.push('⚡ Verify Commands:');
    for (const cmd of bundle.verifyCommands) {
      lines.push(`  $ ${cmd}`);
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════');

  return lines;
}

/**
 * Format full context with enhanced continuation support
 */
export function formatFullContextEnhanced(ctx: FullContext | null | undefined): string[] {
  if (!ctx) return [];

  // Start with base formatting
  const lines = formatFullContext(ctx);

  // Add mid-change state if present
  if (ctx.mid_change_state) {
    if (lines.length > 0) lines.push('');
    lines.push(...formatMidChangeState(ctx.mid_change_state));
  }

  // Add structured next steps if present
  if (ctx.structured_next_steps?.length) {
    lines.push('');
    lines.push('📝 Structured Next Steps:');
    for (const step of ctx.structured_next_steps) {
      const formatted = formatStructuredNextStep(step);
      for (const line of formatted) {
        lines.push(`  ${line}`);
      }
    }
  }

  // Add continuation bundle if present (this is the most important for resuming)
  if (ctx.continuation_bundle) {
    if (lines.length > 0) lines.push('');
    lines.push(...formatContinuationBundle(ctx.continuation_bundle));
  }

  return lines;
}
