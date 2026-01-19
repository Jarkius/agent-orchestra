/**
 * Agent Memory Service
 *
 * Unified service layer for agent-scoped memory operations.
 * Provides CRUD operations with automatic agent isolation and visibility controls.
 *
 * Key concepts:
 * - agent_id: null = orchestrator (shared with all), integer = specific agent
 * - visibility: 'private' (agent-only), 'shared' (agents can see), 'public' (all can see)
 */

import {
  createSession,
  getSessionById,
  listSessionsFromDb,
  createLearning,
  getLearningById,
  listLearningsFromDb,
  createSessionLink,
  createLearningLink,
  getLinkedSessions,
  getLinkedLearnings,
  getSessionTasks,
  createSessionTask,
  type SessionRecord,
  type LearningRecord,
  type SessionTask,
  type Visibility,
  type ListSessionsOptions,
  type ListLearningsOptions,
} from '../db';

import {
  saveSession as saveSessionToVector,
  searchSessions as searchSessionsVector,
  saveLearning as saveLearningToVector,
  searchLearnings as searchLearningsVector,
  findSimilarSessions,
  findSimilarLearnings,
  initVectorDB,
  isInitialized,
  type SessionSearchOptions,
  type LearningSearchOptions,
} from '../vector-db';

// ============ Types ============

export interface AgentSessionInput {
  summary: string;
  full_context?: SessionRecord['full_context'];
  duration_mins?: number;
  commits_count?: number;
  tags?: string[];
  next_steps?: string[];
  challenges?: string[];
  visibility?: Visibility;
}

export interface AgentLearningInput {
  category: string;
  title: string;
  description?: string;
  context?: string;
  source_session_id?: string;
  confidence?: 'low' | 'medium' | 'high' | 'proven';
  visibility?: Visibility;
}

export interface SessionWithLinks {
  session: SessionRecord;
  tasks: SessionTask[];
  linkedSessions: Array<{ session: SessionRecord; link_type: string; similarity?: number }>;
  autoLinked?: string[];
  suggestedLinks?: Array<{ id: string; similarity: number; summary?: string }>;
}

export interface LearningWithLinks {
  learning: LearningRecord;
  linkedLearnings: Array<{ learning: LearningRecord; link_type: string; similarity?: number }>;
  autoLinked?: string[];
  suggestedLinks?: Array<{ id: string; similarity: number; summary?: string }>;
}

export interface AgentSearchOptions {
  limit?: number;
  includeShared?: boolean;
}

// ============ Session Operations ============

/**
 * Create a session for an agent with auto-linking
 */
export async function createAgentSession(
  agentId: number | null,
  input: AgentSessionInput
): Promise<SessionWithLinks> {
  const sessionId = `session_${Date.now()}`;
  const visibility = input.visibility || (agentId === null ? 'public' : 'private');

  // Create session in SQLite
  const sessionRecord: SessionRecord = {
    id: sessionId,
    summary: input.summary,
    full_context: input.full_context,
    duration_mins: input.duration_mins,
    commits_count: input.commits_count,
    tags: input.tags,
    next_steps: input.next_steps,
    challenges: input.challenges,
    agent_id: agentId,
    visibility,
  };
  createSession(sessionRecord);

  // Save to vector DB for semantic search
  if (!isInitialized()) {
    await initVectorDB();
  }

  await saveSessionToVector(sessionId, input.summary, {
    tags: input.tags,
    created_at: new Date().toISOString(),
    agent_id: agentId,
    visibility,
  });

  // Auto-link to similar sessions (within agent scope)
  const linkResult = await findSimilarSessions(input.summary, sessionId);

  // Create auto-links for high similarity matches
  for (const similar of linkResult.autoLinked) {
    // Check if the similar session is accessible to this agent
    const similarSession = getSessionById(similar.id);
    if (similarSession && canAccessSession(agentId, similarSession)) {
      createSessionLink(sessionId, similar.id, 'similar', similar.similarity);
    }
  }

  // Return session with context
  const session = getSessionById(sessionId)!;
  return {
    session,
    tasks: [],
    linkedSessions: getLinkedSessions(sessionId),
    autoLinked: linkResult.autoLinked.map(l => l.id),
    suggestedLinks: linkResult.suggested,
  };
}

/**
 * Get a session by ID with agent access control
 */
export function getAgentSession(
  agentId: number | null,
  sessionId: string
): SessionWithLinks | null {
  const session = getSessionById(sessionId);
  if (!session) return null;

  // Check access
  if (!canAccessSession(agentId, session)) {
    return null;
  }

  return {
    session,
    tasks: getSessionTasks(sessionId),
    linkedSessions: getLinkedSessions(sessionId),
  };
}

/**
 * List sessions for an agent
 */
export function listAgentSessions(
  agentId: number | null,
  options: AgentSearchOptions = {}
): SessionRecord[] {
  const { limit = 20, includeShared = true } = options;

  return listSessionsFromDb({
    agentId,
    includeShared,
    limit,
  });
}

/**
 * Search sessions with agent scoping
 */
export async function searchAgentSessions(
  agentId: number | null,
  query: string,
  options: AgentSearchOptions = {}
): Promise<SessionWithLinks[]> {
  const { limit = 5, includeShared = true } = options;

  if (!isInitialized()) {
    await initVectorDB();
  }

  const searchOptions: SessionSearchOptions = {
    limit,
    agentId,
    includeShared,
  };

  const results = await searchSessionsVector(query, searchOptions);

  // Process results with access control
  const sessionsWithLinks: SessionWithLinks[] = [];

  if (results.ids[0]?.length) {
    for (let i = 0; i < results.ids[0].length; i++) {
      const id = results.ids[0]![i]!;
      const session = getSessionById(id);

      if (session && canAccessSession(agentId, session)) {
        sessionsWithLinks.push({
          session,
          tasks: getSessionTasks(id),
          linkedSessions: getLinkedSessions(id),
        });
      }
    }
  }

  return sessionsWithLinks;
}

// ============ Learning Operations ============

/**
 * Create a learning for an agent with auto-linking
 */
export async function createAgentLearning(
  agentId: number | null,
  input: AgentLearningInput
): Promise<LearningWithLinks> {
  const visibility = input.visibility || (agentId === null ? 'public' : 'private');

  // Create learning in SQLite
  const learningRecord: LearningRecord = {
    category: input.category,
    title: input.title,
    description: input.description,
    context: input.context,
    source_session_id: input.source_session_id,
    confidence: input.confidence || 'medium',
    agent_id: agentId,
    visibility,
  };
  const learningId = createLearning(learningRecord);

  // Save to vector DB for semantic search
  if (!isInitialized()) {
    await initVectorDB();
  }

  await saveLearningToVector(learningId, input.title, input.description || '', {
    category: input.category,
    confidence: input.confidence || 'medium',
    source_session_id: input.source_session_id,
    created_at: new Date().toISOString(),
    agent_id: agentId,
    visibility,
  });

  // Auto-link to similar learnings
  const content = `${input.title}. ${input.description || ''}`;
  const linkResult = await findSimilarLearnings(content, learningId);

  // Create auto-links for high similarity matches
  for (const similar of linkResult.autoLinked) {
    const similarId = parseInt(similar.id);
    const similarLearning = getLearningById(similarId);
    if (similarLearning && canAccessLearning(agentId, similarLearning)) {
      createLearningLink(learningId, similarId, 'similar', similar.similarity);
    }
  }

  // Return learning with context
  const learning = getLearningById(learningId)!;
  return {
    learning,
    linkedLearnings: getLinkedLearnings(learningId),
    autoLinked: linkResult.autoLinked.map(l => l.id),
    suggestedLinks: linkResult.suggested,
  };
}

/**
 * Get a learning by ID with agent access control
 */
export function getAgentLearning(
  agentId: number | null,
  learningId: number
): LearningWithLinks | null {
  const learning = getLearningById(learningId);
  if (!learning) return null;

  // Check access
  if (!canAccessLearning(agentId, learning)) {
    return null;
  }

  return {
    learning,
    linkedLearnings: getLinkedLearnings(learningId),
  };
}

/**
 * List learnings for an agent
 */
export function listAgentLearnings(
  agentId: number | null,
  options: AgentSearchOptions & { category?: string; confidence?: string } = {}
): LearningRecord[] {
  const { limit = 50, includeShared = true, category, confidence } = options;

  return listLearningsFromDb({
    agentId,
    includeShared,
    limit,
    category,
    confidence,
  });
}

/**
 * Search learnings with agent scoping
 */
export async function searchAgentLearnings(
  agentId: number | null,
  query: string,
  options: AgentSearchOptions & { category?: string } = {}
): Promise<LearningWithLinks[]> {
  const { limit = 5, includeShared = true, category } = options;

  if (!isInitialized()) {
    await initVectorDB();
  }

  const searchOptions: LearningSearchOptions = {
    limit,
    agentId,
    includeShared,
    category,
  };

  const results = await searchLearningsVector(query, searchOptions);

  // Process results with access control
  const learningsWithLinks: LearningWithLinks[] = [];

  if (results.ids[0]?.length) {
    for (let i = 0; i < results.ids[0].length; i++) {
      const id = results.ids[0]![i]!;
      const numId = parseInt(id);
      const learning = getLearningById(numId);

      if (learning && canAccessLearning(agentId, learning)) {
        learningsWithLinks.push({
          learning,
          linkedLearnings: getLinkedLearnings(numId),
        });
      }
    }
  }

  return learningsWithLinks;
}

// ============ Visibility Management ============

/**
 * Update session visibility
 */
export function updateSessionVisibility(
  agentId: number | null,
  sessionId: string,
  visibility: Visibility
): boolean {
  const session = getSessionById(sessionId);
  if (!session) return false;

  // Only owner can change visibility
  if (!isOwner(agentId, session.agent_id)) {
    return false;
  }

  // Update in database
  const { db } = require('../db');
  db.run(`UPDATE sessions SET visibility = ? WHERE id = ?`, [visibility, sessionId]);
  return true;
}

/**
 * Update learning visibility
 */
export function updateLearningVisibility(
  agentId: number | null,
  learningId: number,
  visibility: Visibility
): boolean {
  const learning = getLearningById(learningId);
  if (!learning) return false;

  // Only owner can change visibility
  if (!isOwner(agentId, learning.agent_id)) {
    return false;
  }

  // Update in database
  const { db } = require('../db');
  db.run(`UPDATE learnings SET visibility = ? WHERE id = ?`, [visibility, learningId]);
  return true;
}

// ============ Context Bundle ============

export interface AgentContextBundle {
  agent_id: number | null;
  recent_sessions: SessionRecord[];
  high_confidence_learnings: LearningRecord[];
  relevant_sessions?: SessionWithLinks[];
  relevant_learnings?: LearningWithLinks[];
}

/**
 * Get a context bundle for an agent starting a new session
 */
export async function getAgentContextBundle(
  agentId: number | null,
  query?: string,
  options: AgentSearchOptions = {}
): Promise<AgentContextBundle> {
  const { includeShared = true } = options;

  // Get recent sessions for this agent
  const recentSessions = listAgentSessions(agentId, {
    limit: 3,
    includeShared,
  });

  // Get high-confidence learnings for this agent
  const learnings = listAgentLearnings(agentId, {
    limit: 10,
    includeShared,
    confidence: 'high',
  });

  const bundle: AgentContextBundle = {
    agent_id: agentId,
    recent_sessions: recentSessions,
    high_confidence_learnings: learnings,
  };

  // If query provided, also search for relevant content
  if (query) {
    bundle.relevant_sessions = await searchAgentSessions(agentId, query, {
      limit: 3,
      includeShared,
    });
    bundle.relevant_learnings = await searchAgentLearnings(agentId, query, {
      limit: 5,
      includeShared,
    });
  }

  return bundle;
}

// ============ Access Control Helpers ============

/**
 * Check if agent can access a session
 */
function canAccessSession(agentId: number | null, session: SessionRecord): boolean {
  // Orchestrator (null) can access everything
  if (agentId === null) {
    return true;
  }

  // Owner can always access
  if (session.agent_id === agentId) {
    return true;
  }

  // Orchestrator sessions (null agent_id) are public by default
  if (session.agent_id === null) {
    return true;
  }

  // Check visibility
  return session.visibility === 'shared' || session.visibility === 'public';
}

/**
 * Check if agent can access a learning
 */
function canAccessLearning(agentId: number | null, learning: LearningRecord): boolean {
  // Orchestrator (null) can access everything
  if (agentId === null) {
    return true;
  }

  // Owner can always access
  if (learning.agent_id === agentId) {
    return true;
  }

  // Orchestrator learnings (null agent_id) are public by default
  if (learning.agent_id === null) {
    return true;
  }

  // Check visibility
  return learning.visibility === 'shared' || learning.visibility === 'public';
}

/**
 * Check if agent is the owner of a resource
 */
function isOwner(agentId: number | null, resourceAgentId: number | null | undefined): boolean {
  // Orchestrator owns orchestrator resources
  if (agentId === null && (resourceAgentId === null || resourceAgentId === undefined)) {
    return true;
  }

  // Agent owns their own resources
  return agentId === resourceAgentId;
}

// ============ Stats ============

export interface AgentMemoryStats {
  agent_id: number | null;
  session_count: number;
  learning_count: number;
  sessions_by_visibility: Record<Visibility, number>;
  learnings_by_visibility: Record<Visibility, number>;
}

/**
 * Get memory statistics for an agent
 */
export function getAgentMemoryStats(agentId: number | null): AgentMemoryStats {
  const { db } = require('../db');

  // Count sessions
  const sessionStats = db.query(`
    SELECT
      visibility,
      COUNT(*) as count
    FROM sessions
    WHERE agent_id ${agentId === null ? 'IS NULL' : '= ?'}
    GROUP BY visibility
  `).all(agentId === null ? [] : [agentId]) as { visibility: string; count: number }[];

  // Count learnings
  const learningStats = db.query(`
    SELECT
      visibility,
      COUNT(*) as count
    FROM learnings
    WHERE agent_id ${agentId === null ? 'IS NULL' : '= ?'}
    GROUP BY visibility
  `).all(agentId === null ? [] : [agentId]) as { visibility: string; count: number }[];

  // Build result
  const sessionsByVisibility: Record<Visibility, number> = { private: 0, shared: 0, public: 0 };
  const learningsByVisibility: Record<Visibility, number> = { private: 0, shared: 0, public: 0 };

  let sessionCount = 0;
  for (const row of sessionStats) {
    const vis = (row.visibility || 'public') as Visibility;
    sessionsByVisibility[vis] = row.count;
    sessionCount += row.count;
  }

  let learningCount = 0;
  for (const row of learningStats) {
    const vis = (row.visibility || 'public') as Visibility;
    learningsByVisibility[vis] = row.count;
    learningCount += row.count;
  }

  return {
    agent_id: agentId,
    session_count: sessionCount,
    learning_count: learningCount,
    sessions_by_visibility: sessionsByVisibility,
    learnings_by_visibility: learningsByVisibility,
  };
}
