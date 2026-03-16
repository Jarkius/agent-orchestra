/**
 * Gateway Tools — Phase C (ADR-013 / ADR-018)
 *
 * Sandboxed tool definitions for Claude API tool_use.
 * These are the capabilities available to agents when invoked via Telegram.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { isShellCommandAllowed, isPathAllowed, isElevated, type UserSession } from './security';

// ============ Tool Definitions (for Claude API) ============

export const GATEWAY_TOOLS = [
  {
    name: 'shell_exec',
    description: 'Execute a shell command in the project directory. Sandboxed to safe commands only (git, bun memory, cat, ls, grep). Use /sudo for elevated access.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'file_read',
    description: 'Read the contents of a file from the workspace. Path relative to project root.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        max_lines: { type: 'number', description: 'Maximum lines to read (default 100)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'memory_recall',
    description: 'Search the semantic memory system for relevant past context, sessions, learnings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'What to search for in memory' },
      },
      required: ['query'],
    },
  },
  {
    name: 'task_list',
    description: 'Read the active task registry showing all pending, in-progress, and blocked tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'git_status',
    description: 'Get git repository status including branch, uncommitted changes, and recent log.',
    input_schema: {
      type: 'object' as const,
      properties: {
        detail: { type: 'string', enum: ['status', 'log', 'diff', 'branches'], description: 'What git info to retrieve' },
      },
      required: ['detail'],
    },
  },
  {
    name: 'pulse_events',
    description: 'Read recent system events from the PULSE event queue.',
    input_schema: {
      type: 'object' as const,
      properties: {
        count: { type: 'number', description: 'Number of recent events (default 20, max 50)' },
        type_filter: { type: 'string', description: 'Filter by event type (e.g., "ci:fail", "git:push")' },
      },
      required: [],
    },
  },
  {
    name: 'dispatch',
    description: 'Run the event dispatcher to check for actionable items and trigger agent responses.',
    input_schema: {
      type: 'object' as const,
      properties: {
        mode: { type: 'string', enum: ['check', 'run', 'status'], description: 'Dispatch mode' },
      },
      required: ['mode'],
    },
  },
];

// ============ Tool Executors ============

export function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  projectRoot: string,
  session: UserSession
): string {
  try {
    switch (toolName) {
      case 'shell_exec':
        return execShell(input.command as string, projectRoot, session);
      case 'file_read':
        return execFileRead(input.path as string, input.max_lines as number | undefined, projectRoot, session);
      case 'memory_recall':
        return execMemoryRecall(input.query as string, projectRoot);
      case 'task_list':
        return execTaskList(projectRoot);
      case 'git_status':
        return execGitStatus(input.detail as string, projectRoot);
      case 'pulse_events':
        return execPulseEvents(input.count as number | undefined, input.type_filter as string | undefined, projectRoot);
      case 'dispatch':
        return execDispatch(input.mode as string, projectRoot);
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    return `Tool error: ${err}`;
  }
}

function execShell(command: string, projectRoot: string, session: UserSession): string {
  const elevated = isElevated(session);
  const check = isShellCommandAllowed(command, elevated);
  if (!check.allowed) {
    return `BLOCKED: ${check.reason}`;
  }

  try {
    const output = execSync(command, {
      encoding: 'utf8',
      timeout: 15000,
      cwd: projectRoot,
      maxBuffer: 1024 * 100,
    });
    return output.slice(0, 4000); // Telegram-friendly limit
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    return `Command failed: ${error.stderr || error.message || 'unknown error'}`.slice(0, 2000);
  }
}

function execFileRead(filePath: string, maxLines: number | undefined, projectRoot: string, session: UserSession): string {
  const elevated = isElevated(session);
  if (!isPathAllowed(filePath, projectRoot, elevated)) {
    return `BLOCKED: Path '${filePath}' is not accessible`;
  }

  const fullPath = resolve(projectRoot, filePath);
  if (!existsSync(fullPath)) {
    return `File not found: ${filePath}`;
  }

  const content = readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  const limit = Math.min(maxLines || 100, 200);
  const result = lines.slice(0, limit).join('\n');

  if (lines.length > limit) {
    return result + `\n\n... (${lines.length - limit} more lines truncated)`;
  }
  return result;
}

function execMemoryRecall(query: string, projectRoot: string): string {
  const mmaDir = join(projectRoot, 'lib', 'matrix-memory-agents');
  try {
    const output = execSync(`bun memory recall "${query.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      timeout: 10000,
      cwd: mmaDir,
    });
    return output.slice(0, 4000);
  } catch {
    // Fallback: grep sessions
    try {
      const output = execSync(`grep -rl "${query.replace(/"/g, '\\"')}" psi/memory/sessions/ 2>/dev/null | head -5`, {
        encoding: 'utf8',
        timeout: 5000,
        cwd: projectRoot,
      });
      return output || 'No memory matches found.';
    } catch {
      return 'Memory system unavailable.';
    }
  }
}

function execTaskList(projectRoot: string): string {
  const tasksPath = join(projectRoot, 'psi', 'memory', 'tasks', 'active.json');
  if (!existsSync(tasksPath)) return 'No task registry found.';

  try {
    const data = JSON.parse(readFileSync(tasksPath, 'utf8'));
    const tasks = data.tasks || [];
    if (tasks.length === 0) return 'No active tasks.';

    return tasks.map((t: { id: string; task: string; status: string; assignee: string }) =>
      `[${t.status}] ${t.task} (${t.assignee}) — ${t.id}`
    ).join('\n');
  } catch {
    return 'Failed to read task registry.';
  }
}

function execGitStatus(detail: string, projectRoot: string): string {
  const commands: Record<string, string> = {
    status: 'git status --short && echo "---" && git branch --show-current',
    log: 'git log --oneline -10',
    diff: 'git diff --stat',
    branches: 'git branch -a --list',
  };

  const cmd = commands[detail] || commands['status']!;
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: 10000,
      cwd: projectRoot,
    }).slice(0, 4000);
  } catch (err: unknown) {
    return `Git error: ${(err as Error).message}`;
  }
}

function execPulseEvents(count: number | undefined, typeFilter: string | undefined, projectRoot: string): string {
  const eventsPath = join(projectRoot, 'psi', 'pulse', 'events.jsonl');
  if (!existsSync(eventsPath)) return 'No events file found.';

  const content = readFileSync(eventsPath, 'utf8');
  let lines = content.trim().split('\n').filter(Boolean);

  // Take last N
  const limit = Math.min(count || 20, 50);
  lines = lines.slice(-limit);

  // Filter by type
  if (typeFilter) {
    lines = lines.filter(line => line.includes(`"type":"${typeFilter}"`));
  }

  if (lines.length === 0) return 'No matching events.';
  return lines.join('\n').slice(0, 4000);
}

function execDispatch(mode: string, projectRoot: string): string {
  const dispatcherPath = join(projectRoot, '.claude', 'hooks', 'pulse-event-dispatcher.sh');
  if (!existsSync(dispatcherPath)) return 'Event dispatcher not found.';

  const flag = mode === 'check' ? '--check-only' : mode === 'status' ? '--status' : '';
  try {
    const output = execSync(`bash "${dispatcherPath}" ${flag}`, {
      encoding: 'utf8',
      timeout: 15000,
      cwd: projectRoot,
      env: { ...process.env, PROJECT_ROOT: projectRoot },
    });
    return output || 'Dispatcher ran with no output.';
  } catch (err: unknown) {
    return `Dispatch error: ${(err as Error).message}`;
  }
}
