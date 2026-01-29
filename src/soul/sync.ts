/**
 * Soul Sync - Bidirectional Learning Sync with Matrix
 *
 * When Agent Orchestra operates standalone, learnings accumulate locally.
 * When reconnected to The Matrix, this module syncs bidirectionally:
 * - Push local learnings to Matrix
 * - Pull Matrix learnings to local
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'fs';
import { join, basename } from 'path';

export interface SyncManifest {
  version: string;
  lastSync: string | null;
  matrixPath: string | null;
  localLearnings: number;
  syncedLearnings: number;
  soulVersion: string;
  created: string;
  status: 'standalone' | 'connected' | 'syncing';
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: string[];
  timestamp: string;
}

// Paths relative to Agent Orchestra root
const LOCAL_PSI = join(__dirname, '../../psi');
const LOCAL_LEARNINGS = join(LOCAL_PSI, 'memory/learnings');
const LOCAL_MANIFEST = join(LOCAL_PSI, 'sync/manifest.json');

/**
 * Load sync manifest
 */
export function loadManifest(): SyncManifest {
  if (existsSync(LOCAL_MANIFEST)) {
    return JSON.parse(readFileSync(LOCAL_MANIFEST, 'utf-8'));
  }

  // Default manifest
  return {
    version: '1.0.0',
    lastSync: null,
    matrixPath: null,
    localLearnings: 0,
    syncedLearnings: 0,
    soulVersion: '1.0',
    created: new Date().toISOString(),
    status: 'standalone',
  };
}

/**
 * Save sync manifest
 */
export function saveManifest(manifest: SyncManifest): void {
  const dir = join(LOCAL_PSI, 'sync');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(LOCAL_MANIFEST, JSON.stringify(manifest, null, 2));
}

/**
 * Check if Matrix is available at given path
 */
export function isMatrixAvailable(matrixPath?: string): boolean {
  const path = matrixPath || process.env.MATRIX_PATH;
  if (!path) return false;

  const soulPath = join(path, 'psi/The_Source/SOUL_SEED.md');
  return existsSync(soulPath);
}

/**
 * Get list of local learnings
 */
function getLocalLearnings(): string[] {
  if (!existsSync(LOCAL_LEARNINGS)) return [];

  return readdirSync(LOCAL_LEARNINGS)
    .filter((f) => f.endsWith('.md') && f !== '.gitkeep');
}

/**
 * Get list of Matrix learnings
 */
function getMatrixLearnings(matrixPath: string): string[] {
  const matrixLearnings = join(matrixPath, 'psi/memory/learnings');
  if (!existsSync(matrixLearnings)) return [];

  return readdirSync(matrixLearnings)
    .filter((f) => f.endsWith('.md'));
}

/**
 * Push local learnings to Matrix
 */
async function pushLearnings(matrixPath: string): Promise<number> {
  const matrixLearnings = join(matrixPath, 'psi/memory/learnings');
  if (!existsSync(matrixLearnings)) {
    mkdirSync(matrixLearnings, { recursive: true });
  }

  const localFiles = getLocalLearnings();
  const matrixFiles = new Set(getMatrixLearnings(matrixPath));
  let pushed = 0;

  for (const file of localFiles) {
    // Prefix with 'orchestra_' to identify source
    const targetName = file.startsWith('orchestra_') ? file : `orchestra_${file}`;

    if (!matrixFiles.has(targetName)) {
      const src = join(LOCAL_LEARNINGS, file);
      const dest = join(matrixLearnings, targetName);
      copyFileSync(src, dest);
      pushed++;
      console.log(`[Sync] Pushed: ${file} → Matrix`);
    }
  }

  return pushed;
}

/**
 * Pull Matrix learnings to local
 */
async function pullLearnings(matrixPath: string): Promise<number> {
  const matrixLearnings = join(matrixPath, 'psi/memory/learnings');
  if (!existsSync(matrixLearnings)) return 0;

  if (!existsSync(LOCAL_LEARNINGS)) {
    mkdirSync(LOCAL_LEARNINGS, { recursive: true });
  }

  const matrixFiles = getMatrixLearnings(matrixPath);
  const localFiles = new Set(getLocalLearnings());
  let pulled = 0;

  for (const file of matrixFiles) {
    // Skip files we pushed (orchestra_ prefix)
    if (file.startsWith('orchestra_')) continue;

    // Prefix with 'matrix_' to identify source
    const targetName = file.startsWith('matrix_') ? file : `matrix_${file}`;

    if (!localFiles.has(targetName) && !localFiles.has(file)) {
      const src = join(matrixLearnings, file);
      const dest = join(LOCAL_LEARNINGS, targetName);
      copyFileSync(src, dest);
      pulled++;
      console.log(`[Sync] Pulled: ${file} ← Matrix`);
    }
  }

  return pulled;
}

/**
 * Sync learnings bidirectionally with Matrix
 */
export async function syncWithMatrix(matrixPath?: string): Promise<SyncResult> {
  const path = matrixPath || process.env.MATRIX_PATH;

  if (!path || !isMatrixAvailable(path)) {
    throw new Error('Matrix not available for sync');
  }

  const manifest = loadManifest();
  manifest.status = 'syncing';
  manifest.matrixPath = path;
  saveManifest(manifest);

  const result: SyncResult = {
    pushed: 0,
    pulled: 0,
    conflicts: [],
    timestamp: new Date().toISOString(),
  };

  try {
    // Push local → Matrix
    result.pushed = await pushLearnings(path);

    // Pull Matrix → local
    result.pulled = await pullLearnings(path);

    // Update manifest
    manifest.lastSync = result.timestamp;
    manifest.status = 'connected';
    manifest.localLearnings = getLocalLearnings().length;
    manifest.syncedLearnings += result.pushed + result.pulled;
    saveManifest(manifest);

    console.log(`[Sync] Complete: ${result.pushed} pushed, ${result.pulled} pulled`);
  } catch (error) {
    manifest.status = 'standalone';
    saveManifest(manifest);
    throw error;
  }

  return result;
}

/**
 * Get sync status
 */
export function getSyncStatus(): SyncManifest & { matrixAvailable: boolean } {
  const manifest = loadManifest();
  return {
    ...manifest,
    matrixAvailable: isMatrixAvailable(manifest.matrixPath || undefined),
  };
}
