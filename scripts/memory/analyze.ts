#!/usr/bin/env bun
/**
 * Memory Analyze - Cross-session patterns and codebase analysis
 *
 * Usage:
 *   bun memory analyze --sessions      - Analyze session patterns
 *   bun memory analyze --codebase      - Analyze codebase structure
 *   bun memory analyze --all           - Run both analyses
 *   bun memory analyze --smart         - Use LLM for deeper analysis
 */

import {
  CrossSessionAnalyzer,
  analyzeRecentSessions,
  type CrossSessionPattern,
} from '../../src/learning/cross-session';
import {
  analyzeCodebaseWithGemini,
  analyzeRepository,
  type CodebaseInsight,
} from '../../src/learning/code-analyzer';

const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const analyzeSessions = args.includes('--sessions') || args.includes('--all');
const analyzeCodebase = args.includes('--codebase') || args.includes('--all');
const useSmartMode = args.includes('--smart');

// Parse --days value
const daysIndex = args.findIndex(a => a === '--days');
const sinceDays = daysIndex >= 0 ? parseInt(args[daysIndex + 1] || '30', 10) : 30;

// Parse --path value for codebase analysis
const pathIndex = args.findIndex(a => a === '--path');
const repoPath = pathIndex >= 0 ? args[pathIndex + 1] || '.' : '.';

if (showHelp || (!analyzeSessions && !analyzeCodebase)) {
  console.log(`
  Memory Analyze - Cross-session and codebase analysis

  USAGE
    bun memory analyze <mode> [options]

  MODES
    --sessions      Analyze patterns across sessions
    --codebase      Analyze codebase structure and patterns
    --all           Run both analyses

  OPTIONS
    --smart         Use LLM for deeper analysis (costs API)
    --days <n>      Sessions from last N days (default: 30)
    --path <dir>    Codebase path (default: current directory)
    -h, --help      Show this help

  SESSION PATTERNS DETECTED
    Workflow:       Common approaches and tools
    Challenge:      Recurring difficulties
    Success:        Strategies that work well
    Anti-pattern:   Bad habits to avoid
    Insight:        Cross-cutting observations

  CODEBASE INSIGHTS
    Patterns:       Design patterns in use
    Anti-patterns:  Problematic patterns
    Architecture:   Key structural observations
    Suggestions:    Actionable improvements

  EXAMPLES
    bun memory analyze --sessions               # Session patterns
    bun memory analyze --codebase --smart       # Deep codebase analysis
    bun memory analyze --all --days 7           # Both, last week
`);
  process.exit(0);
}

function printPattern(pattern: CrossSessionPattern) {
  const bar = '█'.repeat(Math.min(pattern.frequency, 10));
  const trendArrow = pattern.trend === 'increasing' ? '↑' : pattern.trend === 'decreasing' ? '↓' : '→';

  console.log(`  ${pattern.pattern}`);
  console.log(`     [${bar}] ${pattern.frequency} sessions ${trendArrow}`);
  console.log(`     Category: ${pattern.category} | Confidence: ${(pattern.confidence * 100).toFixed(0)}%`);
  console.log(`     ${pattern.description.slice(0, 60)}`);
  if (pattern.recommendation) {
    console.log(`     → ${pattern.recommendation.slice(0, 55)}`);
  }
  console.log();
}

async function analyzeSessionPatterns() {
  console.log('─'.repeat(60));
  console.log('  CROSS-SESSION PATTERN ANALYSIS');
  console.log('─'.repeat(60));
  console.log();

  const mode = useSmartMode ? 'Smart (LLM-assisted)' : 'Heuristic';
  console.log(`  Mode: ${mode}`);
  console.log(`  Timeframe: Last ${sinceDays} days`);
  console.log();

  const analyzer = new CrossSessionAnalyzer({ enableLLM: useSmartMode });
  const result = await analyzer.analyzePatterns({ sinceDays });

  console.log(`  Sessions analyzed: ${result.stats.sessionsAnalyzed}`);
  console.log(`  Patterns detected: ${result.stats.patternsDetected}`);
  console.log();

  if (result.patterns.length === 0) {
    console.log('  No patterns detected.');
    console.log('  Add more sessions to build pattern history.');
    return;
  }

  // Group by category
  const byCategory = new Map<string, CrossSessionPattern[]>();
  for (const pattern of result.patterns) {
    const list = byCategory.get(pattern.category) || [];
    list.push(pattern);
    byCategory.set(pattern.category, list);
  }

  for (const [category, patterns] of byCategory) {
    console.log(`  ${category.toUpperCase()}`);
    console.log('  ' + '─'.repeat(56));
    for (const pattern of patterns.slice(0, 5)) {
      printPattern(pattern);
    }
  }

  console.log();
  console.log(`  Summary: ${result.summary}`);
}

async function analyzeCodebaseStructure() {
  console.log('─'.repeat(60));
  console.log('  CODEBASE ANALYSIS');
  console.log('─'.repeat(60));
  console.log();

  const mode = useSmartMode ? 'Smart (Gemini-assisted)' : 'Heuristic';
  console.log(`  Mode: ${mode}`);
  console.log(`  Path: ${repoPath}`);
  console.log();

  const insight = await analyzeCodebaseWithGemini(repoPath, {
    enableLLM: useSmartMode,
    maxFiles: 30,
  });

  // Architecture notes
  if (insight.architectureNotes.length > 0) {
    console.log('  ARCHITECTURE');
    console.log('  ' + '─'.repeat(56));
    for (const note of insight.architectureNotes.slice(0, 5)) {
      console.log(`    • ${note}`);
    }
    console.log();
  }

  // Patterns
  if (insight.patterns.length > 0) {
    console.log('  PATTERNS DETECTED');
    console.log('  ' + '─'.repeat(56));
    for (const pattern of insight.patterns.slice(0, 5)) {
      const bar = '█'.repeat(Math.min(pattern.frequency, 10));
      console.log(`    ${pattern.name}`);
      console.log(`       [${bar}] ${pattern.frequency}x`);
      console.log(`       ${pattern.description.slice(0, 50)}`);
      if (pattern.recommendation) {
        console.log(`       → ${pattern.recommendation.slice(0, 45)}`);
      }
      console.log();
    }
  }

  // Anti-patterns
  if (insight.antiPatterns.length > 0) {
    console.log('  ⚠️  ANTI-PATTERNS');
    console.log('  ' + '─'.repeat(56));
    for (const ap of insight.antiPatterns.slice(0, 3)) {
      const severityIcon = ap.severity === 'high' ? '🔴' : ap.severity === 'medium' ? '🟡' : '🟢';
      console.log(`    ${severityIcon} ${ap.name}`);
      console.log(`       ${ap.description.slice(0, 50)}`);
      if (ap.fix) {
        console.log(`       Fix: ${ap.fix.slice(0, 45)}`);
      }
      console.log();
    }
  }

  // Suggestions
  if (insight.suggestions.length > 0) {
    console.log('  💡 SUGGESTIONS');
    console.log('  ' + '─'.repeat(56));
    for (const suggestion of insight.suggestions.slice(0, 3)) {
      const priorityIcon = suggestion.priority === 'high' ? '❗' : suggestion.priority === 'medium' ? '•' : '○';
      console.log(`    ${priorityIcon} ${suggestion.title}`);
      console.log(`       ${suggestion.description.slice(0, 50)}`);
      console.log(`       Priority: ${suggestion.priority} | Effort: ${suggestion.effort}`);
      console.log();
    }
  }

  console.log();
  console.log(`  Summary: ${insight.summary}`);
}

async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  MEMORY ANALYSIS');
  console.log('════════════════════════════════════════════════════════════');
  console.log();

  if (analyzeSessions) {
    await analyzeSessionPatterns();
    console.log();
  }

  if (analyzeCodebase) {
    await analyzeCodebaseStructure();
    console.log();
  }
}

main().catch(console.error);
