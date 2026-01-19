#!/usr/bin/env bun
/**
 * Auto-capture session context from Claude Code files
 *
 * Reads from:
 * - ~/.claude/history.jsonl - User messages
 * - ~/.claude/todos/{sessionId}-*.json - Task lists
 * - ~/.claude/plans/*.md - Recent plan files
 *
 * Usage:
 *   import { captureFromClaudeCode } from './capture-context';
 *   const context = captureFromClaudeCode();
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = join(homedir(), '.claude');

export interface TaskInput {
  description: string;
  status: 'done' | 'pending' | 'blocked' | 'in_progress';
  notes?: string;
}

export interface CapturedContext {
  sessionId: string;
  project: string;
  userMessages: string[];
  tasks: TaskInput[];
  planFile?: string;
  planContent?: string;
  messageCount: number;
  duration: {
    start: Date;
    end: Date;
    minutes: number;
  };
}

interface HistoryEntry {
  display: string;
  pastedContents: Record<string, unknown>;
  timestamp: number;
  project: string;
  sessionId: string;
}

interface TodoEntry {
  content: string;
  status: 'completed' | 'in_progress' | 'pending';
  activeForm: string;
}

/**
 * Capture context from Claude Code's local files
 */
export function captureFromClaudeCode(projectPath?: string): CapturedContext {
  // 1. Read history.jsonl and find current session
  const historyPath = join(CLAUDE_DIR, 'history.jsonl');
  if (!existsSync(historyPath)) {
    throw new Error('No history.jsonl found - is Claude Code installed?');
  }

  const lines = readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
  const entries: HistoryEntry[] = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean) as HistoryEntry[];

  if (entries.length === 0) {
    throw new Error('No history entries found');
  }

  // Find current session - either by project path or most recent
  let currentSessionId: string;
  let sessionEntries: HistoryEntry[];

  if (projectPath) {
    // Filter by project path first, then get most recent session
    const projectEntries = entries.filter((e) => e.project === projectPath);
    if (projectEntries.length === 0) {
      throw new Error(`No history entries for project: ${projectPath}`);
    }
    currentSessionId = projectEntries[projectEntries.length - 1]!.sessionId;
    sessionEntries = projectEntries.filter((e) => e.sessionId === currentSessionId);
  } else {
    // Most recent session overall
    currentSessionId = entries[entries.length - 1]!.sessionId;
    sessionEntries = entries.filter((e) => e.sessionId === currentSessionId);
  }

  const userMessages = sessionEntries.map((e) => e.display);
  const project = sessionEntries[0]?.project || '';

  // Calculate duration
  const startTime = new Date(sessionEntries[0]?.timestamp || Date.now());
  const endTime = new Date(sessionEntries[sessionEntries.length - 1]?.timestamp || Date.now());
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

  // 2. Read todos for this session
  const tasks: TaskInput[] = [];
  const todosDir = join(CLAUDE_DIR, 'todos');

  if (existsSync(todosDir)) {
    try {
      const todoFiles = readdirSync(todosDir).filter((f) => f.startsWith(currentSessionId));

      for (const file of todoFiles) {
        try {
          const content = readFileSync(join(todosDir, file), 'utf-8');
          const todos: TodoEntry[] = JSON.parse(content);

          if (Array.isArray(todos)) {
            for (const todo of todos) {
              // Map Claude Code status to our status
              let status: TaskInput['status'] = 'pending';
              if (todo.status === 'completed') status = 'done';
              else if (todo.status === 'in_progress') status = 'in_progress';

              tasks.push({
                description: todo.content,
                status,
              });
            }
          }
        } catch {
          // Skip invalid todo files
        }
      }
    } catch {
      // Todos dir read failed, continue without tasks
    }
  }

  // 3. Find recent plan files (modified in last 24h)
  let planFile: string | undefined;
  let planContent: string | undefined;
  const plansDir = join(CLAUDE_DIR, 'plans');

  if (existsSync(plansDir)) {
    try {
      const planFiles = readdirSync(plansDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({
          name: f,
          path: join(plansDir, f),
          mtime: statSync(join(plansDir, f)).mtime,
        }))
        .filter((f) => Date.now() - f.mtime.getTime() < 24 * 60 * 60 * 1000)
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      if (planFiles.length > 0) {
        planFile = planFiles[0]!.name;
        planContent = readFileSync(planFiles[0]!.path, 'utf-8');
      }
    } catch {
      // Plans dir read failed, continue without plan
    }
  }

  return {
    sessionId: currentSessionId,
    project,
    userMessages,
    tasks,
    planFile,
    planContent,
    messageCount: userMessages.length,
    duration: {
      start: startTime,
      end: endTime,
      minutes: durationMinutes,
    },
  };
}

/**
 * Format captured context for display
 */
export function formatCapturedContext(context: CapturedContext): string {
  const lines: string[] = [];

  lines.push(`📍 Session: ${context.sessionId.substring(0, 8)}...`);
  lines.push(`   Project: ${context.project}`);
  lines.push(`   Messages: ${context.messageCount}`);
  lines.push(`   Duration: ${context.duration.minutes} mins`);

  if (context.tasks.length > 0) {
    const done = context.tasks.filter((t) => t.status === 'done').length;
    const pending = context.tasks.filter((t) => t.status === 'pending').length;
    const inProgress = context.tasks.filter((t) => t.status === 'in_progress').length;
    lines.push(`   Tasks: ${done} done, ${inProgress} in progress, ${pending} pending`);
  }

  if (context.planFile) {
    lines.push(`   Plan: ${context.planFile}`);
  }

  if (context.userMessages.length > 0) {
    lines.push('\n📝 Recent messages:');
    // Show last 5 messages
    const recentMessages = context.userMessages.slice(-5);
    for (const msg of recentMessages) {
      const truncated = msg.length > 60 ? msg.substring(0, 60) + '...' : msg;
      lines.push(`   • ${truncated}`);
    }
  }

  return lines.join('\n');
}

// CLI: Run directly to test
if (import.meta.main) {
  try {
    const projectPath = process.cwd();
    console.log(`\n🔍 Capturing context for: ${projectPath}\n`);

    const context = captureFromClaudeCode(projectPath);
    console.log(formatCapturedContext(context));

    if (context.tasks.length > 0) {
      console.log('\n📋 Tasks:');
      for (const task of context.tasks) {
        const icon = task.status === 'done' ? '✓' : task.status === 'in_progress' ? '→' : '○';
        console.log(`   ${icon} [${task.status}] ${task.description}`);
      }
    }

    if (context.planContent) {
      console.log('\n📄 Plan preview:');
      const preview = context.planContent.split('\n').slice(0, 10).join('\n');
      console.log(preview);
      if (context.planContent.split('\n').length > 10) {
        console.log('   ...');
      }
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
