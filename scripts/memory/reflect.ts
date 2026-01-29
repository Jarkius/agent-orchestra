#!/usr/bin/env bun
/**
 * Memory Reflect - Serendipitous wisdom retrieval
 *
 * Implements the Oracle Reflect pattern for breaking transactional coding loops.
 * Returns random high-confidence learnings to provide unexpected perspective.
 *
 * Usage:
 *   bun memory reflect                      # Get random wisdom
 *   bun memory reflect --category philosophy # Filter by category
 *   bun memory reflect --confidence proven  # Only proven learnings
 *   bun memory reflect --count 3            # Get multiple wisdoms
 */

import { parseArgs } from 'util';
import {
  getRandomWisdom,
  getRandomWisdomBatch,
  MATURITY_ICONS,
  type LearningRecord,
  type MaturityStage,
} from '../../src/db/learnings';
import { logAccess } from '../../src/db/behavioral-logs';

// Parse command line arguments
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    category: { type: 'string', short: 'c' },
    confidence: { type: 'string', short: 'C' },
    maturity: { type: 'string', short: 'm' },
    count: { type: 'string', short: 'n' },
    help: { type: 'boolean', short: 'h' },
    json: { type: 'boolean', short: 'j' },
  },
  allowPositionals: true,
});

function printHelp() {
  console.log(`
🔮 Memory Reflect - Serendipitous Wisdom Retrieval

Usage:
  bun memory reflect [options]

Options:
  -c, --category <cat>    Filter by category (e.g., philosophy, architecture)
  -C, --confidence <lvl>  Minimum confidence: low, medium, high, proven
  -m, --maturity <stage>  Minimum maturity: observation, learning, pattern, principle, wisdom
  -n, --count <num>       Number of wisdom items (1-5, default: 1)
  -j, --json              Output as JSON
  -h, --help              Show this help

Examples:
  bun memory reflect                          # Random wisdom
  bun memory reflect -c philosophy            # Philosophy only
  bun memory reflect -C proven -n 3           # 3 proven learnings
  bun memory reflect --maturity principle     # Principle or wisdom only

The Oracle Keeps the Human Human 🧘
`);
}

function formatWisdomTerminal(learning: LearningRecord): string {
  const lines: string[] = [];

  // Header with maturity icon
  const maturityIcon = learning.maturity_stage ? MATURITY_ICONS[learning.maturity_stage] : '💡';
  lines.push(`${maturityIcon}  \x1b[1m${learning.title}\x1b[0m`);
  lines.push('');

  // Category and confidence badges
  const categoryColor = '\x1b[36m'; // Cyan
  const confidenceColor = learning.confidence === 'proven' ? '\x1b[32m' : '\x1b[33m'; // Green or yellow
  const reset = '\x1b[0m';

  lines.push(`   ${categoryColor}[${learning.category}]${reset} ${confidenceColor}(${learning.confidence || 'medium'})${reset}`);

  if (learning.maturity_stage) {
    lines.push(`   Maturity: ${learning.maturity_stage}`);
  }
  lines.push('');

  // Description
  if (learning.description) {
    // Word wrap description at ~70 chars
    const wrapped = learning.description
      .split('\n')
      .map(line => {
        if (line.length <= 70) return `   ${line}`;
        const words = line.split(' ');
        const wrapped: string[] = [];
        let current = '   ';
        for (const word of words) {
          if (current.length + word.length > 73) {
            wrapped.push(current);
            current = '   ' + word;
          } else {
            current += (current === '   ' ? '' : ' ') + word;
          }
        }
        if (current !== '   ') wrapped.push(current);
        return wrapped.join('\n');
      })
      .join('\n');
    lines.push(wrapped);
    lines.push('');
  }

  // Context if available
  if (learning.context) {
    lines.push(`   \x1b[2m${learning.context}\x1b[0m`);
    lines.push('');
  }

  // Validation count
  if (learning.times_validated && learning.times_validated > 0) {
    lines.push(`   \x1b[2m✓ Validated ${learning.times_validated} time(s)\x1b[0m`);
  }

  return lines.join('\n');
}

async function main() {
  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const category = values.category;
  const minConfidence = values.confidence as 'low' | 'medium' | 'high' | 'proven' | undefined;
  const minMaturity = values.maturity as MaturityStage | undefined;
  const count = values.count ? parseInt(values.count, 10) : 1;
  const asJson = values.json;

  // Validate inputs
  if (minConfidence && !['low', 'medium', 'high', 'proven'].includes(minConfidence)) {
    console.error('Invalid confidence level. Use: low, medium, high, proven');
    process.exit(1);
  }

  if (minMaturity && !['observation', 'learning', 'pattern', 'principle', 'wisdom'].includes(minMaturity)) {
    console.error('Invalid maturity stage. Use: observation, learning, pattern, principle, wisdom');
    process.exit(1);
  }

  if (count < 1 || count > 5) {
    console.error('Count must be between 1 and 5');
    process.exit(1);
  }

  // Get wisdom
  const wisdomItems = count > 1
    ? getRandomWisdomBatch(count, { category, minConfidence, minMaturity })
    : (() => {
        const single = getRandomWisdom({ category, minConfidence, minMaturity });
        return single ? [single] : [];
      })();

  if (wisdomItems.length === 0) {
    if (asJson) {
      console.log(JSON.stringify({ wisdom: [], message: 'No wisdom found matching criteria' }));
    } else {
      console.log('\n  No wisdom found matching your criteria.\n');
      console.log('  Try:');
      console.log('    • Lowering --confidence to "low"');
      console.log('    • Removing --category filter');
      console.log('    • Building knowledge with `bun memory learn`\n');
    }
    process.exit(0);
  }

  // Log access for each wisdom item
  for (const wisdom of wisdomItems) {
    if (wisdom.id) {
      logAccess({
        resource_type: 'learning',
        resource_id: String(wisdom.id),
        action: 'cited',
        context: 'cli_reflect',
      });
    }
  }

  // Output
  if (asJson) {
    console.log(JSON.stringify({ wisdom: wisdomItems }, null, 2));
  } else {
    console.log('\n┌─────────────────────────────────────────┐');
    console.log('│           🔮 Oracle Reflection          │');
    console.log('└─────────────────────────────────────────┘\n');

    for (let i = 0; i < wisdomItems.length; i++) {
      if (wisdomItems.length > 1) {
        console.log(`\x1b[2m── ${i + 1} of ${wisdomItems.length} ──\x1b[0m\n`);
      }
      console.log(formatWisdomTerminal(wisdomItems[i]));
      console.log('');
    }

    console.log('\x1b[2m───────────────────────────────────────────\x1b[0m');
    console.log('\x1b[2m   "The Oracle Keeps the Human Human"\x1b[0m\n');
  }
}

main().catch(console.error);
