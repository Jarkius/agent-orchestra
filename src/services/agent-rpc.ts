/**
 * Agent RPC Client
 *
 * Provides a simple API for agents to query each other with:
 * - Timeout handling
 * - Conversation threading
 * - Request/response correlation
 */

import {
  type AgentAddress,
  type RpcRequest,
  type RpcResponse,
  type RpcError,
  type AgentMessage,
  createRpcRequest,
  createRpcResponse,
  isRpcResponse,
  isExpired,
  ulid,
} from '../types/agent-protocol';

// ============================================================================
// Types
// ============================================================================

interface PendingRequest {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  request: RpcRequest;
}

export interface AgentRpcClientOptions {
  selfId: number;
  matrixId?: string;
  defaultTimeoutMs?: number;
  send: (msg: AgentMessage) => void;
}

// ============================================================================
// Agent RPC Client
// ============================================================================

export class AgentRpcClient {
  private pending = new Map<string, PendingRequest>();
  private selfAddress: AgentAddress;
  private defaultTimeoutMs: number;
  private sendFn: (msg: AgentMessage) => void;

  constructor(options: AgentRpcClientOptions) {
    this.selfAddress = {
      agentId: options.selfId,
      matrixId: options.matrixId,
    };
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
    this.sendFn = options.send;
  }

  /**
   * Query another agent and wait for response
   */
  async query<TParams = any, TResult = any>(
    toAgent: number,
    method: string,
    params: TParams,
    options: {
      timeoutMs?: number;
      threadId?: string;
      parentId?: string;
      matrixId?: string;  // For cross-matrix queries (future)
    } = {}
  ): Promise<TResult> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    const request = createRpcRequest(
      this.selfAddress,
      { agentId: toAgent, matrixId: options.matrixId },
      method,
      params,
      {
        timeoutMs,
        threadId: options.threadId ?? ulid(),  // Auto-generate thread if not provided
        parentId: options.parentId,
      }
    );

    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.correlationId);
        reject(new Error(`RPC timeout: ${method} to agent ${toAgent} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(request.correlationId, {
        resolve,
        reject,
        timeout,
        request,
      });

      this.sendFn(request);
    });
  }

  /**
   * Shorthand for common query methods
   */
  async ask(toAgent: number, question: string, options?: { timeoutMs?: number; threadId?: string }): Promise<string> {
    return this.query(toAgent, 'ask', { question }, options);
  }

  async analyze(toAgent: number, data: any, options?: { timeoutMs?: number; threadId?: string }): Promise<any> {
    return this.query(toAgent, 'analyze', { data }, options);
  }

  async review(toAgent: number, content: string, options?: { timeoutMs?: number; threadId?: string }): Promise<any> {
    return this.query(toAgent, 'review', { content }, options);
  }

  /**
   * Handle incoming RPC response
   */
  handleResponse(msg: RpcResponse): boolean {
    const pending = this.pending.get(msg.correlationId);
    if (!pending) {
      return false;  // No matching request
    }

    clearTimeout(pending.timeout);
    this.pending.delete(msg.correlationId);

    if (msg.ok) {
      pending.resolve(msg.result);
    } else {
      const error = msg.error ?? { code: 'INTERNAL', message: 'Unknown error' };
      pending.reject(new Error(`[${error.code}] ${error.message}`));
    }

    return true;
  }

  /**
   * Handle incoming message (dispatches to appropriate handler)
   */
  handleMessage(msg: AgentMessage): boolean {
    if (isRpcResponse(msg)) {
      return this.handleResponse(msg);
    }
    return false;
  }

  /**
   * Create a response to an RPC request
   */
  respond(request: RpcRequest, result: any): RpcResponse {
    return createRpcResponse(request, result, true);
  }

  /**
   * Create an error response to an RPC request
   */
  respondError(request: RpcRequest, code: RpcError['code'], message: string): RpcResponse {
    return createRpcResponse(request, undefined, false, { code, message });
  }

  /**
   * Get pending request count (for diagnostics)
   */
  getPendingCount(): number {
    return this.pending.size;
  }

  /**
   * Cancel all pending requests
   */
  cancelAll(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('RPC client shutdown'));
    }
    this.pending.clear();
  }

  /**
   * Get self address
   */
  getSelfAddress(): AgentAddress {
    return { ...this.selfAddress };
  }
}

// ============================================================================
// Request Handler (for receiving agent)
// ============================================================================

export type RpcMethodHandler<TParams = any, TResult = any> = (
  params: TParams,
  request: RpcRequest<TParams>
) => Promise<TResult> | TResult;

export class AgentRpcServer {
  private handlers = new Map<string, RpcMethodHandler>();
  private selfAddress: AgentAddress;
  private sendFn: (msg: AgentMessage) => void;

  constructor(options: AgentRpcClientOptions) {
    this.selfAddress = {
      agentId: options.selfId,
      matrixId: options.matrixId,
    };
    this.sendFn = options.send;
  }

  /**
   * Register a method handler
   */
  on<TParams = any, TResult = any>(method: string, handler: RpcMethodHandler<TParams, TResult>): void {
    this.handlers.set(method, handler);
  }

  /**
   * Handle incoming RPC request
   */
  async handleRequest(request: RpcRequest): Promise<void> {
    // Check if request has expired
    if (isExpired(request)) {
      console.log(`[RPC] Dropping expired request: ${request.method} from agent ${request.from.agentId}`);
      return;
    }

    const handler = this.handlers.get(request.method);
    if (!handler) {
      const response = createRpcResponse(request, undefined, false, {
        code: 'NOT_FOUND',
        message: `Unknown method: ${request.method}`,
      });
      this.sendFn(response);
      return;
    }

    try {
      const result = await handler(request.params, request);
      const response = createRpcResponse(request, result, true);
      this.sendFn(response);
    } catch (error) {
      const response = createRpcResponse(request, undefined, false, {
        code: 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
      });
      this.sendFn(response);
    }
  }

  /**
   * Get registered methods
   */
  getMethods(): string[] {
    return Array.from(this.handlers.keys());
  }
}

// ============================================================================
// Combined Client + Server
// ============================================================================

export class AgentRpc {
  public readonly client: AgentRpcClient;
  public readonly server: AgentRpcServer;

  constructor(options: AgentRpcClientOptions) {
    this.client = new AgentRpcClient(options);
    this.server = new AgentRpcServer(options);
  }

  /**
   * Handle any incoming agent message
   */
  async handleMessage(msg: AgentMessage): Promise<boolean> {
    if (msg.type === 'rpc.request') {
      await this.server.handleRequest(msg as RpcRequest);
      return true;
    }
    if (msg.type === 'rpc.response') {
      return this.client.handleResponse(msg as RpcResponse);
    }
    return false;
  }

  /**
   * Query another agent
   */
  query<T = any, R = any>(
    toAgent: number,
    method: string,
    params: T,
    options?: { timeoutMs?: number; threadId?: string }
  ): Promise<R> {
    return this.client.query(toAgent, method, params, options);
  }

  /**
   * Register a method handler
   */
  on<TParams = any, TResult = any>(method: string, handler: RpcMethodHandler<TParams, TResult>): void {
    this.server.on(method, handler);
  }

  /**
   * Cleanup
   */
  shutdown(): void {
    this.client.cancelAll();
  }
}
