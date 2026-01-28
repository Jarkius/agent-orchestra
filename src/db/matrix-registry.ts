/**
 * Matrix Registry - Cross-matrix discovery
 *
 * This module handles matrix registration, status tracking,
 * and discovery for the cross-project messaging system.
 */

import { db } from './core';

// ============================================================================
// Types
// ============================================================================

export type MatrixStatus = 'online' | 'offline' | 'away';

export interface MatrixRecord {
  id?: number;
  matrix_id: string;
  display_name?: string;
  last_seen?: string;
  status?: MatrixStatus;
  metadata?: Record<string, any>;
  created_at?: string;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Register or update a matrix in the registry
 */
export function registerMatrix(matrixId: string, displayName?: string, metadata?: Record<string, any>): number {
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  // Atomic upsert using INSERT ON CONFLICT (no TOCTOU race condition)
  db.run(
    `INSERT INTO matrix_registry (matrix_id, display_name, status, metadata, last_seen)
     VALUES (?, ?, 'online', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(matrix_id) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, display_name),
       last_seen = CURRENT_TIMESTAMP,
       status = 'online',
       metadata = COALESCE(excluded.metadata, metadata)`,
    [matrixId, displayName || null, metadataJson]
  );

  // Get the ID (either newly inserted or existing)
  const row = db.query(`SELECT id FROM matrix_registry WHERE matrix_id = ?`).get(matrixId) as { id: number };
  return row.id;
}

/**
 * Update matrix status (online/offline/away)
 */
export function updateMatrixStatus(matrixId: string, status: MatrixStatus): boolean {
  const result = db.run(
    `UPDATE matrix_registry SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE matrix_id = ?`,
    [status, matrixId]
  );
  return result.changes > 0;
}

/**
 * Get a matrix by ID
 */
export function getMatrixById(matrixId: string): MatrixRecord | null {
  const row = db.query(`SELECT * FROM matrix_registry WHERE matrix_id = ?`).get(matrixId) as any;
  if (!row) return null;

  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

/**
 * Get all online matrices
 */
export function getOnlineMatrices(): MatrixRecord[] {
  const rows = db.query(
    `SELECT * FROM matrix_registry WHERE status = 'online' ORDER BY last_seen DESC`
  ).all() as any[];

  return rows.map(row => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));
}

/**
 * Get all registered matrices
 */
export function getAllMatrices(limit = 50): MatrixRecord[] {
  const rows = db.query(
    `SELECT * FROM matrix_registry ORDER BY last_seen DESC LIMIT ?`
  ).all(limit) as any[];

  return rows.map(row => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));
}

/**
 * Mark stale matrices as offline (no heartbeat within timeout)
 */
export function markStaleMatricesOffline(timeoutSeconds: number = 60): number {
  const result = db.run(
    `UPDATE matrix_registry SET status = 'offline' WHERE status = 'online' AND last_seen < datetime('now', '-${timeoutSeconds} seconds')`
  );
  return result.changes;
}

/**
 * Update matrix heartbeat (touch last_seen)
 */
export function touchMatrix(matrixId: string): boolean {
  const result = db.run(
    `UPDATE matrix_registry SET last_seen = CURRENT_TIMESTAMP WHERE matrix_id = ?`,
    [matrixId]
  );
  return result.changes > 0;
}
