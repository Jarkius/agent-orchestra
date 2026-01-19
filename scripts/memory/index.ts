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
const command = args[0];
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
      process.argv = [process.argv[0]!, process.argv[1]!, arg || ''];
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
      process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
      await import('./task-update');
      break;

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
  task list         List pending tasks across sessions
  task <id> <status> Update task status (done/pending/blocked/in_progress)
  graph             List top entities in knowledge graph
  graph "entity"    Show related entities and learnings
  graph "A" "B"     Find path between two entities
  absorb <path>     Auto-capture knowledge from codebase exploration
  purge <target>    Purge sessions or learnings (with filters)
  reset             Nuclear option - wipe ALL memory data
  reindex [type]    Re-index SQLite data into ChromaDB vectors

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
