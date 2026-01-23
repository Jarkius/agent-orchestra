#!/usr/bin/env bun
/**
 * Memory CLI - Slash command style interface
 *
 * Usage:
 *   bun memory save              - Save current session interactively
 *   bun memory learn <cat> "title" - Capture a learning or insight
 *   bun memory recall "query"    - Search past sessions and learnings
 *   bun memory export            - Export learnings to LEARNINGS.md
 *   bun memory stats             - Show statistics
 *   bun memory list [sessions|learnings]  - List recent items
 *   bun memory context ["query"] - Get context bundle for new session
 *
 * Flags:
 *   --agent <id>                 - Filter by agent ID (use with any command)
 */

// Parse global flags
function parseGlobalFlags(): { agentId?: number; args: string[] } {
  const args = process.argv.slice(2);
  let agentId: number | undefined;
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && i + 1 < args.length) {
      agentId = parseInt(args[i + 1]!);
      i++; // Skip the value
    } else {
      remaining.push(args[i]!);
    }
  }

  return { agentId, args: remaining };
}

const { agentId, args } = parseGlobalFlags();

// Parse colon-separated commands (e.g., task:list -> baseCommand=task, action=list)
function parseCommand(cmd: string | undefined): { baseCommand: string | undefined; action: string | undefined } {
  if (!cmd) return { baseCommand: undefined, action: undefined };
  if (cmd.includes(':')) {
    const [base, ...rest] = cmd.split(':');
    return { baseCommand: base, action: rest.join(':') };
  }
  return { baseCommand: cmd, action: undefined };
}

const { baseCommand, action } = parseCommand(args[0]);
const command = baseCommand;
const arg = args[1];

// Store agent ID globally for subcommands
if (agentId !== undefined) {
  process.env.MEMORY_AGENT_ID = String(agentId);
}

async function main() {
  switch (command) {
    case 'save':
      await import('./save-session');
      break;

    case 'learn':
      // Pass remaining args to learn script
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./learn');
      break;

    case 'distill':
      // Pass remaining args to distill script
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./distill');
      break;

    case 'recall':
    case 'search':
      // No arg = resume last session, with arg = search/lookup
      // Pass through all args including flags (--index, --summary)
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./recall');
      break;

    case 'export':
      await import('./export');
      break;

    case 'stats':
      await import('./stats');
      break;

    case 'list':
      await import('./list');
      break;

    case 'context':
      process.argv = [process.argv[0]!, process.argv[1]!, arg || ''];
      await import('./context');
      break;

    case 'purge':
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./purge');
      break;

    case 'reset':
      await import('./reset');
      break;

    case 'reindex':
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./reindex');
      break;

    case 'graph':
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./graph');
      break;

    case 'absorb':
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./absorb');
      break;

    case 'task':
    case 'utask': {
      // Unified task management with colon sub-actions
      // task:list, task:create, task:update, task:sync, task:stats, task:promote
      // utask is aliased to task for backwards compatibility
      const { runTask } = await import('./task');
      await runTask(action, args.slice(1));
      break;
    }

    case 'issue':
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./issue');
      break;

    case 'message':
    case 'msg':
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./message');
      break;

    case 'watch':
      await import('../../src/matrix-watch');
      break;

    case 'validate':
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./validate-search');
      break;

    case 'evaluate':
      await import('./evaluate-search');
      break;

    case 'consolidate':
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./consolidate');
      break;

    case 'daemon':
      // Daemon commands: start, stop, status
      const daemonCmd = args[1] || 'status';
      process.argv = [process.argv[0]!, process.argv[1]!, daemonCmd];
      await import('../../src/matrix-daemon');
      break;

    case 'status':
      await import('./status');
      break;

    case 'init':
      await import('./init');
      break;

    case 'index':
    case 'code': {
      // Code indexing commands: once, start, status, search
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./code-index');
      break;
    }

    case 'indexer': {
      // Indexer daemon commands: start, stop, status
      const daemonCmd = args[1] || 'status';
      const daemonArgs = args.slice(2);
      process.argv = [process.argv[0]!, process.argv[1]!, daemonCmd, ...daemonArgs];
      await import('../../src/indexer/indexer-daemon');
      break;
    }

    case 'map': {
      // Generate codebase map from indexed data
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./map');
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp();
      break;
  }
}

function printHelp() {
  console.log(`
📚 Memory CLI - Session & Learning Management

Usage: bun memory [--agent <id>] <command> [args]

Commands:
  save              Save current session with full context
  learn <cat> "t"   Capture a learning (12 categories: technical + wisdom)
  distill           Extract learnings from recent sessions
  recall            Resume last session (show context to continue)
  recall "query"    Semantic search for sessions and learnings
  recall "#5"       Recall specific learning by ID
  export [path]     Export learnings to LEARNINGS.md
  stats             Show session and learning statistics
  list [type]       List recent sessions or learnings
  context [query]   Get context bundle for new session
  task              List all pending tasks (system, project, session)
  task:list         List tasks (--system, --project, --session, --all)
  task:create       Create task (--system, --project, --session)
  task:update <id>  Update task status/priority/notes
  task:sync         Sync with GitHub + analyze commits for completions
  task:sync --auto  Sync + auto-close high-confidence matches
  task:analyze      Analyze commits without syncing (gap analysis)
  task:stats        Show task statistics
  task:promote <id> Promote project task to system
  graph             List top entities in knowledge graph
  graph "entity"    Show related entities and learnings
  graph "A" "B"     Find path between two entities
  absorb <path>     Auto-capture knowledge from codebase exploration
  issue "title"     Report an issue for awareness and tracking
  message "text"    Broadcast to all matrices
  message --to path Direct message to specific matrix
  message --inbox   Check incoming messages
  watch             Live message feed (SSE stream) - run in separate pane
  status            Show matrix communication status
  init              Initialize hub and daemon (single setup command)
  purge <target>    Purge sessions or learnings (with filters)
  reset             Nuclear option - wipe ALL memory data
  reindex [type]    Re-index SQLite data into ChromaDB vectors
  validate          Run search validation tests (feedback loop)
  evaluate          Full search evaluation (vector vs FTS vs hybrid)
  consolidate       Find and merge duplicate learnings (--apply to execute)
  index once        Full semantic index of codebase
  index start       Start file watcher for auto-indexing
  index status      Show code index statistics
  index search "q"  Search indexed code semantically
  indexer start     Start indexer daemon (background file watcher)
  indexer stop      Stop indexer daemon
  indexer status    Check indexer daemon status
  map               Generate codebase map from indexed data
  map --update      Update CLAUDE.md with codebase map

Categories:
  Technical: performance, architecture, tooling, process, debugging, security, testing
  Wisdom:    philosophy, principle, insight, pattern, retrospective

Flags:
  --agent <id>      Filter by agent ID (null = orchestrator only)

Examples:
  bun memory save
  bun memory learn philosophy "Simplicity over cleverness"
  bun memory learn insight "Tests document behavior" "Not just for catching bugs"
  bun memory distill                          # Extract from last session
  bun memory recall                           # Resume last session
  bun memory recall "embedding performance"   # Semantic search
  bun memory export ./docs/LEARNINGS.md
  bun memory stats
  bun memory reindex                        # Re-index all vectors
  bun memory reindex sessions               # Re-index only sessions

Aliases:
  search = recall
`);
}

main().catch(console.error);
