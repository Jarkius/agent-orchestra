#!/usr/bin/env bun
/**
 * Migrate unprefixed ChromaDB collections to prefixed ones
 * Usage: bun run scripts/migrate-collections.ts [--delete-old]
 */

import { ChromaClient } from 'chromadb';
import { basename } from 'path';

const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8100';
const PREFIX = process.env.CHROMADB_PREFIX || basename(process.cwd());
const DELETE_OLD = process.argv.includes('--delete-old');

const OLD_COLLECTIONS = [
  'task_prompts',
  'task_results',
  'messages_inbound',
  'messages_outbound',
  'shared_context',
  'orchestrator_sessions',
  'orchestrator_learnings',
  'session_tasks',
  'knowledge_entries',
  'lesson_entries',
];

async function main() {
  const url = new URL(CHROMA_URL);
  const client = new ChromaClient({
    host: url.hostname,
    port: parseInt(url.port) || 8100,
  });

  console.log(`\n🔄 Migrating collections to prefix: ${PREFIX}`);
  console.log(`   ChromaDB: ${CHROMA_URL}`);
  console.log(`   Delete old: ${DELETE_OLD}\n`);

  for (const oldName of OLD_COLLECTIONS) {
    const newName = `${PREFIX}_${oldName}`;

    try {
      // Check if old collection exists
      const oldCollection = await client.getCollection({ name: oldName }).catch(() => null);
      if (!oldCollection) {
        console.log(`   ⏭️  ${oldName} - not found, skipping`);
        continue;
      }

      // Get count
      const count = await oldCollection.count();
      if (count === 0) {
        console.log(`   ⏭️  ${oldName} - empty, skipping`);
        if (DELETE_OLD) {
          await client.deleteCollection({ name: oldName });
          console.log(`      🗑️  Deleted empty collection`);
        }
        continue;
      }

      // Get all data from old collection
      const data = await oldCollection.get({
        limit: count,
        include: ['embeddings', 'metadatas', 'documents'],
      });

      if (!data.ids.length) {
        console.log(`   ⏭️  ${oldName} - no data, skipping`);
        continue;
      }

      // Get or create new collection
      const newCollection = await client.getOrCreateCollection({ name: newName });

      // Check if new collection already has data
      const newCount = await newCollection.count();
      if (newCount > 0) {
        console.log(`   ⚠️  ${oldName} → ${newName} - target has ${newCount} items, skipping`);
        continue;
      }

      // Copy data to new collection
      await newCollection.add({
        ids: data.ids,
        embeddings: data.embeddings as number[][],
        metadatas: data.metadatas as Record<string, any>[],
        documents: data.documents as string[],
      });

      console.log(`   ✅ ${oldName} → ${newName} (${count} items)`);

      // Delete old collection if requested
      if (DELETE_OLD) {
        await client.deleteCollection({ name: oldName });
        console.log(`      🗑️  Deleted old collection`);
      }

    } catch (error) {
      console.error(`   ❌ ${oldName} - error: ${error}`);
    }
  }

  console.log('\n✨ Migration complete!\n');
}

main().catch(console.error);
