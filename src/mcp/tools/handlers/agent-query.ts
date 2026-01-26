/**
 * Agent Query MCP Tools
 *
 * Enables agents to query each other directly:
 * - agent_query: Ask another agent a question
 * - agent_broadcast: Send event to all agents
 * - agent_list_connected: List connected agents
 */

import { z } from 'zod';
import {
  getConnectedAgents,
  isAgentConnected,
  sendAgentMessage,
} from '../../../ws-server';
import {
  type RpcRequest,
  type RpcResponse,
  type EventMessage,
  createRpcRequest,
  createEvent,
  ulid,
} from '../../../types/agent-protocol';

// ============================================================================
// Schemas
// ============================================================================

export const AgentQuerySchema = z.object({
  to_agent: z.number().int().positive().describe('Target agent ID'),
  method: z.string().min(1).describe('Query method (ask, analyze, review, help)'),
  params: z.any().describe('Parameters to pass to the method'),
  timeout_ms: z.number().int().positive().default(30000).describe('Timeout in milliseconds'),
  thread_id: z.string().optional().describe('Thread ID for conversation grouping'),
});

export const AgentBroadcastSchema = z.object({
  topic: z.string().min(1).describe('Event topic (e.g., status.changed)'),
  payload: z.any().describe('Event payload'),
  thread_id: z.string().optional().describe('Thread ID for conversation grouping'),
});

export const AgentRespondSchema = z.object({
  correlation_id: z.string().min(1).describe('Correlation ID from the request'),
  result: z.any().describe('Result to return'),
  ok: z.boolean().default(true).describe('Whether the response is successful'),
  error_code: z.string().optional().describe('Error code if ok=false'),
  error_message: z.string().optional().describe('Error message if ok=false'),
});

// ============================================================================
// Pending Requests (for timeout handling)
// ============================================================================

interface PendingQuery {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  request: RpcRequest;
}

const pendingQueries = new Map<string, PendingQuery>();

/**
 * Handle incoming RPC response (called by ws-server when response arrives)
 */
export function handleRpcResponse(response: RpcResponse): boolean {
  const pending = pendingQueries.get(response.correlationId);
  if (!pending) {
    return false;
  }

  clearTimeout(pending.timeout);
  pendingQueries.delete(response.correlationId);

  if (response.ok) {
    pending.resolve(response.result);
  } else {
    const error = response.error ?? { code: 'INTERNAL', message: 'Unknown error' };
    pending.reject(new Error(`[${error.code}] ${error.message}`));
  }

  return true;
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Query another agent and wait for response
 */
export async function handleAgentQuery(
  params: z.infer<typeof AgentQuerySchema>,
  fromAgentId: number = 0  // 0 = orchestrator
): Promise<{ success: boolean; result?: any; error?: string }> {
  const { to_agent, method, params: queryParams, timeout_ms, thread_id } = params;

  // Check if target agent is connected
  if (!isAgentConnected(to_agent)) {
    return {
      success: false,
      error: `Agent ${to_agent} is not connected`,
    };
  }

  // Create RPC request
  const request = createRpcRequest(
    { agentId: fromAgentId },
    { agentId: to_agent },
    method,
    queryParams,
    {
      timeoutMs: timeout_ms,
      threadId: thread_id ?? ulid(),
    }
  );

  // Send and wait for response
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingQueries.delete(request.correlationId);
      resolve({
        success: false,
        error: `Query timeout: ${method} to agent ${to_agent} (${timeout_ms}ms)`,
      });
    }, timeout_ms);

    pendingQueries.set(request.correlationId, {
      resolve: (result) => resolve({ success: true, result }),
      reject: (error) => resolve({ success: false, error: error.message }),
      timeout,
      request,
    });

    const sent = sendAgentMessage(to_agent, request);
    if (!sent) {
      clearTimeout(timeout);
      pendingQueries.delete(request.correlationId);
      resolve({
        success: false,
        error: `Failed to send query to agent ${to_agent}`,
      });
    }
  });
}

/**
 * Broadcast an event to all connected agents
 */
export function handleAgentBroadcast(
  params: z.infer<typeof AgentBroadcastSchema>,
  fromAgentId: number = 0
): { success: boolean; delivered_to: number[] } {
  const { topic, payload, thread_id } = params;

  const connected = getConnectedAgents();
  const delivered: number[] = [];

  const event = createEvent(
    { agentId: fromAgentId },
    { agentId: 0 },  // 0 = broadcast
    topic,
    payload,
    { threadId: thread_id }
  );

  for (const agentId of connected) {
    if (agentId !== fromAgentId) {
      const eventCopy: EventMessage = { ...event, to: { agentId } };
      if (sendAgentMessage(agentId, eventCopy)) {
        delivered.push(agentId);
      }
    }
  }

  return {
    success: true,
    delivered_to: delivered,
  };
}

/**
 * List connected agents
 */
export function handleAgentListConnected(): {
  success: boolean;
  agents: number[];
  count: number;
} {
  const agents = getConnectedAgents();
  return {
    success: true,
    agents,
    count: agents.length,
  };
}

/**
 * Check if a specific agent is connected
 */
export function handleAgentCheckConnected(agentId: number): {
  success: boolean;
  connected: boolean;
} {
  return {
    success: true,
    connected: isAgentConnected(agentId),
  };
}

// ============================================================================
// Tool Definitions (for MCP registration)
// ============================================================================

export const agentQueryTools = [
  {
    name: 'agent_query',
    description: 'Query another agent directly and wait for response. Use for asking questions, requesting analysis, or getting help from other agents.',
    inputSchema: {
      type: 'object',
      properties: {
        to_agent: { type: 'number', description: 'Target agent ID' },
        method: { type: 'string', description: 'Query method: ask, analyze, review, help' },
        params: { type: 'object', description: 'Parameters for the query' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds', default: 30000 },
        thread_id: { type: 'string', description: 'Thread ID for conversation grouping' },
      },
      required: ['to_agent', 'method', 'params'],
    },
  },
  {
    name: 'agent_broadcast',
    description: 'Broadcast an event to all connected agents. Use for status updates, announcements, or coordination.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Event topic (e.g., status.changed, task.completed)' },
        payload: { type: 'object', description: 'Event payload data' },
        thread_id: { type: 'string', description: 'Thread ID for conversation grouping' },
      },
      required: ['topic', 'payload'],
    },
  },
  {
    name: 'agent_list_connected',
    description: 'List all currently connected agents',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'agent_check_connected',
    description: 'Check if a specific agent is connected',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'number', description: 'Agent ID to check' },
      },
      required: ['agent_id'],
    },
  },
];

// ============================================================================
// Handler Map (for MCP server)
// ============================================================================

export const agentQueryHandlers = {
  agent_query: async (args: any) => {
    const params = AgentQuerySchema.parse(args);
    return handleAgentQuery(params);
  },
  agent_broadcast: (args: any) => {
    const params = AgentBroadcastSchema.parse(args);
    return handleAgentBroadcast(params);
  },
  agent_list_connected: () => {
    return handleAgentListConnected();
  },
  agent_check_connected: (args: any) => {
    const agentId = z.number().int().positive().parse(args.agent_id);
    return handleAgentCheckConnected(agentId);
  },
};
