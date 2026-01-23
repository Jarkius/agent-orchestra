#!/usr/bin/env bun
/**
 * Codebase Map Generator
 *
 * Generates a structured map of the codebase from indexed data.
 * Outputs to CLAUDE.md or a specified file.
 *
 * Usage:
 *   bun memory map                    - Generate and show map
 *   bun memory map --update           - Update CLAUDE.md with map
 *   bun memory map --output FILE      - Output to specific file
 */

import { getCodeIndexStats, searchCodeVector, initVectorDB } from '../../src/vector-db';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { basename } from 'path';

const args = process.argv.slice(2);
const shouldUpdate = args.includes('--update');
const outputIndex = args.indexOf('--output');
const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : null;

interface FileEntry {
  path: string;
  language: string;
  functions: string[];
  classes: string[];
  exports: string[];
  lineCount: number;
}

interface DirectoryNode {
  name: string;
  files: FileEntry[];
  subdirs: Map<string, DirectoryNode>;
}

async function main() {
  await initVectorDB();

  console.log('Generating codebase map from index...\n');

  // Get index stats
  const stats = await getCodeIndexStats();

  if (stats.totalDocuments === 0) {
    console.log('No indexed files found. Run "bun memory index once" first.');
    process.exit(1);
  }

  // Query for all indexed files (grouped by file path)
  const allResults = await searchCodeVector('', { limit: 1000 });

  // Group by file path and extract metadata
  const filesMap = new Map<string, FileEntry>();

  for (let i = 0; i < (allResults.ids[0]?.length || 0); i++) {
    const id = allResults.ids[0][i];
    const metadata = allResults.metadatas?.[0]?.[i] as Record<string, unknown> | null;

    if (!metadata) continue;

    const filePath = (metadata.file_path as string) || id.split(':chunk:')[0];

    if (!filesMap.has(filePath)) {
      filesMap.set(filePath, {
        path: filePath,
        language: (metadata.language as string) || 'unknown',
        functions: [],
        classes: [],
        exports: [],
        lineCount: (metadata.line_count as number) || 0,
      });
    }

    const entry = filesMap.get(filePath)!;

    // Parse JSON arrays from metadata
    try {
      const funcs = JSON.parse((metadata.functions as string) || '[]');
      const classes = JSON.parse((metadata.classes as string) || '[]');
      const exports = JSON.parse((metadata.exports as string) || '[]');

      for (const f of funcs) if (!entry.functions.includes(f)) entry.functions.push(f);
      for (const c of classes) if (!entry.classes.includes(c)) entry.classes.push(c);
      for (const e of exports) if (!entry.exports.includes(e)) entry.exports.push(e);
    } catch {
      // Ignore parse errors
    }
  }

  // Build directory tree
  const root: DirectoryNode = { name: '', files: [], subdirs: new Map() };

  for (const [filePath, entry] of filesMap) {
    const parts = filePath.split('/');
    const fileName = parts.pop()!;

    let current = root;
    for (const dir of parts) {
      if (!current.subdirs.has(dir)) {
        current.subdirs.set(dir, { name: dir, files: [], subdirs: new Map() });
      }
      current = current.subdirs.get(dir)!;
    }

    current.files.push({ ...entry, path: fileName });
  }

  // Generate markdown output
  const output = generateMarkdown(root, stats, filesMap.size);

  // Output handling
  if (shouldUpdate) {
    await updateClaudeMd(output);
    console.log('Updated CLAUDE.md with codebase map');
  } else if (outputFile) {
    await writeFile(outputFile, output);
    console.log(`Wrote map to ${outputFile}`);
  } else {
    console.log(output);
  }
}

function generateMarkdown(
  root: DirectoryNode,
  stats: { totalDocuments: number; languages: Record<string, number> },
  fileCount: number
): string {
  const lines: string[] = [];

  lines.push('## Codebase Map');
  lines.push('');
  lines.push('> Auto-generated from semantic index. Run `bun memory map --update` to refresh.');
  lines.push('');

  // Stats summary
  lines.push('### Overview');
  lines.push('');
  lines.push(`- **Files indexed**: ${fileCount}`);
  lines.push(`- **Total chunks**: ${stats.totalDocuments}`);

  const langsSorted = Object.entries(stats.languages)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  lines.push(`- **Top languages**: ${langsSorted.map(([l, c]) => `${l} (${c})`).join(', ')}`);
  lines.push('');

  // Directory structure
  lines.push('### Directory Structure');
  lines.push('');
  lines.push('```');
  generateTree(root, lines, '');
  lines.push('```');
  lines.push('');

  // Key files by category
  lines.push('### Key Files');
  lines.push('');

  // Entry points (index.ts, main.ts, server.ts)
  const entryPoints = findKeyFiles(root, ['index.ts', 'main.ts', 'server.ts', 'app.ts']);
  if (entryPoints.length > 0) {
    lines.push('**Entry Points:**');
    for (const entry of entryPoints.slice(0, 5)) {
      lines.push(`- \`${entry.path}\``);
    }
    lines.push('');
  }

  // Files with most exports (likely core modules)
  const coreModules = findCoreModules(root);
  if (coreModules.length > 0) {
    lines.push('**Core Modules (most exports):**');
    for (const mod of coreModules.slice(0, 8)) {
      const exports = mod.exports.slice(0, 3).join(', ');
      lines.push(`- \`${mod.path}\` - ${exports}${mod.exports.length > 3 ? '...' : ''}`);
    }
    lines.push('');
  }

  // Classes
  const classFiles = findFilesWithClasses(root);
  if (classFiles.length > 0) {
    lines.push('**Key Classes:**');
    for (const file of classFiles.slice(0, 8)) {
      lines.push(`- \`${file.path}\`: ${file.classes.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateTree(node: DirectoryNode, lines: string[], prefix: string): void {
  // Sort subdirs and files
  const subdirs = Array.from(node.subdirs.entries())
    .filter(([name]) => !name.startsWith('.') && name !== 'node_modules')
    .sort(([a], [b]) => a.localeCompare(b));

  const files = node.files
    .filter(f => !f.path.startsWith('.'))
    .sort((a, b) => a.path.localeCompare(b.path));

  const items = [
    ...subdirs.map(([name, dir]) => ({ type: 'dir' as const, name, data: dir })),
    ...files.map(f => ({ type: 'file' as const, name: f.path, data: f })),
  ];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isLast = i === items.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    if (item.type === 'dir') {
      const fileCount = countFiles(item.data as DirectoryNode);
      lines.push(`${prefix}${connector}${item.name}/ (${fileCount} files)`);
      generateTree(item.data as DirectoryNode, lines, childPrefix);
    } else {
      lines.push(`${prefix}${connector}${item.name}`);
    }
  }
}

function countFiles(node: DirectoryNode): number {
  let count = node.files.length;
  for (const subdir of node.subdirs.values()) {
    count += countFiles(subdir);
  }
  return count;
}

function findKeyFiles(node: DirectoryNode, patterns: string[], prefix = ''): FileEntry[] {
  const results: FileEntry[] = [];

  for (const file of node.files) {
    if (patterns.some(p => file.path.toLowerCase() === p.toLowerCase())) {
      results.push({ ...file, path: prefix + file.path });
    }
  }

  for (const [name, subdir] of node.subdirs) {
    results.push(...findKeyFiles(subdir, patterns, prefix + name + '/'));
  }

  return results;
}

function findCoreModules(node: DirectoryNode, prefix = ''): FileEntry[] {
  const results: FileEntry[] = [];

  for (const file of node.files) {
    if (file.exports.length > 0) {
      results.push({ ...file, path: prefix + file.path });
    }
  }

  for (const [name, subdir] of node.subdirs) {
    results.push(...findCoreModules(subdir, prefix + name + '/'));
  }

  return results.sort((a, b) => b.exports.length - a.exports.length);
}

function findFilesWithClasses(node: DirectoryNode, prefix = ''): FileEntry[] {
  const results: FileEntry[] = [];

  for (const file of node.files) {
    if (file.classes.length > 0) {
      results.push({ ...file, path: prefix + file.path });
    }
  }

  for (const [name, subdir] of node.subdirs) {
    results.push(...findFilesWithClasses(subdir, prefix + name + '/'));
  }

  return results.sort((a, b) => b.classes.length - a.classes.length);
}

async function updateClaudeMd(mapContent: string): Promise<void> {
  const claudeMdPath = 'CLAUDE.md';
  let content = '';

  if (existsSync(claudeMdPath)) {
    content = await readFile(claudeMdPath, 'utf-8');

    // Check if there's an existing codebase map section
    const mapStart = content.indexOf('## Codebase Map');
    if (mapStart !== -1) {
      // Find the next ## heading or end of file
      const nextSection = content.indexOf('\n## ', mapStart + 1);
      const mapEnd = nextSection !== -1 ? nextSection : content.length;

      // Replace the section
      content = content.slice(0, mapStart) + mapContent + content.slice(mapEnd);
    } else {
      // Append to end
      content = content.trimEnd() + '\n\n' + mapContent;
    }
  } else {
    content = mapContent;
  }

  await writeFile(claudeMdPath, content);
}

main().catch(console.error);
