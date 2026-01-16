#!/usr/bin/env bun
/**
 * Memory CLI - Slash command style interface
 *
 * Usage:
 *   bun memory save              - Save current session interactively
 *   bun memory recall "query"    - Search past sessions and learnings
 *   bun memory export            - Export learnings to LEARNINGS.md
 *   bun memory stats             - Show statistics
 *   bun memory list [sessions|learnings]  - List recent items
 *   bun memory context ["query"] - Get context bundle for new session
 */

const command = process.argv[2];
const arg = process.argv[3];

async function main() {
  switch (command) {
    case 'save':
      await import('./save-session');
      break;

    case 'recall':
    case 'search':
      // No arg = resume last session, with arg = search/lookup
      process.argv = [process.argv[0], process.argv[1], arg || ''];
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
      process.argv = [process.argv[0], process.argv[1], arg || ''];
      await import('./context');
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

Usage: bun memory <command> [args]

Commands:
  save              Save current session with full context
  recall            Resume last session (show context to continue)
  recall "query"    Semantic search for sessions and learnings
  recall "session_123"  Recall specific session by ID
  recall "#5"       Recall specific learning by ID
  export [path]     Export learnings to LEARNINGS.md
  stats             Show session and learning statistics
  list [type]       List recent sessions or learnings
  context [query]   Get context bundle for new session

Examples:
  bun memory save
  bun memory recall                        # Resume last session
  bun memory recall "session_1768563283471"  # Specific session
  bun memory recall "embedding performance"  # Semantic search
  bun memory export ./docs/LEARNINGS.md
  bun memory stats
  bun memory list sessions
  bun memory context "working on embeddings"

Aliases:
  search = recall
`);
}

main().catch(console.error);
