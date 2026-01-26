/**
 * Tests for today's changes (2026-01-26)
 *
 * 1. Stats display fix - no vertical separators
 * 2. YAML frontmatter on all slash commands
 */

import { describe, it, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";

describe("Stats Display", () => {
  it("should not have vertical separator characters (each on own line)", async () => {
    // Run stats command and capture output
    const result = await $`bun memory stats`.text();

    // Check that there's no pattern of single ═ on its own line
    // (which would indicate '\n═'.repeat() bug)
    const lines = result.split('\n');
    const singleCharLines = lines.filter(line => line.trim() === '═');

    expect(singleCharLines.length).toBe(0);
  });

  it("should have horizontal separators (50 chars)", async () => {
    const result = await $`bun memory stats`.text();

    // Should contain a line with 50 ═ characters
    const horizontalSeparator = '═'.repeat(50);
    expect(result).toContain(horizontalSeparator);
  });
});

describe("Slash Command YAML Frontmatter", () => {
  const commandsDir = join(import.meta.dir, "../../.claude/commands");

  it("commands directory should exist", () => {
    expect(existsSync(commandsDir)).toBe(true);
  });

  it("all .md files should have YAML frontmatter with description", () => {
    const files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);

    const missingFrontmatter: string[] = [];

    for (const file of files) {
      const content = readFileSync(join(commandsDir, file), 'utf-8');

      // Check for YAML frontmatter pattern: starts with ---, has description:, ends with ---
      const hasFrontmatter = content.startsWith('---') &&
        content.includes('\ndescription:') &&
        content.indexOf('---', 3) > 0;

      if (!hasFrontmatter) {
        missingFrontmatter.push(file);
      }
    }

    expect(missingFrontmatter).toEqual([]);
  });

  it("should have at least 20 command files", () => {
    const files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it("memory-* commands should have meaningful descriptions", () => {
    const files = readdirSync(commandsDir)
      .filter(f => f.startsWith('memory-') && f.endsWith('.md'));

    for (const file of files) {
      const content = readFileSync(join(commandsDir, file), 'utf-8');
      const descMatch = content.match(/description:\s*["']?([^"'\n]+)/);

      expect(descMatch).toBeTruthy();
      expect(descMatch![1].length).toBeGreaterThan(10); // Meaningful description
    }
  });

  it("matrix.md should exist and have connect/watch/send in description", () => {
    const matrixPath = join(commandsDir, "matrix.md");
    expect(existsSync(matrixPath)).toBe(true);

    const content = readFileSync(matrixPath, 'utf-8');
    expect(content).toContain('connect');
    expect(content).toContain('watch');
    expect(content).toContain('send');
  });
});

describe("Slash Command Consolidation", () => {
  const commandsDir = join(import.meta.dir, "../../.claude/commands");

  it("should not have redundant variant files (merged into parent)", () => {
    const files = readdirSync(commandsDir);

    // These files should NOT exist - they were consolidated
    const shouldNotExist = [
      'matrix-connect.md',
      'matrix-watch.md',
      'memory-save-full.md',
      'memory-recall-expand.md',
      'memory-distill-all.md',
      'memory-index-force.md',
      'memory-task-sync.md',
      'memory-task-sync-auto.md',
    ];

    for (const file of shouldNotExist) {
      expect(files).not.toContain(file);
    }
  });

  it("parent commands should document their actions/flags", () => {
    // Check that consolidated parent commands have Actions and Flags sections
    const parentsWithActions = ['memory-task.md', 'memory-index.md', 'matrix.md'];

    for (const file of parentsWithActions) {
      const content = readFileSync(join(commandsDir, file), 'utf-8');
      expect(content).toContain('## Actions');
      expect(content).toContain('## Flags');
    }
  });
});
