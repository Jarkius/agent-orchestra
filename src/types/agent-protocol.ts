/**
 * Agent-to-Agent Communication Protocol
 *
 * Defines message types for RPC-style communication between agents.
 * Based on GPT-5.2 recommended patterns:
 * - Hub-routed (not direct P2P)
 * - Three ID system: id, correlationId, threadId
 * - Deadline-based timeouts
 */

// ULID generator (simple implementation)
export function ulid(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 12);
  return `${timestamp}${random}`.toUpperCase();
}

// ============================================================================
// Addressing
// ============================================================================

export interface AgentAddress {
  matrixId?: string;  // For cross-matrix routing (future)
  agentId: number;
}

// ============================================================================
// Base Envelope
// ============================================================================

export interface BaseEnvelope {
  v: 1;                       // Protocol version
  type: string;               // Message type discriminator
  id: string;                 // ULID - unique per message
  ts: number;                 // Timestamp (Date.now())
  from: AgentAddress;         // Sender
  to: AgentAddress;           // Recipient

  // Threading
  threadId?: string;          // Conversation grouping
  parentId?: string;          // Previous message in thread (causal link)
  correlationId?: string;     // Request/response pairing

  // Timeout
  deadlineMs?: number;        // Absolute deadline (skip if expired)

  // Metadata
  meta?: Record<string, unknown>;
}

// ============================================================================
// RPC Messages
// ============================================================================

export interface RpcRequest<T = any> extends BaseEnvelope {
  type: 'rpc.request';
  correlationId: string;      // Required for RPC (usually = id)
  method: string;             // e.g., 'ask', 'analyze', 'review', 'help'
  params: T;
}

export interface RpcResponse extends BaseEnvelope {
  type: 'rpc.response';
  correlationId: string;      // Must match request correlationId
  ok: boolean;
  result?: any;
  error?: RpcError;
}

export interface RpcError {
  code: 'TIMEOUT' | 'CANCELLED' | 'NOT_FOUND' | 'AGENT_OFFLINE' | 'UNAUTHORIZED' | 'BAD_REQUEST' | 'INTERNAL';
  message: string;
  data?: unknown;
}

// ============================================================================
// Event Messages (Fire-and-forget)
// ============================================================================

export interface EventMessage<T = any> extends BaseEnvelope {
  type: 'event';
  topic: string;              // e.g., 'status.changed', 'task.completed', 'memory.updated'
  payload: T;
}

// ============================================================================
// Acknowledgment (Optional)
// ============================================================================

export interface AckMessage extends BaseEnvelope {
  type: 'ack';
  ackId: string;              // Message ID being acknowledged
  status: 'received' | 'processed';
}

// ============================================================================
// Error (Transport/Protocol level)
// ============================================================================

export interface ErrorMessage extends BaseEnvelope {
  type: 'error';
  inReplyTo?: string;         // Message ID that caused error
  error: {
    code: string;
    message: string;
    data?: unknown;
  };
}

// ============================================================================
// Union Type
// ============================================================================

export type AgentMessage =
  | RpcRequest
  | RpcResponse
  | EventMessage
  | AckMessage
  | ErrorMessage;

// ============================================================================
// Helpers
// ============================================================================

export function createRpcRequest<T>(
  from: AgentAddress,
  to: AgentAddress,
  method: string,
  params: T,
  options: {
    timeoutMs?: number;
    threadId?: string;
    parentId?: string;
  } = {}
): RpcRequest<T> {
  const id = ulid();
  const now = Date.now();

  return {
    v: 1,
    type: 'rpc.request',
    id,
    correlationId: id,
    ts: now,
    from,
    to,
    method,
    params,
    threadId: options.threadId,
    parentId: options.parentId,
    deadlineMs: options.timeoutMs ? now + options.timeoutMs : undefined,
  };
}

export function createRpcResponse(
  request: RpcRequest,
  result: any,
  ok: boolean = true,
  error?: RpcError
): RpcResponse {
  return {
    v: 1,
    type: 'rpc.response',
    id: ulid(),
    correlationId: request.correlationId,
    ts: Date.now(),
    from: request.to,        // Swap from/to
    to: request.from,
    threadId: request.threadId,
    parentId: request.id,
    ok,
    result: ok ? result : undefined,
    error: ok ? undefined : error,
  };
}

export function createEvent<T>(
  from: AgentAddress,
  to: AgentAddress,
  topic: string,
  payload: T,
  options: { threadId?: string } = {}
): EventMessage<T> {
  return {
    v: 1,
    type: 'event',
    id: ulid(),
    ts: Date.now(),
    from,
    to,
    topic,
    payload,
    threadId: options.threadId,
  };
}

export function isExpired(msg: BaseEnvelope): boolean {
  return msg.deadlineMs !== undefined && Date.now() > msg.deadlineMs;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isRpcRequest(msg: AgentMessage): msg is RpcRequest {
  return msg.type === 'rpc.request';
}

export function isRpcResponse(msg: AgentMessage): msg is RpcResponse {
  return msg.type === 'rpc.response';
}

export function isEventMessage(msg: AgentMessage): msg is EventMessage {
  return msg.type === 'event';
}
