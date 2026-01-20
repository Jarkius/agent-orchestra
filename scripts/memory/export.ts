#!/usr/bin/env bun
/**
 * /export - Export learnings to LEARNINGS.md
 * Usage: bun scripts/memory/export.ts [output_path]
 */

import { writeFileSync } from 'fs';
import { listLearningsFromDb, getImprovementReport } from '../../src/db';

// When called via index.ts router, argv is: [bun, index.ts, "export", path]
// When called directly, argv is: [bun, export.ts, path]
const args = process.argv.slice(2);
const outputPath = args.find(a => a !== 'export' && !a.startsWith('-')) || 'LEARNINGS.md';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function confidenceBadge(c: string): string {
  switch (c) {
    case 'proven': return '**[PROVEN]**';
    case 'high': return '[high]';
    case 'medium': return '[medium]';
    case 'low': return '[low]';
    default: return `[${c}]`;
  }
}

async function exportLearnings() {
  console.log('📚 Exporting learnings...\n');

  const learnings = listLearningsFromDb({ limit: 1000 });

  if (learnings.length === 0) {
    console.log('No learnings to export.');
    return;
  }

  // Group by category
  const byCategory: Record<string, typeof learnings> = {};
  for (const l of learnings) {
    if (!byCategory[l.category]) {
      byCategory[l.category] = [];
    }
    byCategory[l.category]!.push(l);
  }

  // Build markdown
  let md = '# Learnings\n\n';
  md += `_Auto-generated: ${new Date().toISOString()}_\n\n`;
  md += `**Total:** ${learnings.length} learnings across ${Object.keys(byCategory).length} categories\n\n`;
  md += '---\n\n';

  // Sort categories
  const categoryOrder = ['architecture', 'performance', 'tooling', 'debugging', 'process', 'security', 'testing'];
  const sortedCategories = Object.keys(byCategory).sort((a, b) => {
    const aIdx = categoryOrder.indexOf(a);
    const bIdx = categoryOrder.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  for (const category of sortedCategories) {
    const items = byCategory[category];
    md += `# ${capitalize(category)}\n\n`;

    // Sort by confidence (proven first) then by times_validated
    items!.sort((a, b) => {
      const confOrder = ['proven', 'high', 'medium', 'low'];
      const aConf = confOrder.indexOf(a.confidence || 'medium');
      const bConf = confOrder.indexOf(b.confidence || 'medium');
      if (aConf !== bConf) return aConf - bConf;
      return (b.times_validated || 1) - (a.times_validated || 1);
    });

    for (const item of items!) {
      const badge = confidenceBadge(item.confidence || 'medium');
      const validated = item.times_validated && item.times_validated > 1
        ? ` (${item.times_validated}x)`
        : '';
      const date = item.created_at
        ? new Date(item.created_at).toISOString().split('T')[0]
        : 'N/A';

      // Structured Lesson format
      md += `## Lesson: ${item.title}\n`;
      md += `**Date**: ${date}\n`;
      md += `**Category**: ${capitalize(item.category)}\n`;
      md += `**Confidence**: ${badge}${validated}\n\n`;

      // What happened section (use what_happened or context as fallback)
      const whatHappened = (item as any).what_happened || item.context || 'N/A';
      md += `### What happened\n`;
      md += `${whatHappened}\n\n`;

      // What I learned section (use lesson or description or title as fallback)
      const lesson = (item as any).lesson || item.description || item.title;
      md += `### What I learned\n`;
      md += `${lesson}\n\n`;

      // How to prevent section (use prevention field or generate from context)
      const prevention = (item as any).prevention || 'N/A';
      md += `### How to prevent\n`;
      md += `${prevention}\n\n`;

      md += '---\n\n';
    }
  }

  // Add summary stats
  const report = getImprovementReport();
  md += '---\n\n';
  md += '## Summary\n\n';

  md += '### By Confidence\n\n';
  md += '| Level | Count |\n';
  md += '|-------|-------|\n';
  for (const conf of report.by_confidence) {
    md += `| ${conf.confidence} | ${conf.count} |\n`;
  }
  md += '\n';

  md += '### By Category\n\n';
  md += '| Category | Count |\n';
  md += '|----------|-------|\n';
  for (const cat of report.by_category) {
    md += `| ${cat.category} | ${cat.count} |\n`;
  }

  writeFileSync(outputPath, md);

  console.log(`✅ Exported ${learnings.length} learnings to ${outputPath}`);
  console.log('');
  console.log('Categories:');
  for (const category of sortedCategories) {
    console.log(`  - ${category}: ${byCategory[category]!.length} learnings`);
  }
  console.log('');
  console.log('Confidence distribution:');
  for (const conf of report.by_confidence) {
    console.log(`  - ${conf.confidence}: ${conf.count}`);
  }
}

exportLearnings().catch(console.error);
