/**
 * LLM Provider Abstraction — Phase C (Multi-Provider Gateway)
 *
 * Supports: Google Gemini, OpenAI GPT, Anthropic Claude (optional)
 * Auto-detects available providers from env vars.
 * Normalizes tool_use / function_calling across all three.
 */

import { GoogleGenAI, type Content, type Part, type FunctionCall, type Tool as GeminiTool } from '@google/genai';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

// ============ Types ============

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: 'end' | 'tool_use';
  tokensUsed: number;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
}

export interface CompletionParams {
  model: string;
  system: string;
  userMessage: string;
  tools: ToolDef[];
  maxTokens: number;
  // For continuing tool_use loops
  conversationHistory?: unknown[];
}

export interface LLMProvider {
  name: string;
  available: boolean;
  createCompletion(params: CompletionParams): Promise<LLMResponse>;
  continueWithToolResults(
    params: CompletionParams,
    previousResponse: LLMResponse,
    toolResults: ToolResult[],
    history: unknown[]
  ): Promise<{ response: LLMResponse; history: unknown[] }>;
}

// ============ Model Tier Mapping ============

export interface ModelConfig {
  provider: string;
  gemini: { opus: string; sonnet: string; haiku: string };
  openai: { opus: string; sonnet: string; haiku: string };
  anthropic: { opus: string; sonnet: string; haiku: string };
}

export const DEFAULT_MODELS: ModelConfig = {
  provider: 'auto', // auto-detect from env vars
  gemini: {
    opus: 'gemini-2.0-flash',       // Best available
    sonnet: 'gemini-2.0-flash',     // Good balance
    haiku: 'gemini-2.0-flash-lite', // Fastest/cheapest
  },
  openai: {
    opus: 'gpt-4o',
    sonnet: 'gpt-4o-mini',
    haiku: 'gpt-4o-mini',
  },
  anthropic: {
    opus: 'claude-opus-4-6',
    sonnet: 'claude-sonnet-4-5-20250929',
    haiku: 'claude-haiku-4-5-20251001',
  },
};

// ============ Google Gemini Provider ============

class GeminiProvider implements LLMProvider {
  name = 'gemini';
  available: boolean;
  private client: GoogleGenAI | null = null;

  constructor() {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    this.available = !!apiKey;
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  private convertTools(tools: ToolDef[]): GeminiTool[] {
    return [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema as Record<string, unknown>,
      })),
    }];
  }

  async createCompletion(params: CompletionParams): Promise<LLMResponse> {
    if (!this.client) throw new Error('Gemini not initialized');

    const contents: Content[] = [
      { role: 'user', parts: [{ text: params.userMessage }] },
    ];

    const response = await this.client.models.generateContent({
      model: params.model,
      contents,
      config: {
        systemInstruction: params.system,
        maxOutputTokens: params.maxTokens,
        tools: this.convertTools(params.tools),
      },
    });

    return this.parseResponse(response);
  }

  async continueWithToolResults(
    params: CompletionParams,
    previousResponse: LLMResponse,
    toolResults: ToolResult[],
    history: unknown[]
  ): Promise<{ response: LLMResponse; history: unknown[] }> {
    if (!this.client) throw new Error('Gemini not initialized');

    const contents = history as Content[];

    // Add assistant response with function calls
    const fcParts: Part[] = previousResponse.toolCalls.map(tc => ({
      functionCall: { name: tc.name, args: tc.input } as FunctionCall,
    }));
    contents.push({ role: 'model', parts: fcParts });

    // Add function responses
    const frParts: Part[] = toolResults.map(tr => ({
      functionResponse: {
        name: previousResponse.toolCalls.find(tc => tc.id === tr.toolCallId)?.name || 'unknown',
        response: { result: tr.output },
      },
    }));
    contents.push({ role: 'user', parts: frParts });

    const response = await this.client.models.generateContent({
      model: params.model,
      contents,
      config: {
        systemInstruction: params.system,
        maxOutputTokens: params.maxTokens,
        tools: this.convertTools(params.tools),
      },
    });

    return { response: this.parseResponse(response), history: contents };
  }

  private parseResponse(response: Awaited<ReturnType<InstanceType<typeof GoogleGenAI>['models']['generateContent']>>): LLMResponse {
    const candidate = response.candidates?.[0];
    if (!candidate) return { text: 'No response', toolCalls: [], stopReason: 'end', tokensUsed: 0 };

    const parts = candidate.content?.parts || [];
    const textParts = parts.filter(p => 'text' in p && p.text).map(p => (p as { text: string }).text);
    const fcParts = parts.filter(p => 'functionCall' in p && p.functionCall);

    const toolCalls: ToolCall[] = fcParts.map((p, i) => {
      const fc = (p as { functionCall: FunctionCall }).functionCall;
      return {
        id: `fc_${i}_${Date.now()}`,
        name: fc.name || 'unknown',
        input: (fc.args || {}) as Record<string, unknown>,
      };
    });

    const tokensUsed = (response.usageMetadata?.promptTokenCount || 0) +
                       (response.usageMetadata?.candidatesTokenCount || 0);

    return {
      text: textParts.join('\n'),
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
      tokensUsed,
    };
  }
}

// ============ OpenAI Provider ============

class OpenAIProvider implements LLMProvider {
  name = 'openai';
  available: boolean;
  private client: OpenAI | null = null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.available = !!apiKey;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  private convertTools(tools: ToolDef[]): ChatCompletionTool[] {
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  async createCompletion(params: CompletionParams): Promise<LLMResponse> {
    if (!this.client) throw new Error('OpenAI not initialized');

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: params.system },
      { role: 'user', content: params.userMessage },
    ];

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages,
      tools: this.convertTools(params.tools),
      max_tokens: params.maxTokens,
    });

    return this.parseResponse(response);
  }

  async continueWithToolResults(
    params: CompletionParams,
    previousResponse: LLMResponse,
    toolResults: ToolResult[],
    history: unknown[]
  ): Promise<{ response: LLMResponse; history: unknown[] }> {
    if (!this.client) throw new Error('OpenAI not initialized');

    const messages = history as ChatCompletionMessageParam[];

    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      tool_calls: previousResponse.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.input) },
      })),
    });

    // Add tool results
    for (const tr of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: tr.toolCallId,
        content: tr.output,
      });
    }

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages,
      tools: this.convertTools(params.tools),
      max_tokens: params.maxTokens,
    });

    return { response: this.parseResponse(response), history: messages };
  }

  private parseResponse(response: OpenAI.Chat.Completions.ChatCompletion): LLMResponse {
    const choice = response.choices[0];
    if (!choice) return { text: 'No response', toolCalls: [], stopReason: 'end', tokensUsed: 0 };

    const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || '{}'),
    }));

    const tokensUsed = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);

    return {
      text: choice.message.content || '',
      toolCalls,
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end',
      tokensUsed,
    };
  }
}

// ============ Anthropic Provider (Optional) ============

class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  available: boolean;
  private Anthropic: typeof import('@anthropic-ai/sdk').default | null = null;
  private client: InstanceType<typeof import('@anthropic-ai/sdk').default> | null = null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.available = !!apiKey;
    // Lazy-load to avoid import error if SDK issues
    if (apiKey) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const SDK = require('@anthropic-ai/sdk').default;
        this.Anthropic = SDK;
        this.client = new SDK({ apiKey });
      } catch {
        this.available = false;
      }
    }
  }

  async createCompletion(params: CompletionParams): Promise<LLMResponse> {
    if (!this.client) throw new Error('Anthropic not initialized');

    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: [{ role: 'user', content: params.userMessage }],
      tools: params.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Record<string, unknown>,
      })),
    });

    return this.parseResponse(response);
  }

  async continueWithToolResults(
    params: CompletionParams,
    previousResponse: LLMResponse,
    toolResults: ToolResult[],
    history: unknown[]
  ): Promise<{ response: LLMResponse; history: unknown[] }> {
    if (!this.client) throw new Error('Anthropic not initialized');

    type AnthropicMessage = { role: string; content: unknown };
    const messages = history as AnthropicMessage[];

    // Add assistant content blocks
    const assistantBlocks = [
      ...(previousResponse.text ? [{ type: 'text', text: previousResponse.text }] : []),
      ...previousResponse.toolCalls.map(tc => ({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
    ];
    messages.push({ role: 'assistant', content: assistantBlocks });

    // Add tool results
    messages.push({
      role: 'user',
      content: toolResults.map(tr => ({
        type: 'tool_result',
        tool_use_id: tr.toolCallId,
        content: tr.output,
      })),
    });

    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: messages as Parameters<typeof this.client.messages.create>[0]['messages'],
      tools: params.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Record<string, unknown>,
      })),
    });

    return { response: this.parseResponse(response), history: messages };
  }

  private parseResponse(response: { content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>; stop_reason?: string | null; usage?: { input_tokens?: number; output_tokens?: number } }): LLMResponse {
    const textBlocks = response.content.filter(b => b.type === 'text');
    const toolBlocks = response.content.filter(b => b.type === 'tool_use');

    return {
      text: textBlocks.map(b => b.text || '').join('\n'),
      toolCalls: toolBlocks.map(b => ({
        id: b.id || `tc_${Date.now()}`,
        name: b.name || 'unknown',
        input: (b.input || {}) as Record<string, unknown>,
      })),
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end',
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };
  }
}

// ============ Provider Registry ============

let _providers: LLMProvider[] | null = null;

export function getProviders(): LLMProvider[] {
  if (_providers) return _providers;
  _providers = [
    new GeminiProvider(),
    new OpenAIProvider(),
    new AnthropicProvider(),
  ];
  return _providers;
}

/**
 * Select the best available provider.
 * Priority: configured preference > gemini > openai > anthropic
 */
export function selectProvider(preference?: string): LLMProvider {
  const providers = getProviders();
  const available = providers.filter(p => p.available);

  if (available.length === 0) {
    throw new Error(
      'No LLM provider available. Set one of: GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY'
    );
  }

  // Prefer configured provider
  if (preference && preference !== 'auto') {
    const preferred = available.find(p => p.name === preference);
    if (preferred) return preferred;
  }

  // Auto: prefer Gemini (free tier / user has it) > OpenAI > Anthropic
  return available[0]!;
}

/**
 * Get the model ID for a given tier and provider.
 */
export function getModelForTier(
  tier: 'opus' | 'sonnet' | 'haiku',
  provider: LLMProvider,
  config?: Partial<ModelConfig>
): string {
  const models = { ...DEFAULT_MODELS, ...config };
  const providerModels = models[provider.name as keyof Pick<ModelConfig, 'gemini' | 'openai' | 'anthropic'>];
  if (providerModels && typeof providerModels === 'object') {
    return (providerModels as Record<string, string>)[tier] || (providerModels as Record<string, string>)['sonnet']!;
  }
  // Fallback
  return models.gemini.sonnet;
}

/**
 * List available providers for diagnostics.
 */
export function listProviders(): { name: string; available: boolean }[] {
  return getProviders().map(p => ({ name: p.name, available: p.available }));
}
