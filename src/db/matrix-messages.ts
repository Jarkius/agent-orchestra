/**
 * Matrix Messages - Cross-matrix communication persistence
 *
 * This module handles storage and retrieval of messages between matrices
 * (cross-project communication). Uses sequence numbers for reliable ordering.
 */

import { db } from './core';

// ============================================================================
// Types
// ============================================================================

export interface MatrixMessageRecord {
  id: number;
  message_id: string;
  from_matrix: string;
  to_matrix: string | null;
  content: string;
  message_type: 'broadcast' | 'direct';
  status: 'pending' | 'sending' | 'sent' | 'delivered' | 'failed';
  retry_count: number;
  max_retries: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  sequence_number: number;
  next_retry_at: string | null;
  attempted_at: string | null;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Get the next sequence number for a matrix atomically
 * Uses INSERT ON CONFLICT for atomic increment
 */
export function getNextSequenceNumber(matrixId: string): number {
  // Atomic upsert: insert with 1 or increment existing
  db.run(`
    INSERT INTO matrix_sequence_counters (matrix_id, next_sequence)
    VALUES (?, 1)
    ON CONFLICT(matrix_id) DO UPDATE SET next_sequence = next_sequence + 1
  `, [matrixId]);

  // Get the current value (which we just set/incremented)
  const row = db.query(`SELECT next_sequence FROM matrix_sequence_counters WHERE matrix_id = ?`)
    .get(matrixId) as { next_sequence: number };

  return row.next_sequence;
}

/**
 * Save a new outgoing matrix message with sequence number
 * Returns both the row ID and sequence number for inclusion in the message payload
 */
export function saveMatrixMessage(msg: {
  messageId: string;
  fromMatrix: string;
  toMatrix?: string;
  content: string;
  messageType: 'broadcast' | 'direct';
  maxRetries?: number;
}): { rowId: number; sequenceNumber: number } {
  // Get the next sequence number for this matrix
  const sequenceNumber = getNextSequenceNumber(msg.fromMatrix);

  const result = db.run(`
    INSERT INTO matrix_messages (message_id, from_matrix, to_matrix, content, message_type, max_retries, sequence_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    msg.messageId,
    msg.fromMatrix,
    msg.toMatrix || null,
    msg.content,
    msg.messageType,
    msg.maxRetries || 3,
    sequenceNumber,
  ]);
  return { rowId: Number(result.lastInsertRowid), sequenceNumber };
}

/**
 * Mark message as 'sending' before transmission (two-phase commit)
 * This prevents duplicate sends if crash occurs after ws.send but before markMessageSent
 */
export function markMessageSending(messageId: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'sending', attempted_at = CURRENT_TIMESTAMP
    WHERE message_id = ?
  `, [messageId]);
}

/**
 * Mark message as sent (transmitted to hub successfully)
 */
export function markMessageSent(messageId: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'sent', sent_at = CURRENT_TIMESTAMP
    WHERE message_id = ?
  `, [messageId]);
}

/**
 * Mark message back to pending if send failed (for retry)
 */
export function markMessagePending(messageId: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'pending'
    WHERE message_id = ?
  `, [messageId]);
}

/**
 * Mark message as delivered (confirmed by recipient)
 */
export function markMessageDelivered(messageId: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
    WHERE message_id = ?
  `, [messageId]);
}

/**
 * Mark message as failed with error
 */
export function markMessageFailed(messageId: string, error: string): void {
  db.run(`
    UPDATE matrix_messages
    SET status = 'failed', error = ?
    WHERE message_id = ?
  `, [error, messageId]);
}

/**
 * Calculate next retry time with exponential backoff and jitter
 * Base: 10s, Multiplier: 2x, Max: 5 minutes, Jitter: 0-2s
 */
function calculateNextRetryTime(retryCount: number): string {
  const BASE_DELAY_MS = 10000;    // 10 seconds
  const MAX_DELAY_MS = 300000;    // 5 minutes
  const JITTER_MAX_MS = 2000;     // 0-2 seconds random jitter

  // Exponential backoff: 10s, 20s, 40s, 80s, 160s (capped at 5 min)
  const exponentialDelay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount), MAX_DELAY_MS);

  // Add random jitter to prevent thundering herd
  const jitter = Math.floor(Math.random() * JITTER_MAX_MS);

  const nextRetryTime = new Date(Date.now() + exponentialDelay + jitter);
  return nextRetryTime.toISOString();
}

/**
 * Increment retry count for a message
 * Only updates pending messages to prevent duplicate sends
 */
export function incrementMessageRetry(messageId: string): number {
  // Get current retry count first
  const msg = db.query(`SELECT retry_count FROM matrix_messages WHERE message_id = ?`).get(messageId) as { retry_count: number } | null;
  const currentRetryCount = msg?.retry_count || 0;

  // Calculate next retry time based on NEW retry count
  const nextRetryAt = calculateNextRetryTime(currentRetryCount);

  db.run(`
    UPDATE matrix_messages
    SET retry_count = retry_count + 1,
        attempted_at = CURRENT_TIMESTAMP,
        next_retry_at = ?
    WHERE message_id = ? AND status = 'pending'
  `, [nextRetryAt, messageId]);

  return currentRetryCount + 1;
}

/**
 * Get pending messages that are ready for retry
 * Returns messages where:
 * - status is 'pending' OR 'sending' (crashed mid-send)
 * - retry_count < maxRetries
 * - next_retry_at is NULL (never attempted) or in the past (ready for retry)
 */
export function getPendingMessages(maxRetries: number = 3): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE status IN ('pending', 'sending')
      AND retry_count < ?
      AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
    ORDER BY created_at ASC
  `).all(maxRetries) as MatrixMessageRecord[];
}

/**
 * Get failed messages that exceeded max retries
 */
export function getFailedMessages(limit: number = 20): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE status = 'failed'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as MatrixMessageRecord[];
}

/**
 * Save incoming message to inbox (with sequence number from source)
 */
export function saveIncomingMessage(msg: {
  messageId: string;
  fromMatrix: string;
  toMatrix?: string;
  content: string;
  messageType: 'broadcast' | 'direct';
  sequenceNumber?: number;
}): number {
  const result = db.run(`
    INSERT OR IGNORE INTO matrix_messages (message_id, from_matrix, to_matrix, content, message_type, status, sent_at, delivered_at, sequence_number)
    VALUES (?, ?, ?, ?, ?, 'delivered', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
  `, [
    msg.messageId,
    msg.fromMatrix,
    msg.toMatrix || null,
    msg.content,
    msg.messageType,
    msg.sequenceNumber || 0,
  ]);
  return Number(result.lastInsertRowid);
}

/**
 * Get unread messages for a matrix (ordered by sequence within each sender)
 */
export function getUnreadMessages(matrixId: string, limit: number = 50): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE (to_matrix = ? OR to_matrix IS NULL OR message_type = 'broadcast')
      AND from_matrix != ?
      AND status = 'delivered'
      AND read_at IS NULL
    ORDER BY from_matrix ASC, sequence_number ASC, created_at ASC
    LIMIT ?
  `).all(matrixId, matrixId, limit) as MatrixMessageRecord[];
}

/**
 * Get all inbox messages for a matrix (ordered by sequence within each sender)
 */
export function getInboxMessages(matrixId: string, limit: number = 50): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE (to_matrix = ? OR to_matrix IS NULL OR message_type = 'broadcast')
      AND from_matrix != ?
      AND status = 'delivered'
    ORDER BY from_matrix ASC, sequence_number ASC, created_at ASC
    LIMIT ?
  `).all(matrixId, matrixId, limit) as MatrixMessageRecord[];
}

/**
 * Mark messages as read
 */
export function markMessagesRead(messageIds: string[]): void {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => '?').join(',');
  db.run(`
    UPDATE matrix_messages
    SET read_at = CURRENT_TIMESTAMP
    WHERE message_id IN (${placeholders})
  `, messageIds);
}

/**
 * Get unread count for a matrix
 */
export function getUnreadCount(matrixId: string): number {
  const result = db.query(`
    SELECT COUNT(*) as count FROM matrix_messages
    WHERE (to_matrix = ? OR to_matrix IS NULL OR message_type = 'broadcast')
      AND from_matrix != ?
      AND status = 'delivered'
      AND read_at IS NULL
  `).get(matrixId, matrixId) as { count: number };
  return result.count;
}

/**
 * Clear inbox messages for a matrix
 */
export function clearInbox(matrixId: string): number {
  const result = db.run(`
    DELETE FROM matrix_messages
    WHERE (to_matrix = ? OR to_matrix IS NULL OR message_type = 'broadcast')
      AND from_matrix != ?
      AND status = 'delivered'
  `, matrixId, matrixId);
  return result.changes;
}

/**
 * Get outbox messages (sent by this matrix)
 */
export function getOutboxMessages(matrixId: string, limit: number = 50): MatrixMessageRecord[] {
  return db.query(`
    SELECT * FROM matrix_messages
    WHERE from_matrix = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(matrixId, limit) as MatrixMessageRecord[];
}
