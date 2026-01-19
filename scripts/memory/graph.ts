#!/usr/bin/env bun
/**
 * Memory Graph - Explore entity relationships in the knowledge graph
 *
 * Usage:
 *   bun memory graph                 - List top entities
 *   bun memory graph "entity"        - Show related entities
 *   bun memory graph "A" "B"         - Find path from A to B
 *   bun memory graph --mermaid "X"   - Generate mermaid diagram for entity
 */

import {
  listEntities,
  getRelatedEntities,
  findEntityPath,
  getEntityLearnings,
  getEntityByName,
} from '../../src/db';

const args = process.argv.slice(2);
const mermaidMode = args.includes('--mermaid');
const filteredArgs = args.filter(a => a !== '--mermaid');

const entity1 = filteredArgs[0];
const entity2 = filteredArgs[1];

function printHeader(text: string) {
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`  ${text}`);
  console.log(`${'─'.repeat(40)}`);
}

function printSection(text: string) {
  console.log(`\n  ${text}`);
}

// Mode 1: No args - list all entities
if (!entity1) {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  KNOWLEDGE GRAPH - TOP ENTITIES');
  console.log('════════════════════════════════════════════════════════════');

  const entities = listEntities(30);

  if (entities.length === 0) {
    console.log('\n  No entities found. Add learnings to build the knowledge graph.');
    console.log('  Example: bun memory learn insight "Your learning title"');
    process.exit(0);
  }

  printHeader('ENTITIES BY LEARNING COUNT');
  const maxNameLen = Math.max(...entities.map(e => e.entity.name.length), 20);

  for (const { entity, learningCount } of entities) {
    const bar = '█'.repeat(Math.min(learningCount, 20));
    const type = entity.type ? `(${entity.type})` : '';
    console.log(`  ${entity.name.padEnd(maxNameLen)} ${bar} ${learningCount} ${type}`);
  }

  console.log('\n  Usage: bun memory graph "entity" - show related entities');
  console.log('         bun memory graph "A" "B"  - find path between entities');
  process.exit(0);
}

// Mode 2: One arg - show related entities
if (!entity2) {
  const normalized = entity1.toLowerCase().trim();
  const entity = getEntityByName(normalized);

  if (!entity) {
    console.log(`Entity "${entity1}" not found.`);

    // Suggest similar entities
    const all = listEntities(100);
    const similar = all.filter(e => e.entity.name.includes(normalized) || normalized.includes(e.entity.name));
    if (similar.length > 0) {
      console.log('\nDid you mean:');
      similar.slice(0, 5).forEach(e => console.log(`  - ${e.entity.name}`));
    }
    process.exit(1);
  }

  console.log('════════════════════════════════════════════════════════════');
  console.log(`  ENTITY: ${entity.name.toUpperCase()}`);
  console.log('════════════════════════════════════════════════════════════');

  // Get learnings for this entity
  const learnings = getEntityLearnings(entity.name).slice(0, 10);
  if (learnings.length > 0) {
    printHeader('LEARNINGS');
    for (const l of learnings) {
      const conf = l.confidence ? `[${l.confidence}]` : '';
      console.log(`  #${l.id} ${l.title} ${conf}`);
    }
  }

  // Get related entities
  const related = getRelatedEntities(entity.name, 15);
  if (related.length > 0) {
    printHeader('RELATED ENTITIES');
    const maxLen = Math.max(...related.map(r => r.entity.name.length), 15);

    for (const { entity: rel, sharedCount } of related) {
      const bar = '█'.repeat(Math.min(sharedCount, 10));
      console.log(`  ${rel.name.padEnd(maxLen)} ${bar} ${sharedCount} shared`);
    }

    // Mermaid diagram
    if (mermaidMode) {
      printHeader('MERMAID DIAGRAM');
      console.log('```mermaid');
      console.log('graph LR');
      console.log(`  ${sanitizeMermaid(entity.name)}[${entity.name}]`);
      for (const { entity: rel, sharedCount } of related.slice(0, 10)) {
        console.log(`  ${sanitizeMermaid(entity.name)} -->|${sharedCount}| ${sanitizeMermaid(rel.name)}[${rel.name}]`);
      }
      console.log('```');
    }
  } else {
    console.log('\n  No related entities found.');
  }

  process.exit(0);
}

// Mode 3: Two args - find path
console.log('════════════════════════════════════════════════════════════');
console.log(`  PATH: ${entity1.toUpperCase()} → ${entity2.toUpperCase()}`);
console.log('════════════════════════════════════════════════════════════');

const path = findEntityPath(entity1, entity2);

if (!path) {
  console.log('\n  No path found between these entities.');
  console.log('  They may not be connected through shared learnings.');

  // Show if entities exist
  const e1 = getEntityByName(entity1);
  const e2 = getEntityByName(entity2);
  if (!e1) console.log(`  Entity "${entity1}" not found.`);
  if (!e2) console.log(`  Entity "${entity2}" not found.`);

  process.exit(1);
}

printHeader('PATH FOUND');
for (let i = 0; i < path.length; i++) {
  const step = path[i]!;
  const isLast = i === path.length - 1;
  const prefix = i === 0 ? '  ●' : isLast ? '  ◉' : '  │';

  console.log(`${prefix} ${step.entity.name}`);

  if (step.learning && !isLast) {
    console.log(`  │   ↓ via: "${step.learning.title}" (#${step.learning.id})`);
  }
}

if (mermaidMode) {
  printHeader('MERMAID DIAGRAM');
  console.log('```mermaid');
  console.log('graph TD');
  for (let i = 0; i < path.length; i++) {
    const step = path[i]!;
    const nodeId = sanitizeMermaid(step.entity.name);
    console.log(`  ${nodeId}[${step.entity.name}]`);

    if (i < path.length - 1) {
      const nextStep = path[i + 1]!;
      const nextId = sanitizeMermaid(nextStep.entity.name);
      const label = step.learning ? step.learning.title.slice(0, 20) : '';
      console.log(`  ${nodeId} -->|${label}| ${nextId}`);
    }
  }
  console.log('```');
}

console.log(`\n  Path length: ${path.length - 1} hops`);

function sanitizeMermaid(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}
