/**
 * Context Tool Handlers
 * update_shared_context, get_shared_context
 */

import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { CONFIG } from '../../config';
import { successResponse } from '../../utils/response';
import {
  UpdateSharedContextSchema,
  type UpdateSharedContextInput,
} from '../../utils/validation';
import type { ToolDefinition, ToolHandler } from '../../types';
import { embedContext, isInitialized } from '../../../vector-db';

// ============ Tool Definitions ============

export const contextTools: ToolDefinition[] = [
  {
    name: "update_shared_context",
    description: "Update context",
    inputSchema: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    },
  },
  {
    name: "get_shared_context",
    description: "Get context",
    inputSchema: { type: "object", properties: {} },
  },
];

// ============ Tool Handlers ============

async function updateSharedContext(args: unknown) {
  const input = UpdateSharedContextSchema.parse(args) as UpdateSharedContextInput;
  const { content } = input;

  await mkdir(CONFIG.SHARED_DIR, { recursive: true });
  await writeFile(`${CONFIG.SHARED_DIR}/context.md`, content);

  // Auto-embed context for semantic search (non-blocking)
  if (isInitialized()) {
    const versionId = `ctx_${Date.now()}`;
    embedContext(versionId, content, {
      updated_by: 'orchestrator',
      created_at: new Date().toISOString(),
    }).catch(() => {}); // Silently ignore embedding errors
  }

  return successResponse(
    `Shared context updated (${content.length} chars). All agents will have access to this context.`
  );
}

async function getSharedContext() {
  const contextPath = `${CONFIG.SHARED_DIR}/context.md`;

  if (!existsSync(contextPath)) {
    return successResponse("No shared context set");
  }

  const content = await readFile(contextPath, "utf-8");
  return successResponse(content);
}

// ============ Export Handlers Map ============

export const contextHandlers: Record<string, ToolHandler> = {
  update_shared_context: updateSharedContext,
  get_shared_context: getSharedContext,
};
