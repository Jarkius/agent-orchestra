/**
 * External LLM Integration Service
 *
 * Provides access to external LLM APIs (Gemini, OpenAI, Anthropic)
 * for specialized tasks like research, analysis, and multi-model workflows.
 *
 * Usage:
 *   const llm = new ExternalLLM('gemini');
 *   const response = await llm.query('What is the capital of France?');
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Load API keys from environment or .env.local
function loadApiKeys(): Record<string, string> {
  const keys: Record<string, string> = {};

  // Check environment variables first
  if (process.env.GEMINI_API_KEY) keys.gemini = process.env.GEMINI_API_KEY;
  if (process.env.OPENAI_API_KEY) keys.openai = process.env.OPENAI_API_KEY;
  if (process.env.ANTHROPIC_API_KEY) keys.anthropic = process.env.ANTHROPIC_API_KEY;

  // Try loading from .env.local
  const envPath = join(process.cwd(), '.env.local');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^(GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)=(.+)$/);
      if (match) {
        const key = match[1]!.replace('_API_KEY', '').toLowerCase();
        keys[key] = match[2]!.trim();
      }
    }
  }

  return keys;
}

const API_KEYS = loadApiKeys();

export type LLMProvider = 'gemini' | 'openai' | 'anthropic';

export interface LLMOptions {
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  thinkingLevel?: 'low' | 'medium' | 'high';  // Gemini 3 feature
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';  // GPT-5+ feature
}

export interface LLMResponse {
  text: string;
  model: string;
  provider: LLMProvider;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// Gemini model configurations
const GEMINI_MODELS = {
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini-3-pro': 'gemini-3-pro-preview',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-2.5-pro': 'gemini-2.5-pro',
} as const;

export class ExternalLLM {
  private provider: LLMProvider;
  private apiKey: string;

  constructor(provider: LLMProvider = 'gemini') {
    this.provider = provider;
    const key = API_KEYS[provider];
    if (!key) {
      throw new Error(
        `No API key found for ${provider}. ` +
        `Set ${provider.toUpperCase()}_API_KEY in environment or .env.local`
      );
    }
    this.apiKey = key;
  }

  async query(prompt: string, options: LLMOptions = {}): Promise<LLMResponse> {
    switch (this.provider) {
      case 'gemini':
        return this.queryGemini(prompt, options);
      case 'openai':
        return this.queryOpenAI(prompt, options);
      case 'anthropic':
        return this.queryAnthropic(prompt, options);
      default:
        throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  private async queryGemini(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    // Default to Gemini 3 Flash (latest, fast)
    const modelKey = options.model || 'gemini-3-flash';
    const model = GEMINI_MODELS[modelKey as keyof typeof GEMINI_MODELS] || modelKey;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    const body: any = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: options.maxOutputTokens || 8192,
        temperature: options.temperature ?? 0.7,
      },
    };

    // Add thinkingConfig for Gemini 3 models (inside generationConfig)
    if (model.includes('gemini-3') && options.thinkingLevel) {
      body.generationConfig.thinkingConfig = {
        thinkingLevel: options.thinkingLevel.toLowerCase(),
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${error}`);
    }

    const data = await response.json() as any;

    // When thinking is enabled, response may have multiple parts (thoughts + text)
    // Extract all text parts and join them
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts
      .filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join('\n\n') || '';

    const usage = data.usageMetadata;

    return {
      text,
      model,
      provider: 'gemini',
      usage: usage ? {
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
      } : undefined,
    };
  }

  private async queryOpenAI(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    const model = options.model || 'gpt-4o';

    // GPT-5+ uses max_completion_tokens instead of max_tokens
    const isGpt5Plus = model.startsWith('gpt-5') || model.startsWith('o1') || model.startsWith('o3');
    const tokenParam = isGpt5Plus ? 'max_completion_tokens' : 'max_tokens';

    const body: any = {
      model,
      messages: [{ role: 'user', content: prompt }],
      [tokenParam]: options.maxOutputTokens || 4096,
    };

    // Add reasoning_effort for GPT-5+ models (temperature must be 1 when reasoning is enabled)
    if (isGpt5Plus && options.reasoningEffort) {
      body.reasoning_effort = options.reasoningEffort;
      body.temperature = 1;  // Required when reasoning is enabled
    } else {
      body.temperature = options.temperature ?? 0.7;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json() as any;

    return {
      text: data.choices?.[0]?.message?.content || '',
      model,
      provider: 'openai',
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens || 0,
        outputTokens: data.usage.completion_tokens || 0,
      } : undefined,
    };
  }

  private async queryAnthropic(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    const model = options.model || 'claude-3-5-sonnet-20241022';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options.maxOutputTokens || 4096,
        temperature: options.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    const data = await response.json() as any;

    return {
      text: data.content?.[0]?.text || '',
      model,
      provider: 'anthropic',
      usage: data.usage ? {
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
      } : undefined,
    };
  }

  // Static helper to check which providers are available
  static getAvailableProviders(): LLMProvider[] {
    return Object.entries(API_KEYS)
      .filter(([_, key]) => key)
      .map(([provider]) => provider as LLMProvider);
  }

  // Quick query helper
  static async quickQuery(
    prompt: string,
    provider: LLMProvider = 'gemini',
    options?: LLMOptions
  ): Promise<string> {
    const llm = new ExternalLLM(provider);
    const response = await llm.query(prompt, options);
    return response.text;
  }
}

// Export convenience functions
export const queryGemini = (prompt: string, options?: LLMOptions) =>
  ExternalLLM.quickQuery(prompt, 'gemini', options);

export const queryOpenAI = (prompt: string, options?: LLMOptions) =>
  ExternalLLM.quickQuery(prompt, 'openai', options);

export const queryAnthropic = (prompt: string, options?: LLMOptions) =>
  ExternalLLM.quickQuery(prompt, 'anthropic', options);
