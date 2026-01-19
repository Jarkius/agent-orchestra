#!/usr/bin/env bun
/**
 * Memory Absorb - Auto-capture knowledge from codebase exploration
 *
 * Usage:
 *   bun memory absorb <path>     - Analyze repo/directory and capture learnings
 *   bun memory absorb --recent   - Absorb from recently explored paths in session
 *
 * Automatically detects:
 *   - Project type (JS/TS, Python, Go, etc.)
 *   - Key patterns and architecture
 *   - Notable dependencies
 *   - Entry points and structure
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLearning, type LearningRecord } from '../../src/db';
import { initVectorDB, isInitialized, saveLearning } from '../../src/vector-db';

interface CodebaseAnalysis {
  name: string;
  path: string;
  type: string;
  description: string;
  structure: string[];
  patterns: string[];
  dependencies: string[];
  entryPoints: string[];
}

async function analyzeCodebase(targetPath: string): Promise<CodebaseAnalysis> {
  const absPath = path.resolve(targetPath);
  const name = path.basename(absPath);

  const analysis: CodebaseAnalysis = {
    name,
    path: absPath,
    type: 'unknown',
    description: '',
    structure: [],
    patterns: [],
    dependencies: [],
    entryPoints: [],
  };

  // Detect project type and read key files
  const files = fs.readdirSync(absPath);

  // Check for package.json (Node/JS/TS)
  if (files.includes('package.json')) {
    analysis.type = 'javascript';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(absPath, 'package.json'), 'utf-8'));
      analysis.description = pkg.description || '';
      analysis.dependencies = Object.keys(pkg.dependencies || {}).slice(0, 10);
      if (pkg.main) analysis.entryPoints.push(pkg.main);
      if (files.includes('tsconfig.json')) analysis.type = 'typescript';
    } catch {}
  }

  // Check for vanilla JS/HTML projects (no package.json)
  const jsFiles = files.filter(f => f.endsWith('.js'));
  const htmlFiles = files.filter(f => f.endsWith('.html'));
  if (!files.includes('package.json') && (jsFiles.length > 0 || htmlFiles.length > 0)) {
    analysis.type = 'vanilla-js';
    analysis.entryPoints = htmlFiles.slice(0, 3);
    // Try to detect imports from JS files
    for (const jsFile of jsFiles.slice(0, 3)) {
      try {
        const content = fs.readFileSync(path.join(absPath, jsFile), 'utf-8');
        const imports = content.match(/from\s+['"]([^'"]+)['"]/g);
        if (imports) {
          for (const imp of imports) {
            const match = imp.match(/from\s+['"]([^'"]+)['"]/);
            if (match && match[1] && !match[1].startsWith('.')) {
              analysis.dependencies.push(match[1]);
            }
          }
        }
      } catch {}
    }
    analysis.dependencies = [...new Set(analysis.dependencies)].slice(0, 10);
  }

  // Check for requirements.txt (Python)
  if (files.includes('requirements.txt') || files.includes('pyproject.toml')) {
    analysis.type = 'python';
    try {
      if (files.includes('requirements.txt')) {
        const reqs = fs.readFileSync(path.join(absPath, 'requirements.txt'), 'utf-8');
        analysis.dependencies = reqs.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 10);
      }
    } catch {}
  }

  // Check for go.mod (Go)
  if (files.includes('go.mod')) {
    analysis.type = 'go';
    try {
      const mod = fs.readFileSync(path.join(absPath, 'go.mod'), 'utf-8');
      const moduleMatch = mod.match(/module\s+(\S+)/);
      if (moduleMatch) analysis.description = `Go module: ${moduleMatch[1]}`;
    } catch {}
  }

  // Check for Cargo.toml (Rust)
  if (files.includes('Cargo.toml')) {
    analysis.type = 'rust';
  }

  // Read README for description
  const readmeFile = files.find(f => f.toLowerCase().startsWith('readme'));
  if (readmeFile) {
    try {
      const readme = fs.readFileSync(path.join(absPath, readmeFile), 'utf-8');
      // Extract first paragraph or heading
      const firstPara = readme.split('\n\n')[0]?.replace(/^#\s*/, '').trim();
      if (firstPara && firstPara.length < 500) {
        analysis.description = firstPara;
      }
    } catch {}
  }

  // Detect structure
  const importantDirs = ['src', 'lib', 'app', 'components', 'pages', 'api', 'scripts', 'tests', 'examples'];
  analysis.structure = files.filter(f => {
    const stat = fs.statSync(path.join(absPath, f));
    return stat.isDirectory() && (importantDirs.includes(f) || !f.startsWith('.'));
  }).slice(0, 10);

  // Detect patterns from file names
  const allFiles = files.filter(f => !f.startsWith('.'));
  if (allFiles.some(f => f.includes('.test.') || f.includes('.spec.'))) {
    analysis.patterns.push('has tests');
  }
  if (files.includes('docker-compose.yml') || files.includes('Dockerfile')) {
    analysis.patterns.push('dockerized');
  }
  if (files.includes('.github')) {
    analysis.patterns.push('github actions');
  }

  return analysis;
}

function generateLearningFromAnalysis(analysis: CodebaseAnalysis): {
  category: string;
  title: string;
  lesson: string;
  prevention: string;
} {
  const { name, type, description, structure, dependencies, patterns } = analysis;

  const parts: string[] = [];

  // Type info
  parts.push(`${type.charAt(0).toUpperCase() + type.slice(1)} project`);

  // Description
  if (description) {
    parts.push(description.slice(0, 200));
  }

  // Structure
  if (structure.length > 0) {
    parts.push(`Structure: ${structure.join(', ')}`);
  }

  // Dependencies (top 5)
  if (dependencies.length > 0) {
    parts.push(`Key deps: ${dependencies.slice(0, 5).join(', ')}`);
  }

  // Patterns
  if (patterns.length > 0) {
    parts.push(`Patterns: ${patterns.join(', ')}`);
  }

  return {
    category: 'architecture',
    title: `${name}: ${type} codebase at ${analysis.path}`,
    lesson: parts.join('. '),
    prevention: `Reference when working with ${name} or similar ${type} projects`,
  };
}

async function absorbCodebase(targetPath: string): Promise<number | null> {
  console.log(`\n🔬 Analyzing: ${targetPath}\n`);

  const analysis = await analyzeCodebase(targetPath);
  const learning = generateLearningFromAnalysis(analysis);

  console.log(`  Type:        ${analysis.type}`);
  console.log(`  Structure:   ${analysis.structure.join(', ') || 'flat'}`);
  console.log(`  Dependencies: ${analysis.dependencies.length > 0 ? analysis.dependencies.slice(0, 5).join(', ') : 'none detected'}`);
  console.log(`  Patterns:    ${analysis.patterns.join(', ') || 'none detected'}`);
  console.log();

  // Initialize vector DB
  if (!isInitialized()) await initVectorDB();

  // Create learning
  const learningId = createLearning({
    category: learning.category,
    title: learning.title,
    lesson: learning.lesson,
    prevention: learning.prevention,
    confidence: 'low',
    context: JSON.stringify(analysis),
  });

  // Embed in vector DB
  await saveLearning(learningId, learning.title, learning.lesson, {
    category: learning.category,
    confidence: 'low',
    created_at: new Date().toISOString(),
  });

  console.log(`  💾 Learning #${learningId} saved\n`);
  console.log(`  Title:      ${learning.title.slice(0, 60)}...`);
  console.log(`  Lesson:     ${learning.lesson.slice(0, 100)}...`);
  console.log(`  Prevention: ${learning.prevention}`);

  return learningId;
}

async function main() {
  const args = process.argv.slice(2);
  const targetPath = args.find(a => !a.startsWith('-')) || '.';

  if (!fs.existsSync(targetPath)) {
    console.error(`❌ Path not found: ${targetPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    console.error(`❌ Path is not a directory: ${targetPath}`);
    process.exit(1);
  }

  console.log('═'.repeat(60));
  console.log('  ABSORB CODEBASE KNOWLEDGE');
  console.log('═'.repeat(60));

  await absorbCodebase(targetPath);

  console.log('\n✅ Knowledge absorbed!\n');
}

main().catch(console.error);
