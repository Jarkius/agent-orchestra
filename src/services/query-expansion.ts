/**
 * Query Expansion Service
 *
 * Improves recall by expanding user queries into multiple search variants:
 * - Synonym expansion (e.g., "auth" → ["authentication", "login", "session"])
 * - Acronym expansion (e.g., "API" → "Application Programming Interface")
 * - Alternative phrasings (e.g., "how to X" → "implement X", "create X")
 *
 * Combined with task-type detection for smarter category boosting.
 */

import {
  detectTaskType,
  getRetrievalStrategy,
  type TaskType,
  type TaskContext,
  type RetrievalStrategy,
} from '../learning/context-router';
import type { LearningCategory } from '../interfaces/learning';

// ============ Types ============

export interface ExpandedQuery {
  original: string;
  variants: string[];
  taskContext: TaskContext;
  strategy: RetrievalStrategy;
}

export interface ExpansionOptions {
  maxVariants?: number;       // Max number of variants to generate (default: 5)
  includeOriginal?: boolean;  // Include original in variants (default: true)
  expandSynonyms?: boolean;   // Enable synonym expansion (default: true)
  expandAcronyms?: boolean;   // Enable acronym expansion (default: true)
  expandPhrasings?: boolean;  // Enable alternative phrasings (default: true)
}

// ============ Expansion Dictionaries ============

// Technical synonyms for common programming concepts
const SYNONYM_MAP: Record<string, string[]> = {
  // Authentication & Security
  'auth': ['authentication', 'login', 'session', 'authorization'],
  'authentication': ['auth', 'login', 'session', 'credential'],
  'login': ['authentication', 'sign in', 'signin', 'auth'],
  'logout': ['sign out', 'signout', 'end session'],
  'password': ['credential', 'secret', 'passphrase'],
  'token': ['JWT', 'bearer token', 'session token', 'access token'],
  'permission': ['authorization', 'access control', 'privilege'],

  // Errors & Debugging
  'error': ['exception', 'failure', 'bug', 'issue', 'problem'],
  'bug': ['error', 'defect', 'issue', 'problem'],
  'fix': ['repair', 'resolve', 'patch', 'debug'],
  'debug': ['troubleshoot', 'diagnose', 'fix'],
  'crash': ['failure', 'error', 'exception', 'hang'],
  'timeout': ['hang', 'delay', 'slow', 'blocked'],

  // Database
  'database': ['db', 'datastore', 'storage', 'persistence'],
  'db': ['database', 'datastore'],
  'query': ['sql', 'select', 'fetch', 'retrieve'],
  'table': ['schema', 'relation', 'entity'],
  'migration': ['schema change', 'alter table', 'upgrade'],

  // API & Networking
  'api': ['endpoint', 'interface', 'service', 'route'],
  'endpoint': ['api', 'route', 'url', 'path'],
  'request': ['call', 'fetch', 'invoke', 'http'],
  'response': ['result', 'reply', 'output'],
  'websocket': ['ws', 'socket', 'real-time', 'bidirectional'],
  'http': ['rest', 'request', 'fetch'],

  // Architecture
  'component': ['module', 'unit', 'part', 'element'],
  'module': ['component', 'package', 'library'],
  'service': ['handler', 'controller', 'manager'],
  'pattern': ['design pattern', 'approach', 'technique'],
  'architecture': ['design', 'structure', 'system'],
  'refactor': ['restructure', 'rewrite', 'reorganize', 'clean up'],

  // Testing
  'test': ['spec', 'assertion', 'verification', 'check'],
  'unit test': ['spec', 'test case', 'assertion'],
  'mock': ['stub', 'fake', 'spy', 'double'],
  'coverage': ['test coverage', 'code coverage'],

  // Common Actions
  'create': ['add', 'generate', 'make', 'build'],
  'update': ['modify', 'change', 'edit', 'patch'],
  'delete': ['remove', 'destroy', 'drop'],
  'get': ['fetch', 'retrieve', 'read', 'query'],
  'list': ['enumerate', 'show', 'display', 'get all'],
  'find': ['search', 'locate', 'lookup', 'query'],
  'send': ['emit', 'dispatch', 'publish', 'transmit'],
  'receive': ['handle', 'consume', 'listen', 'subscribe'],

  // Configuration
  'config': ['configuration', 'settings', 'options'],
  'configuration': ['config', 'setup', 'settings'],
  'env': ['environment', 'environment variable'],
  'environment': ['env', 'context', 'runtime'],
};

// Acronym expansions
const ACRONYM_MAP: Record<string, string> = {
  'api': 'Application Programming Interface',
  'jwt': 'JSON Web Token',
  'http': 'HyperText Transfer Protocol',
  'https': 'HTTP Secure',
  'sql': 'Structured Query Language',
  'db': 'database',
  'ui': 'user interface',
  'ux': 'user experience',
  'cli': 'command line interface',
  'mcp': 'Model Context Protocol',
  'pty': 'pseudo terminal',
  'ws': 'WebSocket',
  'rest': 'Representational State Transfer',
  'crud': 'Create Read Update Delete',
  'orm': 'Object Relational Mapping',
  'fts': 'full text search',
  'mmr': 'Maximal Marginal Relevance',
  'sse': 'Server-Sent Events',
};

// Phrase patterns for alternative phrasings
const PHRASE_PATTERNS: Array<{ pattern: RegExp; alternatives: (match: RegExpMatchArray) => string[] }> = [
  // "how to X" → "implement X", "create X", "X tutorial"
  {
    pattern: /^how\s+(?:do\s+(?:i|you|we)\s+)?(?:to\s+)?(.+)$/i,
    alternatives: (match) => {
      const topic = match[1]!.trim();
      return [
        `implement ${topic}`,
        `create ${topic}`,
        `${topic} tutorial`,
        `${topic} example`,
      ];
    },
  },
  // "what is X" → "X definition", "X explanation", "understanding X"
  {
    pattern: /^what\s+(?:is|are)\s+(.+)$/i,
    alternatives: (match) => {
      const topic = match[1]!.trim();
      return [
        `${topic} definition`,
        `${topic} explanation`,
        `understanding ${topic}`,
      ];
    },
  },
  // "why does X" → "X reason", "X cause", "understand X"
  {
    pattern: /^why\s+(?:does|do|is|are)\s+(.+)$/i,
    alternatives: (match) => {
      const topic = match[1]!.trim();
      return [
        `${topic} reason`,
        `${topic} cause`,
        `understanding ${topic}`,
      ];
    },
  },
  // "fix X" → "solve X", "debug X", "X solution"
  {
    pattern: /^(?:fix|solve|debug)\s+(.+)$/i,
    alternatives: (match) => {
      const topic = match[1]!.trim();
      return [
        `fix ${topic}`,
        `solve ${topic}`,
        `${topic} solution`,
        `${topic} workaround`,
      ];
    },
  },
  // "X not working" → "X error", "X issue", "X broken"
  {
    pattern: /^(.+?)\s+(?:not\s+working|broken|failing|crashing)$/i,
    alternatives: (match) => {
      const topic = match[1]!.trim();
      return [
        `${topic} error`,
        `${topic} issue`,
        `${topic} bug`,
        `debug ${topic}`,
      ];
    },
  },
];

// ============ Core Functions ============

/**
 * Expand a query into multiple search variants
 */
export function expandQuery(query: string, options: ExpansionOptions = {}): ExpandedQuery {
  const {
    maxVariants = 5,
    includeOriginal = true,
    expandSynonyms = true,
    expandAcronyms = true,
    expandPhrasings = true,
  } = options;

  const variants = new Set<string>();
  if (includeOriginal) {
    variants.add(query.toLowerCase().trim());
  }

  const queryLower = query.toLowerCase().trim();
  const words = queryLower.split(/\s+/);

  // 1. Synonym expansion - replace key words with synonyms
  if (expandSynonyms) {
    for (const word of words) {
      const synonyms = SYNONYM_MAP[word];
      if (synonyms) {
        for (const synonym of synonyms.slice(0, 2)) { // Limit synonyms per word
          const variant = queryLower.replace(new RegExp(`\\b${word}\\b`, 'g'), synonym);
          if (variant !== queryLower) {
            variants.add(variant);
          }
        }
      }
    }
  }

  // 2. Acronym expansion - expand acronyms to full form
  if (expandAcronyms) {
    for (const word of words) {
      const expansion = ACRONYM_MAP[word];
      if (expansion) {
        const variant = queryLower.replace(new RegExp(`\\b${word}\\b`, 'g'), expansion);
        if (variant !== queryLower) {
          variants.add(variant);
        }
      }
    }
  }

  // 3. Phrase pattern alternatives
  if (expandPhrasings) {
    for (const { pattern, alternatives } of PHRASE_PATTERNS) {
      const match = query.match(pattern);
      if (match) {
        for (const alt of alternatives(match)) {
          variants.add(alt.toLowerCase());
        }
        break; // Only apply first matching pattern
      }
    }
  }

  // Detect task type and get retrieval strategy
  const taskContext = detectTaskType(query);
  const strategy = getRetrievalStrategy(taskContext.type);

  // Sort variants by estimated usefulness (original first, then shorter variants)
  const sortedVariants = Array.from(variants)
    .sort((a, b) => {
      if (a === queryLower) return -1;
      if (b === queryLower) return 1;
      return a.length - b.length;
    })
    .slice(0, maxVariants);

  return {
    original: query,
    variants: sortedVariants,
    taskContext,
    strategy,
  };
}

/**
 * Get synonyms for a term
 */
export function getSynonyms(term: string): string[] {
  return SYNONYM_MAP[term.toLowerCase()] || [];
}

/**
 * Get acronym expansion
 */
export function expandAcronym(acronym: string): string | null {
  return ACRONYM_MAP[acronym.toLowerCase()] || null;
}

/**
 * Check if a query would benefit from expansion
 */
export function shouldExpand(query: string): boolean {
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);

  // Check for expandable words
  const hasExpandableWord = words.some(w => SYNONYM_MAP[w] || ACRONYM_MAP[w]);

  // Check for expandable phrase patterns
  const hasExpandablePhrase = PHRASE_PATTERNS.some(({ pattern }) => pattern.test(query));

  return hasExpandableWord || hasExpandablePhrase;
}

/**
 * Get a brief summary of what expansion would do
 */
export function getExpansionPreview(query: string): {
  wouldExpand: boolean;
  synonymMatches: string[];
  acronymMatches: string[];
  phraseMatch: string | null;
} {
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);

  const synonymMatches: string[] = [];
  const acronymMatches: string[] = [];
  let phraseMatch: string | null = null;

  for (const word of words) {
    if (SYNONYM_MAP[word]) synonymMatches.push(word);
    if (ACRONYM_MAP[word]) acronymMatches.push(word);
  }

  for (const { pattern } of PHRASE_PATTERNS) {
    if (pattern.test(query)) {
      phraseMatch = pattern.toString();
      break;
    }
  }

  return {
    wouldExpand: synonymMatches.length > 0 || acronymMatches.length > 0 || phraseMatch !== null,
    synonymMatches,
    acronymMatches,
    phraseMatch,
  };
}

export default {
  expandQuery,
  getSynonyms,
  expandAcronym,
  shouldExpand,
  getExpansionPreview,
};
