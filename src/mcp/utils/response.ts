/**
 * MCP Response Utilities
 * Standardized response builders for consistent output format
 */

import type { MCPResponse } from '../types';

/**
 * Create a success response with text content
 */
export function successResponse(text: string): MCPResponse {
  return {
    content: [{ type: "text", text }],
  };
}

/**
 * Create a response with JSON-formatted data
 */
export function jsonResponse(data: unknown): MCPResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Create an error response
 */
export function errorResponse(message: string): MCPResponse {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Create a "not found" response
 */
export function notFoundResponse(entity: string, id: string | number): MCPResponse {
  return {
    content: [{ type: "text", text: `${entity} not found: ${id}` }],
  };
}

/**
 * Create a response with formatted message and optional data
 */
export function messageWithData(message: string, data?: unknown): MCPResponse {
  const text = data
    ? `${message}\n\n${JSON.stringify(data, null, 2)}`
    : message;
  return {
    content: [{ type: "text", text }],
  };
}
