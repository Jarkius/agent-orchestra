/**
 * Database operations - Agent Orchestra
 *
 * This module re-exports all database functions from focused modules.
 * Schema initialization is handled by ./core.ts.
 *
 * Module structure:
 * - core.ts: Schema, migrations, db instance
 * - utils.ts: Common utilities
 * - agents.ts: Agent registry and lifecycle
 * - events.ts: Agent lifecycle events
 * - messages.ts: Agent communication logging
 * - conversations.ts: Agent-to-agent conversations
 * - agent-tasks.ts: Task lifecycle and mission persistence
 * - unified-tasks.ts: Business requirement tracking
 * - sessions.ts: Session memory
 * - learnings.ts: Knowledge capture
 * - entities.ts: Knowledge graph
 * - code-files.ts: Code file indexing
 * - code-symbols.ts: Symbol and pattern tracking
 * - matrix-messages.ts: Cross-matrix messaging
 * - matrix-registry.ts: Matrix discovery
 * - analytics.ts: Dashboard and reporting
 * - session-tasks.ts: Task tracking within sessions
 * - knowledge.ts: Knowledge and lessons
 * - purge.ts: Data cleanup
 */

// Core exports
export { db, DB_PATH, getVectorDb } from './core';

// Utilities
export * from './utils';

// Agent management
export * from './agents';
export * from './events';
export * from './messages';
export * from './conversations';

// Task management
export * from './agent-tasks';
export * from './unified-tasks';

// Memory system
export * from './sessions';
export * from './learnings';
export * from './entities';
export * from './session-tasks';

// Code intelligence
export * from './code-files';
export * from './code-symbols';

// Cross-matrix communication
export * from './matrix-messages';
export * from './matrix-registry';

// Analytics and reporting
export * from './analytics';

// Knowledge management
export * from './knowledge';

// Data management
export * from './purge';
