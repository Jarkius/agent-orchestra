/**
 * Gemini Browser Automation Tool Handlers
 *
 * MCP tools for parallel Gemini research via MQTT browser automation.
 * Communicates with claude-browser-proxy Chrome extension.
 *
 * @see src/services/mqtt-client.ts
 * @see https://github.com/Soul-Brews-Studio/claude-browser-proxy
 */

import { z } from 'zod';
import { jsonResponse, errorResponse, successResponse } from '../../utils/response';
import {
  GeminiBrowserClient,
  parallelGeminiQueries,
} from '../../../services/mqtt-client';
import { createLearning } from '../../../db/learnings';
import { saveLearning as saveLearningToChroma, initVectorDB, isInitialized } from '../../../vector-db';
import type { ToolDefinition, ToolHandler } from '../../types';

// ============ Schemas ============

const GeminiResearchSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(4),
  model: z.enum(['fast', 'thinking', 'pro']).optional(),
  timeout: z.number().min(5000).max(120000).optional(),
  save: z.boolean().optional(),
});

const GeminiChatSchema = z.object({
  tabId: z.number(),
  text: z.string().min(1),
  waitForResponse: z.boolean().optional(),
  timeout: z.number().min(5000).max(120000).optional(),
});

const GeminiCreateTabSchema = z.object({
  url: z.string().url().optional(),
});

const GeminiTranscribeSchema = z.object({
  videoUrl: z.string().url(),
  prompt: z.string().optional(),
});

// ============ Client Singleton ============

let clientInstance: GeminiBrowserClient | null = null;

async function getClient(): Promise<GeminiBrowserClient> {
  if (!clientInstance) {
    clientInstance = new GeminiBrowserClient();
    await clientInstance.connect();
  } else if (!clientInstance.isConnected()) {
    await clientInstance.connect();
  }
  return clientInstance;
}

// ============ Tool Definitions ============

export const geminiTools: ToolDefinition[] = [
  {
    name: 'gemini_research',
    description: `Execute parallel Gemini queries via browser automation.

    Sends multiple queries to Gemini in parallel tabs and collects responses.
    Requires: Mosquitto MQTT broker + claude-browser-proxy extension in browser.

    Example: gemini_research queries=["What is React?", "What is Vue?"] model="pro" save=true`,
    inputSchema: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of queries to send (max 4)',
        },
        model: {
          type: 'string',
          enum: ['fast', 'thinking', 'pro'],
          description: 'Gemini model to use (default: fast)',
        },
        timeout: {
          type: 'number',
          description: 'Response wait timeout in ms (default: 30000)',
        },
        save: {
          type: 'boolean',
          description: 'Save responses as learnings (default: false)',
        },
      },
      required: ['queries'],
    },
  },
  {
    name: 'gemini_chat',
    description: `Send a single message to a specific Gemini tab.

    For interactive conversations with an existing Gemini tab.
    Use gemini_create_tab first to create a tab, or gemini_list_tabs to find existing ones.`,
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Tab ID from gemini_create_tab or gemini_list_tabs',
        },
        text: {
          type: 'string',
          description: 'Message to send to Gemini',
        },
        waitForResponse: {
          type: 'boolean',
          description: 'Wait for and return response (default: true)',
        },
        timeout: {
          type: 'number',
          description: 'Response wait timeout in ms (default: 30000)',
        },
      },
      required: ['tabId', 'text'],
    },
  },
  {
    name: 'gemini_create_tab',
    description: `Create a new Gemini browser tab.

    Opens a new tab in the browser pointing to Gemini.
    Returns the tabId for use with gemini_chat.`,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to open (default: https://gemini.google.com/app)',
        },
      },
      required: [],
    },
  },
  {
    name: 'gemini_list_tabs',
    description: 'List all open Gemini tabs in the browser.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'gemini_transcribe',
    description: `Transcribe a YouTube video using Gemini.

    Creates a new Gemini tab and sends a transcription request.
    Returns the tabId for checking the response later.`,
    inputSchema: {
      type: 'object',
      properties: {
        videoUrl: {
          type: 'string',
          description: 'YouTube video URL to transcribe',
        },
        prompt: {
          type: 'string',
          description: 'Custom prompt for transcription (optional)',
        },
      },
      required: ['videoUrl'],
    },
  },
  {
    name: 'gemini_status',
    description: 'Check MQTT connection status and extension availability.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ============ Tool Handlers ============

async function handleGeminiResearch(args: unknown) {
  const parsed = GeminiResearchSchema.parse(args);
  const { queries, model, timeout = 30000, save = false } = parsed;

  try {
    const client = await getClient();

    const results = await parallelGeminiQueries(client, queries, {
      model,
      timeout,
    });

    // Save as learnings if requested
    if (save) {
      if (!isInitialized()) {
        await initVectorDB();
      }

      for (const result of results) {
        const title = `Gemini: ${result.query.substring(0, 50)}${result.query.length > 50 ? '...' : ''}`;

        const learningId = createLearning({
          category: 'research',
          title,
          description: result.response,
          context: `Query: ${result.query}\n\nSource: Gemini (${model || 'default'} model)\nTab ID: ${result.tabId}`,
          confidence: 'low',
          maturity_stage: 'observation',
        });

        await saveLearningToChroma({
          id: learningId,
          category: 'research',
          title,
          description: result.response,
        });
      }
    }

    return jsonResponse({
      success: true,
      count: results.length,
      saved: save,
      results: results.map((r) => ({
        query: r.query,
        tabId: r.tabId,
        responseLength: r.response.length,
        responsePreview: r.response.substring(0, 200) + (r.response.length > 200 ? '...' : ''),
      })),
      fullResponses: results.map((r) => ({
        query: r.query,
        response: r.response,
      })),
    });
  } catch (error) {
    return errorResponse((error as Error).message);
  }
}

async function handleGeminiChat(args: unknown) {
  const parsed = GeminiChatSchema.parse(args);
  const { tabId, text, waitForResponse = true, timeout = 30000 } = parsed;

  try {
    const client = await getClient();

    await client.chat(tabId, text);

    if (waitForResponse) {
      const response = await client.waitResponse(tabId, timeout);
      return jsonResponse({
        success: true,
        tabId,
        query: text,
        response,
        responseLength: response.length,
      });
    }

    return successResponse(`Message sent to tab ${tabId}. Use gemini_chat with waitForResponse=true to get the response.`);
  } catch (error) {
    return errorResponse((error as Error).message);
  }
}

async function handleGeminiCreateTab(args: unknown) {
  const parsed = GeminiCreateTabSchema.parse(args);
  const url = parsed.url || 'https://gemini.google.com/app';

  try {
    const client = await getClient();
    const tabId = await client.createTab(url);

    return jsonResponse({
      success: true,
      tabId,
      url,
      message: `Tab created. Use tabId=${tabId} with gemini_chat to send messages.`,
    });
  } catch (error) {
    return errorResponse((error as Error).message);
  }
}

async function handleGeminiListTabs() {
  try {
    const client = await getClient();
    const tabs = await client.listTabs();

    return jsonResponse({
      success: true,
      count: tabs.length,
      tabs,
    });
  } catch (error) {
    return errorResponse((error as Error).message);
  }
}

async function handleGeminiTranscribe(args: unknown) {
  const parsed = GeminiTranscribeSchema.parse(args);
  const { videoUrl, prompt } = parsed;

  try {
    const client = await getClient();
    const result = await client.transcribe(videoUrl, { prompt });

    return jsonResponse({
      success: true,
      tabId: result.tabId,
      video: result.video,
      message: `Transcription request sent. Use gemini_chat with tabId=${result.tabId} and waitForResponse=true to get the transcription.`,
    });
  } catch (error) {
    return errorResponse((error as Error).message);
  }
}

async function handleGeminiStatus() {
  try {
    const client = await getClient();
    const tabs = await client.listTabs();

    return jsonResponse({
      success: true,
      connected: true,
      mqttBroker: 'mqtt://localhost:1883',
      geminiTabs: tabs.length,
      tabs: tabs.map((t) => ({ id: t.id, title: t.title?.substring(0, 50) })),
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      connected: false,
      error: (error as Error).message,
      troubleshooting: [
        'Check Mosquitto is running: brew services list',
        'Check extension is loaded: brave://extensions/',
        'Extension badge should be green',
        'Browser must be signed into Gemini',
      ],
    });
  }
}

// ============ Exports ============

export const geminiHandlers: Record<string, ToolHandler> = {
  gemini_research: handleGeminiResearch,
  gemini_chat: handleGeminiChat,
  gemini_create_tab: handleGeminiCreateTab,
  gemini_list_tabs: handleGeminiListTabs,
  gemini_transcribe: handleGeminiTranscribe,
  gemini_status: handleGeminiStatus,
};
