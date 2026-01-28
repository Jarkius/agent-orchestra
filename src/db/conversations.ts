/**
 * Conversations - Agent-to-agent conversation tracking
 *
 * This module handles conversation persistence for multi-agent
 * communication with thread support.
 */

import { db } from './core';

// ============================================================================
// Functions
// ============================================================================

export function createConversation(
  id: string,
  participants: number[],
  topic?: string
): void {
  db.run(
    `INSERT INTO agent_conversations (id, participants, topic) VALUES (?, ?, ?)`,
    [id, JSON.stringify(participants), topic || null]
  );
}

export function getConversation(id: string): any {
  const row = db.query(`SELECT * FROM agent_conversations WHERE id = ?`).get(id) as any;
  if (row) {
    row.participants = JSON.parse(row.participants);
  }
  return row;
}

export function getConversationByThread(threadId: string): any {
  // Find conversation by thread ID from messages
  const msg = db.query(
    `SELECT conversation_id FROM agent_conversation_messages WHERE thread_id = ? LIMIT 1`
  ).get(threadId) as any;
  if (msg) {
    return getConversation(msg.conversation_id);
  }
  return null;
}

export function updateConversationStatus(id: string, status: 'active' | 'closed' | 'archived'): void {
  db.run(
    `UPDATE agent_conversations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, id]
  );
}

export function saveConversationMessage(
  id: string,
  conversationId: string,
  threadId: string | undefined,
  correlationId: string | undefined,
  fromAgent: number,
  toAgent: number | undefined,
  messageType: string,
  content: any,
  options?: {
    method?: string;
    ok?: boolean;
    deadlineMs?: number;
  }
): void {
  db.run(
    `INSERT INTO agent_conversation_messages
     (id, conversation_id, thread_id, correlation_id, from_agent, to_agent, message_type, method, content, ok, deadline_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      conversationId,
      threadId || null,
      correlationId || null,
      fromAgent,
      toAgent || null,
      messageType,
      options?.method || null,
      JSON.stringify(content),
      options?.ok !== undefined ? (options.ok ? 1 : 0) : null,
      options?.deadlineMs || null,
    ]
  );

  // Update conversation message count
  db.run(
    `UPDATE agent_conversations SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [conversationId]
  );
}

export function getConversationMessages(
  conversationId: string,
  limit = 100
): any[] {
  const rows = db.query(
    `SELECT * FROM agent_conversation_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC
     LIMIT ?`
  ).all(conversationId, limit) as any[];

  return rows.map(row => ({
    ...row,
    content: JSON.parse(row.content),
    ok: row.ok !== null ? row.ok === 1 : undefined,
  }));
}

export function getThreadMessages(threadId: string, limit = 100): any[] {
  const rows = db.query(
    `SELECT * FROM agent_conversation_messages
     WHERE thread_id = ?
     ORDER BY created_at ASC
     LIMIT ?`
  ).all(threadId, limit) as any[];

  return rows.map(row => ({
    ...row,
    content: JSON.parse(row.content),
    ok: row.ok !== null ? row.ok === 1 : undefined,
  }));
}

export function getAgentConversations(agentId: number, limit = 50): any[] {
  const rows = db.query(
    `SELECT * FROM agent_conversations
     WHERE participants LIKE ?
     ORDER BY updated_at DESC
     LIMIT ?`
  ).all(`%${agentId}%`, limit) as any[];

  return rows.map(row => ({
    ...row,
    participants: JSON.parse(row.participants),
  }));
}

export function getRecentAgentMessages(agentId: number, limit = 50): any[] {
  const rows = db.query(
    `SELECT * FROM agent_conversation_messages
     WHERE from_agent = ? OR to_agent = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(agentId, agentId, limit) as any[];

  return rows.map(row => ({
    ...row,
    content: JSON.parse(row.content),
    ok: row.ok !== null ? row.ok === 1 : undefined,
  }));
}
