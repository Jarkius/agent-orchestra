/**
 * Analytics Tool Handlers
 * MCP tools for stats, reports, context bundles, and exports
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { jsonResponse, errorResponse } from '../../utils/response';
import {
  getSessionStats,
  getImprovementReport,
  listSessionsFromDb,
  listLearningsFromDb,
  getSessionById,
  getLinkedSessions,
  getLearningsBySession,
} from '../../../db';
import {
  searchSessions,
  searchLearnings,
  isInitialized,
  initVectorDB,
} from '../../../vector-db';
import type { ToolDefinition, ToolHandler } from '../../types';
import { z } from 'zod';

// ============ Schemas ============

const GetContextBundleSchema = z.object({
  query: z.string().optional(),
  include_learnings: z.boolean().default(true),
  include_recent_sessions: z.boolean().default(true),
  sessions_limit: z.number().min(1).max(10).default(3),
  learnings_limit: z.number().min(1).max(20).default(10),
});

const ExportLearningsSchema = z.object({
  output_path: z.string().optional(),
  format: z.enum(['markdown', 'json']).default('markdown'),
  include_sessions: z.boolean().default(false),
});

const RebuildIndexSchema = z.object({
  collection: z.enum(['sessions', 'learnings', 'all']).default('all'),
});

// ============ Ensure DBs ready ============

async function ensureVectorDB() {
  if (!isInitialized()) {
    await initVectorDB();
  }
}

// ============ Tool Definitions ============

export const analyticsTools: ToolDefinition[] = [
  {
    name: "get_session_stats",
    description: "Session stats",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_improvement_report",
    description: "Improvement report",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_context_bundle",
    description: "Context bundle",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        include_learnings: { type: "boolean" },
        include_recent_sessions: { type: "boolean" },
        sessions_limit: { type: "number" },
        learnings_limit: { type: "number" },
      },
    },
  },
  {
    name: "export_learnings",
    description: "Export learnings",
    inputSchema: {
      type: "object",
      properties: {
        output_path: { type: "string" },
        format: { type: "string", enum: ["markdown", "json"] },
        include_sessions: { type: "boolean" },
      },
    },
  },
  {
    name: "rebuild_search_index",
    description: "Rebuild index",
    inputSchema: {
      type: "object",
      properties: { collection: { type: "string", enum: ["sessions", "learnings", "all"] } },
    },
  },
];

// ============ Tool Handlers ============

async function handleGetSessionStats(_args: unknown) {
  try {
    const stats = getSessionStats();

    return jsonResponse({
      total_sessions: stats.total_sessions,
      avg_duration_mins: stats.avg_duration_mins ? Number(stats.avg_duration_mins.toFixed(1)) : null,
      total_commits: stats.total_commits,
      sessions_this_week: stats.sessions_this_week,
      sessions_this_month: stats.sessions_this_month,
      top_tags: stats.top_tags.slice(0, 10),
      sessions_by_month: stats.sessions_by_month,
    });
  } catch (error) {
    return errorResponse(`Failed to get session stats: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleGetImprovementReport(_args: unknown) {
  try {
    const report = getImprovementReport();

    return jsonResponse({
      total_learnings: report.total_learnings,
      by_category: report.by_category,
      by_confidence: report.by_confidence,
      recently_validated: report.recently_validated.map(l => ({
        id: l.id,
        title: l.title,
        category: l.category,
        confidence: l.confidence,
        times_validated: l.times_validated,
        last_validated_at: l.last_validated_at,
      })),
      proven_learnings: report.proven_learnings.map(l => ({
        id: l.id,
        title: l.title,
        category: l.category,
        times_validated: l.times_validated,
      })),
    });
  } catch (error) {
    return errorResponse(`Failed to get improvement report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleGetContextBundle(args: unknown) {
  await ensureVectorDB();
  const input = GetContextBundleSchema.parse(args);

  try {
    const bundle: any = {
      generated_at: new Date().toISOString(),
      query: input.query || null,
    };

    // Get recent sessions
    if (input.include_recent_sessions) {
      const recentSessions = listSessionsFromDb({ limit: input.sessions_limit });
      bundle.recent_sessions = recentSessions.map(s => ({
        id: s.id,
        summary: s.summary,
        tags: s.tags,
        created_at: s.created_at,
        full_context: s.full_context,
      }));
    }

    // Get relevant learnings
    if (input.include_learnings) {
      if (input.query) {
        // Semantic search for relevant learnings
        const searchResults = await searchLearnings(input.query, input.learnings_limit);
        const learningIds = searchResults.ids[0] || [];

        bundle.relevant_learnings = learningIds.map((id, i) => {
          const meta = searchResults.metadatas[0]?.[i] as any;
          return {
            id: id.replace('learning_', ''),
            content: searchResults.documents[0]?.[i]?.substring(0, 200),
            category: meta?.category,
            confidence: meta?.confidence,
            relevance: searchResults.distances?.[0]?.[i]
              ? Number((1 - searchResults.distances[0][i]).toFixed(3))
              : null,
          };
        });
      } else {
        // Get high-confidence learnings
        const learnings = listLearningsFromDb({
          confidence: 'proven',
          limit: input.learnings_limit,
        });

        // If not enough proven, get high confidence too
        if (learnings.length < input.learnings_limit) {
          const highConfidence = listLearningsFromDb({
            confidence: 'high',
            limit: input.learnings_limit - learnings.length,
          });
          learnings.push(...highConfidence);
        }

        bundle.key_learnings = learnings.map(l => ({
          id: l.id,
          title: l.title,
          description: l.description,
          category: l.category,
          confidence: l.confidence,
          context: l.context,
        }));
      }
    }

    // Add stats summary
    const stats = getSessionStats();
    bundle.stats_summary = {
      total_sessions: stats.total_sessions,
      total_commits: stats.total_commits,
      top_tags: stats.top_tags.slice(0, 5).map(t => t.tag),
    };

    return jsonResponse(bundle);
  } catch (error) {
    return errorResponse(`Failed to get context bundle: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleExportLearnings(args: unknown) {
  const input = ExportLearningsSchema.parse(args);

  try {
    const learnings = listLearningsFromDb({ limit: 1000 });

    if (input.format === 'json') {
      const outputPath = input.output_path || 'learnings.json';
      const data = {
        exported_at: new Date().toISOString(),
        total: learnings.length,
        learnings: learnings.map(l => ({
          id: l.id,
          category: l.category,
          title: l.title,
          description: l.description,
          context: l.context,
          confidence: l.confidence,
          times_validated: l.times_validated,
          source_session_id: l.source_session_id,
          created_at: l.created_at,
        })),
      };

      writeFileSync(outputPath, JSON.stringify(data, null, 2));

      return jsonResponse({
        success: true,
        format: 'json',
        output_path: outputPath,
        total_learnings: learnings.length,
      });
    }

    // Markdown format
    const outputPath = input.output_path || 'LEARNINGS.md';
    let md = '# Learnings\n\n';
    md += `_Auto-generated: ${new Date().toISOString()}_\n\n`;
    md += `**Total:** ${learnings.length} learnings\n\n`;

    // Group by category
    const byCategory: Record<string, typeof learnings> = {};
    for (const l of learnings) {
      if (!byCategory[l.category]) {
        byCategory[l.category] = [];
      }
      byCategory[l.category].push(l);
    }

    // Confidence badges
    const confidenceBadge = (c: string) => {
      switch (c) {
        case 'proven': return '**[PROVEN]**';
        case 'high': return '[high]';
        case 'medium': return '[medium]';
        case 'low': return '[low]';
        default: return `[${c}]`;
      }
    };

    // Sort categories
    const categoryOrder = ['architecture', 'performance', 'tooling', 'debugging', 'process', 'security', 'testing'];
    const sortedCategories = Object.keys(byCategory).sort((a, b) => {
      const aIdx = categoryOrder.indexOf(a);
      const bIdx = categoryOrder.indexOf(b);
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    for (const category of sortedCategories) {
      const items = byCategory[category];
      md += `## ${capitalize(category)}\n\n`;

      // Sort by confidence (proven first) then by times_validated
      items.sort((a, b) => {
        const confOrder = ['proven', 'high', 'medium', 'low'];
        const aConf = confOrder.indexOf(a.confidence || 'medium');
        const bConf = confOrder.indexOf(b.confidence || 'medium');
        if (aConf !== bConf) return aConf - bConf;
        return (b.times_validated || 1) - (a.times_validated || 1);
      });

      for (const item of items) {
        const badge = confidenceBadge(item.confidence || 'medium');
        const validated = item.times_validated && item.times_validated > 1
          ? ` (validated ${item.times_validated}x)`
          : '';

        md += `### ${badge} ${item.title}${validated}\n\n`;

        if (item.description) {
          md += `${item.description}\n\n`;
        }

        if (item.context) {
          md += `> **When to apply:** ${item.context}\n\n`;
        }

        if (input.include_sessions && item.source_session_id) {
          md += `_Source: ${item.source_session_id}_\n\n`;
        }
      }
    }

    // Add summary stats
    const report = getImprovementReport();
    md += '---\n\n';
    md += '## Summary\n\n';
    md += '| Confidence | Count |\n';
    md += '|------------|-------|\n';
    for (const conf of report.by_confidence) {
      md += `| ${conf.confidence} | ${conf.count} |\n`;
    }
    md += '\n';

    md += '| Category | Count |\n';
    md += '|----------|-------|\n';
    for (const cat of report.by_category) {
      md += `| ${cat.category} | ${cat.count} |\n`;
    }

    writeFileSync(outputPath, md);

    return jsonResponse({
      success: true,
      format: 'markdown',
      output_path: outputPath,
      total_learnings: learnings.length,
      categories: Object.keys(byCategory).length,
    });
  } catch (error) {
    return errorResponse(`Failed to export learnings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function handleRebuildSearchIndex(args: unknown) {
  await ensureVectorDB();
  const input = RebuildIndexSchema.parse(args);

  try {
    const results: any = { rebuilt: [] };

    if (input.collection === 'sessions' || input.collection === 'all') {
      const sessions = listSessionsFromDb({ limit: 10000 });
      // Note: Would need to implement batch upsert to ChromaDB
      // For now, just return count
      results.sessions = {
        count: sessions.length,
        status: 'ready_for_rebuild',
      };
      results.rebuilt.push('sessions');
    }

    if (input.collection === 'learnings' || input.collection === 'all') {
      const learnings = listLearningsFromDb({ limit: 10000 });
      results.learnings = {
        count: learnings.length,
        status: 'ready_for_rebuild',
      };
      results.rebuilt.push('learnings');
    }

    return jsonResponse({
      success: true,
      ...results,
      hint: "Full rebuild requires manual implementation of batch upsert",
    });
  } catch (error) {
    return errorResponse(`Failed to rebuild index: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============ Export Handlers Map ============

export const analyticsHandlers: Record<string, ToolHandler> = {
  get_session_stats: handleGetSessionStats,
  get_improvement_report: handleGetImprovementReport,
  get_context_bundle: handleGetContextBundle,
  export_learnings: handleExportLearnings,
  rebuild_search_index: handleRebuildSearchIndex,
};
