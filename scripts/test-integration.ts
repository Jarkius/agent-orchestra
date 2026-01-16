#!/usr/bin/env bun
/**
 * Comprehensive Integration Test & Performance Analysis
 * Tests memory system + agent orchestration integration
 */

import {
  initVectorDB,
  saveSession,
  searchSessions,
  saveLearning,
  searchLearnings,
  findSimilarSessions,
  findSimilarLearnings,
  embedTask,
  embedResult,
  isInitialized,
  preloadEmbeddingModel,
} from '../src/vector-db';
import {
  createSession,
  createLearning,
  getSessionById,
  getLearningById,
  listSessionsFromDb,
  listLearningsFromDb,
  getSessionStats,
  getImprovementReport,
  validateLearning,
  createSessionLink,
  getLinkedSessions,
  registerAgent,
  updateAgentStatus,
  getAgent,
  sendMessage,
  type SessionRecord,
  type FullContext,
} from '../src/db';
import { createEmbeddingFunction, getEmbeddingConfig } from '../src/embeddings';

// ============ Test Utilities ============

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg: string) {
  console.log(msg);
}

function header(title: string) {
  console.log(`\n${COLORS.cyan}${COLORS.bold}${'═'.repeat(60)}${COLORS.reset}`);
  console.log(`${COLORS.cyan}${COLORS.bold}  ${title}${COLORS.reset}`);
  console.log(`${COLORS.cyan}${COLORS.bold}${'═'.repeat(60)}${COLORS.reset}\n`);
}

function subheader(title: string) {
  console.log(`\n${COLORS.yellow}── ${title} ──${COLORS.reset}\n`);
}

function success(msg: string) {
  console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`);
}

function fail(msg: string) {
  console.log(`${COLORS.red}✗${COLORS.reset} ${msg}`);
}

function info(msg: string) {
  console.log(`${COLORS.dim}  ${msg}${COLORS.reset}`);
}

function metric(name: string, value: string | number, unit?: string) {
  console.log(`  ${COLORS.blue}${name}:${COLORS.reset} ${value}${unit ? ` ${unit}` : ''}`);
}

interface PerfResult {
  name: string;
  duration: number;
  ops?: number;
}

const perfResults: PerfResult[] = [];

async function benchmark<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  perfResults.push({ name, duration });
  return result;
}

// ============ Tests ============

async function testMemorySaveRecall() {
  subheader('Memory Save/Recall Cycle');

  // Create test sessions
  const sessions = [
    {
      summary: 'Implemented user authentication with JWT tokens and refresh mechanism',
      tags: ['auth', 'jwt', 'security'],
      context: {
        what_worked: ['JWT with short expiry', 'Refresh token rotation'],
        learnings: ['Always validate token expiry server-side'],
      },
    },
    {
      summary: 'Built real-time notification system using WebSockets',
      tags: ['websocket', 'realtime', 'notifications'],
      context: {
        what_worked: ['Socket.io with Redis adapter', 'Room-based broadcasts'],
        learnings: ['Use heartbeat for connection health'],
      },
    },
    {
      summary: 'Optimized database queries with indexing and query analysis',
      tags: ['database', 'performance', 'postgresql'],
      context: {
        what_worked: ['Composite indexes on frequent queries', 'EXPLAIN ANALYZE'],
        learnings: ['Avoid N+1 queries with eager loading'],
      },
    },
  ];

  // Save sessions
  for (const s of sessions) {
    const sessionId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    await benchmark(`Save session: ${s.tags[0]}`, async () => {
      createSession({
        id: sessionId,
        summary: s.summary,
        full_context: s.context as FullContext,
        tags: s.tags,
        duration_mins: Math.floor(Math.random() * 120) + 30,
        commits_count: Math.floor(Math.random() * 10) + 1,
      });

      await saveSession(sessionId, `${s.summary} ${s.tags.join(' ')}`, {
        tags: s.tags,
        created_at: new Date().toISOString(),
      });
    });

    success(`Saved: ${sessionId}`);
    info(s.summary.substring(0, 50) + '...');
  }

  // Test recall
  const queries = ['authentication security', 'real-time websocket', 'database optimization'];

  for (const query of queries) {
    const results = await benchmark(`Recall: "${query}"`, async () => {
      return await searchSessions(query, 3);
    });

    const count = results.ids[0]?.length || 0;
    success(`Found ${count} sessions for "${query}"`);

    if (results.ids[0]?.length) {
      for (let i = 0; i < Math.min(2, results.ids[0].length); i++) {
        const distance = results.distances?.[0]?.[i] || 0;
        info(`  [${(1 - distance).toFixed(3)}] ${results.ids[0][i]}`);
      }
    }
  }
}

async function testLearningsSystem() {
  subheader('Learnings System');

  const learnings = [
    { category: 'security', title: 'Always sanitize user input', description: 'Prevent XSS and SQL injection' },
    { category: 'performance', title: 'Use connection pooling', description: 'Database connections are expensive' },
    { category: 'architecture', title: 'Prefer composition over inheritance', description: 'More flexible and testable' },
    { category: 'debugging', title: 'Log correlation IDs', description: 'Track requests across services' },
    { category: 'tooling', title: 'Automate repetitive tasks', description: 'CI/CD for consistent deployments' },
  ];

  // Add learnings
  for (const l of learnings) {
    const id = await benchmark(`Add learning: ${l.category}`, async () => {
      const learningId = createLearning({
        category: l.category,
        title: l.title,
        description: l.description,
        confidence: 'medium',
      });

      await saveLearning(learningId, l.title, l.description, {
        category: l.category,
        confidence: 'medium',
        created_at: new Date().toISOString(),
      });

      return learningId;
    });

    success(`Added learning #${id}: ${l.title}`);
  }

  // Test validation
  const allLearnings = listLearningsFromDb({ limit: 5 });
  if (allLearnings.length > 0) {
    const toValidate = allLearnings[0];

    await benchmark('Validate learning', async () => {
      validateLearning(toValidate.id!);
      validateLearning(toValidate.id!); // Twice to see progression
    });

    const updated = getLearningById(toValidate.id!);
    success(`Validated #${toValidate.id}: ${toValidate.confidence} → ${updated?.confidence}`);
  }

  // Test search
  const searchResults = await benchmark('Search learnings', async () => {
    return await searchLearnings('security input validation', 5);
  });

  success(`Search found ${searchResults.ids[0]?.length || 0} relevant learnings`);
}

async function testAutoLinking() {
  subheader('Auto-Linking System');

  // Create similar sessions
  const session1Id = `autolink_test_1_${Date.now()}`;
  const session2Id = `autolink_test_2_${Date.now()}`;

  const content1 = 'Implementing vector embeddings for semantic search using transformers';
  const content2 = 'Building semantic search with embedding models and vector databases';

  createSession({ id: session1Id, summary: content1, tags: ['embeddings', 'search'] });
  await saveSession(session1Id, content1, { tags: ['embeddings', 'search'], created_at: new Date().toISOString() });

  createSession({ id: session2Id, summary: content2, tags: ['embeddings', 'vectors'] });
  await saveSession(session2Id, content2, { tags: ['embeddings', 'vectors'], created_at: new Date().toISOString() });

  // Test similarity finding
  const { autoLinked, suggested } = await benchmark('Find similar sessions', async () => {
    return await findSimilarSessions(content2, session2Id);
  });

  success(`Auto-linked: ${autoLinked.length}, Suggested: ${suggested.length}`);

  if (autoLinked.length > 0) {
    info(`Auto-linked to: ${autoLinked[0].id} (${autoLinked[0].similarity.toFixed(3)})`);
  }
  if (suggested.length > 0) {
    info(`Suggested: ${suggested[0].id} (${suggested[0].similarity.toFixed(3)})`);
  }
}

async function testEmbeddingPerformance() {
  subheader('Embedding Performance');

  // Get embedding function
  const config = getEmbeddingConfig();
  const embedFn = await createEmbeddingFunction(config);

  const testTexts = [
    'Short text',
    'This is a medium length text that contains more information about the topic at hand.',
    'This is a longer piece of text that simulates a typical session summary or learning description. It contains multiple sentences and provides more context about what was accomplished during a coding session.',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. '.repeat(3),
  ];

  const labels = ['Short (2 words)', 'Medium (15 words)', 'Long (50 words)', 'Very long (150 words)'];

  for (let i = 0; i < testTexts.length; i++) {
    const text = testTexts[i];
    const iterations = 3; // Reduced for speed
    const times: number[] = [];

    for (let j = 0; j < iterations; j++) {
      const start = performance.now();
      await embedFn.generate([text]);
      times.push(performance.now() - start);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    metric(labels[i], `${avg.toFixed(1)}ms avg`, `(min: ${min.toFixed(1)}ms, max: ${max.toFixed(1)}ms)`);
    perfResults.push({ name: `Embedding: ${labels[i]}`, duration: avg });
  }

  // Batch embedding test
  const batchStart = performance.now();
  await embedFn.generate(testTexts.slice(0, 2));
  const batchDuration = performance.now() - batchStart;

  metric('Batch embeddings (2 texts)', `${batchDuration.toFixed(1)}ms`, 'total');
  perfResults.push({ name: 'Batch embedding (2)', duration: batchDuration });
}

async function testChromaDBPerformance() {
  subheader('ChromaDB Query Performance');

  const queries = [
    'authentication',
    'database optimization performance',
    'real-time websocket notification system implementation',
    'security best practices input validation sanitization xss prevention',
  ];

  for (const query of queries) {
    const times: number[] = [];

    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      await searchSessions(query, 5);
      times.push(performance.now() - start);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    metric(`Query (${query.split(' ').length} words)`, `${avg.toFixed(1)}ms`, 'avg');
    perfResults.push({ name: `ChromaDB query (${query.split(' ').length} words)`, duration: avg });
  }
}

async function testSQLitePerformance() {
  subheader('SQLite Performance');

  // Insert performance
  const insertCount = 100;
  const insertStart = performance.now();

  for (let i = 0; i < insertCount; i++) {
    createLearning({
      category: 'testing',
      title: `Test learning ${i}`,
      description: `Performance test learning number ${i}`,
      confidence: 'low',
    });
  }

  const insertDuration = performance.now() - insertStart;
  metric(`Insert ${insertCount} learnings`, `${insertDuration.toFixed(1)}ms`, `(${(insertDuration / insertCount).toFixed(2)}ms/op)`);
  perfResults.push({ name: `SQLite insert (${insertCount}x)`, duration: insertDuration, ops: insertCount });

  // Query performance
  const queryStart = performance.now();
  for (let i = 0; i < 50; i++) {
    listLearningsFromDb({ limit: 20 });
  }
  const queryDuration = performance.now() - queryStart;
  metric('Query 50x (20 results each)', `${queryDuration.toFixed(1)}ms`, `(${(queryDuration / 50).toFixed(2)}ms/op)`);
  perfResults.push({ name: 'SQLite query (50x)', duration: queryDuration, ops: 50 });

  // Stats query performance
  const statsStart = performance.now();
  for (let i = 0; i < 10; i++) {
    getSessionStats();
    getImprovementReport();
  }
  const statsDuration = performance.now() - statsStart;
  metric('Stats queries 10x', `${statsDuration.toFixed(1)}ms`, `(${(statsDuration / 20).toFixed(2)}ms/op)`);
  perfResults.push({ name: 'SQLite stats (20x)', duration: statsDuration, ops: 20 });
}

async function testAgentIntegration() {
  subheader('Agent Integration Points');

  // Test agent registration with memory
  const testAgentId = 99;

  registerAgent(testAgentId, 'test-pane', process.pid);
  updateAgentStatus(testAgentId, 'working', 'Integration test');

  const agent = getAgent(testAgentId);
  success(`Agent ${testAgentId} registered: ${agent ? 'yes' : 'no'}`);

  // Simulate task embedding (what agent-watcher does)
  const taskId = `integration_test_${Date.now()}`;
  const taskPrompt = 'Analyze the codebase and suggest performance improvements';

  await benchmark('Embed task (agent flow)', async () => {
    await embedTask(taskId, taskPrompt, {
      agent_id: testAgentId,
      priority: 'high',
      created_at: new Date().toISOString(),
    });
  });

  success(`Task ${taskId} embedded to ChromaDB`);

  // Simulate result embedding
  const taskResult = 'Found 3 performance issues: N+1 queries in UserService, missing index on orders.created_at, unoptimized image loading';

  await benchmark('Embed result (agent flow)', async () => {
    await embedResult(taskId, taskResult, {
      agent_id: testAgentId,
      status: 'completed',
      duration_ms: 5000,
      completed_at: new Date().toISOString(),
    });
  });

  success(`Result embedded to ChromaDB`);

  // Test message flow
  sendMessage(String(testAgentId), 'orchestrator', `Test message from agent ${testAgentId}`);
  success('Agent → Orchestrator message sent');

  updateAgentStatus(testAgentId, 'idle', 'Test complete');
}

function analyzeIntegrationGaps() {
  header('Integration Analysis');

  console.log(`${COLORS.bold}Current Integration Points:${COLORS.reset}`);
  console.log(`
  ┌─────────────────────────────────────────────────────────────┐
  │                    ORCHESTRATOR (You)                        │
  │                    Claude Code (Max plan)                    │
  └─────────────────────────┬───────────────────────────────────┘
                            │ MCP Tools
                            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │               MCP Server (src/mcp-server.ts)                 │
  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
  │  │ Agent Tools     │  │ Memory Tools    │  │ Vector Tools │ │
  │  │ assign_task     │  │ save_session    │  │ search_*     │ │
  │  │ get_agents      │  │ add_learning    │  │ embed_*      │ │
  │  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘ │
  └───────────┼────────────────────┼──────────────────┼─────────┘
              │                    │                  │
              ▼                    ▼                  ▼
  ┌───────────────────┐  ┌─────────────────┐  ┌─────────────────┐
  │ agents.db SQLite  │  │ SQLite Memory   │  │    ChromaDB     │
  │ - agents          │  │ - sessions      │  │ - task_prompts  │
  │ - messages        │  │ - learnings     │  │ - task_results  │
  │ - tasks           │  │ - *_links       │  │ - sessions      │
  └───────────────────┘  └─────────────────┘  │ - learnings     │
                                              └─────────────────┘
              │
              ▼
  ┌───────────────┬───────────────┬───────────────┐
  │   Agent 1     │   Agent 2     │   Agent 3     │
  │  (tmux pane)  │  (tmux pane)  │  (tmux pane)  │
  │               │               │               │
  │ ✓ Tasks → DB  │ ✓ Tasks → DB  │ ✓ Tasks → DB  │
  │ ✓ Results →   │ ✓ Results →   │ ✓ Results →   │
  │   ChromaDB    │   ChromaDB    │   ChromaDB    │
  └───────────────┴───────────────┴───────────────┘
`);

  console.log(`${COLORS.bold}${COLORS.yellow}Missing Integration Points:${COLORS.reset}`);
  console.log(`
  1. ${COLORS.red}[GAP]${COLORS.reset} Agents don't have access to learnings
     - Sub-agents could benefit from proven learnings in prompts
     - Inject relevant learnings based on task content

  2. ${COLORS.red}[GAP]${COLORS.reset} No auto-session from agent work
     - When agent completes significant tasks, no session is saved
     - Could auto-capture what_worked/learnings from results

  3. ${COLORS.red}[GAP]${COLORS.reset} Agent tasks not linked to sessions
     - Task history exists but isn't connected to session memory
     - Could link agent tasks to orchestrator sessions

  4. ${COLORS.red}[GAP]${COLORS.reset} No learning extraction from results
     - Successful agent outputs could become learnings
     - Pattern detection from repeated successes

  5. ${COLORS.red}[GAP]${COLORS.reset} Orchestrator context not in agent prompts
     - Agents don't know about ongoing session context
     - Could inject session summary into agent prompts
`);

  console.log(`${COLORS.bold}${COLORS.green}Recommended Integrations:${COLORS.reset}`);
  console.log(`
  1. ${COLORS.green}[HIGH]${COLORS.reset} Add learnings injection to claude-agent.ts
     - Before running task, query relevant learnings
     - Inject high-confidence learnings into prompt

  2. ${COLORS.green}[HIGH]${COLORS.reset} Auto-save agent sessions
     - Track agent task batches as mini-sessions
     - Auto-extract learnings from successful patterns

  3. ${COLORS.green}[MED]${COLORS.reset} Link agent tasks to orchestrator sessions
     - When orchestrator saves session, link related agent tasks
     - Enable "what did agents do this session?" queries

  4. ${COLORS.green}[MED]${COLORS.reset} Context propagation to agents
     - Share session.full_context with agents
     - Agents understand broader project context

  5. ${COLORS.green}[LOW]${COLORS.reset} Learning validation from agent success
     - Track which learnings were injected
     - Auto-validate learnings that led to successful tasks
`);
}

function printPerformanceSummary() {
  header('Performance Summary');

  // Sort by duration
  const sorted = [...perfResults].sort((a, b) => b.duration - a.duration);

  console.log(`${'Operation'.padEnd(40)} ${'Duration'.padStart(12)} ${'Ops/sec'.padStart(12)}`);
  console.log(`${'─'.repeat(40)} ${'─'.repeat(12)} ${'─'.repeat(12)}`);

  for (const r of sorted) {
    const duration = `${r.duration.toFixed(1)}ms`;
    const opsPerSec = r.ops ? `${(1000 / (r.duration / r.ops)).toFixed(0)}` : '-';
    console.log(`${r.name.padEnd(40)} ${duration.padStart(12)} ${opsPerSec.padStart(12)}`);
  }

  // Summary stats
  console.log(`\n${COLORS.bold}Key Metrics:${COLORS.reset}`);

  const embeddingAvg = perfResults
    .filter(r => r.name.includes('Embedding'))
    .reduce((sum, r) => sum + r.duration, 0) / 4;

  const chromaAvg = perfResults
    .filter(r => r.name.includes('ChromaDB'))
    .reduce((sum, r) => sum + r.duration, 0) / 4;

  metric('Avg embedding time', `${embeddingAvg.toFixed(1)}ms`);
  metric('Avg ChromaDB query', `${chromaAvg.toFixed(1)}ms`);
  metric('SQLite insert throughput', `${(1000 / (perfResults.find(r => r.name.includes('insert'))?.duration || 1) * 100).toFixed(0)} ops/sec`);

  // Performance assessment
  console.log(`\n${COLORS.bold}Assessment:${COLORS.reset}`);

  if (embeddingAvg < 10) {
    success('Embedding performance: EXCELLENT (<10ms)');
  } else if (embeddingAvg < 50) {
    success('Embedding performance: GOOD (<50ms)');
  } else {
    fail('Embedding performance: NEEDS IMPROVEMENT (>50ms)');
  }

  if (chromaAvg < 50) {
    success('ChromaDB query performance: EXCELLENT (<50ms)');
  } else if (chromaAvg < 200) {
    success('ChromaDB query performance: GOOD (<200ms)');
  } else {
    fail('ChromaDB query performance: NEEDS IMPROVEMENT (>200ms)');
  }
}

// ============ Main ============

async function main() {
  console.log('\n');
  header('Integration Test & Performance Analysis');

  log('Initializing systems...');
  await initVectorDB();
  success('ChromaDB initialized');
  success('SQLite ready');

  await testMemorySaveRecall();
  await testLearningsSystem();
  await testAutoLinking();
  await testEmbeddingPerformance();
  await testChromaDBPerformance();
  await testSQLitePerformance();
  await testAgentIntegration();

  analyzeIntegrationGaps();
  printPerformanceSummary();

  console.log(`\n${COLORS.green}${COLORS.bold}All tests completed!${COLORS.reset}\n`);
}

main().catch(err => {
  console.error(`${COLORS.red}Fatal error: ${err}${COLORS.reset}`);
  process.exit(1);
});
