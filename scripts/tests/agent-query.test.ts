/**
 * Agent-to-Agent Query System Tests
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  ulid,
  createRpcRequest,
  createRpcResponse,
  createEvent,
  isRpcRequest,
  isRpcResponse,
  isEventMessage,
  isExpired,
  type AgentAddress,
  type RpcRequest,
} from '../../src/types/agent-protocol';
import { AgentRpcClient, AgentRpcServer, AgentRpc } from '../../src/services/agent-rpc';
import {
  createConversation,
  getConversation,
  saveConversationMessage,
  getConversationMessages,
  getThreadMessages,
} from '../../src/db';

describe('Agent Protocol Types', () => {
  test('ulid generates unique IDs', () => {
    const id1 = ulid();
    const id2 = ulid();
    expect(id1).not.toBe(id2);
    expect(id1.length).toBeGreaterThan(10);
  });

  test('createRpcRequest creates valid request', () => {
    const from: AgentAddress = { agentId: 1 };
    const to: AgentAddress = { agentId: 2 };

    const request = createRpcRequest(from, to, 'ask', { question: 'Hello?' }, {
      timeoutMs: 5000,
    });

    expect(request.v).toBe(1);
    expect(request.type).toBe('rpc.request');
    expect(request.from.agentId).toBe(1);
    expect(request.to.agentId).toBe(2);
    expect(request.method).toBe('ask');
    expect(request.params.question).toBe('Hello?');
    expect(request.deadlineMs).toBeGreaterThan(Date.now());
    expect(request.correlationId).toBe(request.id);
  });

  test('createRpcResponse swaps from/to', () => {
    const request = createRpcRequest(
      { agentId: 1 },
      { agentId: 2 },
      'ask',
      { question: 'Hi' }
    );

    const response = createRpcResponse(request, 'Hello!', true);

    expect(response.type).toBe('rpc.response');
    expect(response.from.agentId).toBe(2);  // Was 'to'
    expect(response.to.agentId).toBe(1);    // Was 'from'
    expect(response.correlationId).toBe(request.correlationId);
    expect(response.ok).toBe(true);
    expect(response.result).toBe('Hello!');
  });

  test('createEvent creates valid event', () => {
    const event = createEvent(
      { agentId: 1 },
      { agentId: 0 },  // Broadcast
      'status.changed',
      { status: 'busy' }
    );

    expect(event.type).toBe('event');
    expect(event.topic).toBe('status.changed');
    expect(event.payload.status).toBe('busy');
  });

  test('type guards work correctly', () => {
    const request = createRpcRequest({ agentId: 1 }, { agentId: 2 }, 'test', {});
    const response = createRpcResponse(request, 'ok', true);
    const event = createEvent({ agentId: 1 }, { agentId: 0 }, 'test', {});

    expect(isRpcRequest(request)).toBe(true);
    expect(isRpcResponse(request)).toBe(false);
    expect(isEventMessage(request)).toBe(false);

    expect(isRpcRequest(response)).toBe(false);
    expect(isRpcResponse(response)).toBe(true);

    expect(isEventMessage(event)).toBe(true);
  });

  test('isExpired checks deadline', () => {
    const futureRequest = createRpcRequest(
      { agentId: 1 },
      { agentId: 2 },
      'test',
      {},
      { timeoutMs: 10000 }
    );
    expect(isExpired(futureRequest)).toBe(false);

    const expiredRequest: RpcRequest = {
      ...futureRequest,
      deadlineMs: Date.now() - 1000,  // 1 second ago
    };
    expect(isExpired(expiredRequest)).toBe(true);
  });
});

describe('Agent RPC Client', () => {
  let sentMessages: any[] = [];
  let client: AgentRpcClient;

  beforeAll(() => {
    sentMessages = [];
    client = new AgentRpcClient({
      selfId: 1,
      defaultTimeoutMs: 1000,
      send: (msg) => sentMessages.push(msg),
    });
  });

  test('query sends RPC request', async () => {
    // Start a query (will timeout since no response)
    const queryPromise = client.query(2, 'ask', { question: 'Hi?' }, {
      timeoutMs: 100,
    }).catch(() => 'timeout');

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe('rpc.request');
    expect(sentMessages[0].to.agentId).toBe(2);
    expect(sentMessages[0].method).toBe('ask');

    // Wait for timeout
    const result = await queryPromise;
    expect(result).toBe('timeout');
  });

  test('handleResponse resolves pending query', async () => {
    sentMessages = [];

    // Start query
    const queryPromise = client.query(3, 'analyze', { data: 'test' }, {
      timeoutMs: 5000,
    });

    // Simulate response
    const request = sentMessages[0];
    const response = createRpcResponse(request, { analysis: 'done' }, true);

    const handled = client.handleResponse(response);
    expect(handled).toBe(true);

    const result = await queryPromise;
    expect(result.analysis).toBe('done');
  });

  test('handleResponse rejects on error', async () => {
    sentMessages = [];

    const queryPromise = client.query(4, 'fail', {}, { timeoutMs: 5000 });

    const request = sentMessages[0];
    const response = createRpcResponse(request, undefined, false, {
      code: 'INTERNAL',
      message: 'Something went wrong',
    });

    client.handleResponse(response);

    await expect(queryPromise).rejects.toThrow('Something went wrong');
  });
});

describe('Agent RPC Server', () => {
  let sentMessages: any[] = [];
  let server: AgentRpcServer;

  beforeAll(() => {
    sentMessages = [];
    server = new AgentRpcServer({
      selfId: 2,
      send: (msg) => sentMessages.push(msg),
    });
  });

  test('registers and handles method', async () => {
    server.on('greet', (params) => {
      return `Hello, ${params.name}!`;
    });

    const request = createRpcRequest(
      { agentId: 1 },
      { agentId: 2 },
      'greet',
      { name: 'World' }
    );

    await server.handleRequest(request);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe('rpc.response');
    expect(sentMessages[0].ok).toBe(true);
    expect(sentMessages[0].result).toBe('Hello, World!');
  });

  test('returns error for unknown method', async () => {
    sentMessages = [];

    const request = createRpcRequest(
      { agentId: 1 },
      { agentId: 2 },
      'unknown_method',
      {}
    );

    await server.handleRequest(request);

    expect(sentMessages[0].ok).toBe(false);
    expect(sentMessages[0].error?.code).toBe('NOT_FOUND');
  });

  test('handles async methods', async () => {
    sentMessages = [];

    server.on('async_task', async (params) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return params.value * 2;
    });

    const request = createRpcRequest(
      { agentId: 1 },
      { agentId: 2 },
      'async_task',
      { value: 21 }
    );

    await server.handleRequest(request);

    expect(sentMessages[0].ok).toBe(true);
    expect(sentMessages[0].result).toBe(42);
  });
});

describe('Agent Conversation Persistence', () => {
  const convId = `test-conv-${Date.now()}`;
  const threadId = `test-thread-${Date.now()}`;

  test('creates conversation', () => {
    createConversation(convId, [1, 2], 'Test topic');

    const conv = getConversation(convId);
    expect(conv).toBeTruthy();
    expect(conv.participants).toEqual([1, 2]);
    expect(conv.topic).toBe('Test topic');
    expect(conv.status).toBe('active');
  });

  test('saves and retrieves messages', () => {
    saveConversationMessage(
      `msg-${Date.now()}-1`,
      convId,
      threadId,
      'corr-1',
      1,
      2,
      'rpc.request',
      { method: 'ask', params: { question: 'Hi?' } },
      { method: 'ask' }
    );

    saveConversationMessage(
      `msg-${Date.now()}-2`,
      convId,
      threadId,
      'corr-1',
      2,
      1,
      'rpc.response',
      { result: 'Hello!' },
      { ok: true }
    );

    const messages = getConversationMessages(convId);
    expect(messages.length).toBe(2);
    expect(messages[0].message_type).toBe('rpc.request');
    expect(messages[1].message_type).toBe('rpc.response');
    expect(messages[1].ok).toBe(true);
  });

  test('retrieves messages by thread', () => {
    const threadMsgs = getThreadMessages(threadId);
    expect(threadMsgs.length).toBe(2);
  });

  test('updates conversation message count', () => {
    const conv = getConversation(convId);
    expect(conv.message_count).toBe(2);
  });
});

describe('Combined AgentRpc', () => {
  test('handles both requests and responses', async () => {
    const messages: any[] = [];
    const rpc = new AgentRpc({
      selfId: 1,
      send: (msg) => messages.push(msg),
    });

    // Register a handler
    rpc.on('echo', (params) => params.message);

    // Simulate incoming request
    const incomingRequest = createRpcRequest(
      { agentId: 2 },
      { agentId: 1 },
      'echo',
      { message: 'test' }
    );

    await rpc.handleMessage(incomingRequest);

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('rpc.response');
    expect(messages[0].result).toBe('test');
  });
});
