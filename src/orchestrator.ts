import { $ } from "bun";
import { getAllAgents, getRecentMessages, clearSession } from "./db";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const AGENT_COLORS = [COLORS.red, COLORS.green, COLORS.yellow, COLORS.blue, COLORS.magenta, COLORS.cyan];

const STATUS_ICONS: Record<string, string> = {
  pending: "⏳",
  running: "🔄",
  working: "⚙️",
  completed: "✅",
  error: "❌",
  waiting: "💬",
};

// Get session name from environment or detect
const SESSION = process.env.TMUX_SESSION || "orchestrated";

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function getAgentColor(id: number): string {
  return AGENT_COLORS[(id - 1) % AGENT_COLORS.length] ?? '\x1b[37m';
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", { hour12: false });
}

// Send text to agent pane via tmux (with [ORCH] prefix for source tracking)
async function sendToAgent(agentId: number, text: string) {
  const paneId = `${SESSION}:0.${agentId}`;
  const prefixedText = `[ORCH]${text}`;
  try {
    await $`tmux send-keys -t ${paneId} ${prefixedText} Enter`.quiet();
    return true;
  } catch (e) {
    return false;
  }
}

// List available panes
async function listPanes() {
  try {
    const result = await $`tmux list-panes -t ${SESSION} -F "#{pane_index}: #{pane_current_command}"`.text();
    return result.trim();
  } catch (e) {
    return "Could not list panes";
  }
}

function renderDashboard() {
  clearScreen();

  const agents = getAllAgents() as any[];
  const messages = getRecentMessages(8) as any[];

  // Header
  console.log(`${COLORS.bold}${COLORS.cyan}╔══════════════════════════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}║           AGENT ORCHESTRATOR - CONTROL CENTER                ║${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}╚══════════════════════════════════════════════════════════════╝${COLORS.reset}`);
  console.log();

  // Agent Status Section
  console.log(`${COLORS.bold}┌─ AGENTS ─────────────────────────────────────────────────────┐${COLORS.reset}`);

  if (agents.length === 0) {
    console.log(`${COLORS.gray}  No agents registered yet... (waiting for agents to start)${COLORS.reset}`);
  } else {
    for (const agent of agents) {
      const color = getAgentColor(agent.id);
      const icon = STATUS_ICONS[agent.status] || "❓";
      const task = agent.current_task || "idle";
      const time = formatTime(agent.updated_at);
      const pane = `pane ${agent.id}`;

      console.log(
        `  ${color}${COLORS.bold}Agent ${agent.id}${COLORS.reset} │ ${icon} ${agent.status.padEnd(10)} │ ${task.padEnd(20)} │ ${COLORS.gray}${pane} │ ${time}${COLORS.reset}`
      );
    }
  }
  console.log(`${COLORS.bold}└──────────────────────────────────────────────────────────────┘${COLORS.reset}`);
  console.log();

  // Activity Log Section
  console.log(`${COLORS.bold}┌─ ACTIVITY LOG ───────────────────────────────────────────────┐${COLORS.reset}`);

  if (messages.length === 0) {
    console.log(`${COLORS.gray}  No activity yet...${COLORS.reset}`);
  } else {
    for (const msg of messages.slice(0, 6)) {
      const fromColor = msg.from_id === "orchestrator" ? COLORS.cyan : getAgentColor(parseInt(msg.from_id) || 0);
      const time = formatTime(msg.created_at);
      const content = msg.content.length > 50 ? msg.content.substring(0, 47) + "..." : msg.content;

      console.log(
        `  ${COLORS.gray}${time}${COLORS.reset} ${fromColor}[${msg.from_id.padEnd(4)}]${COLORS.reset} ${content}`
      );
    }
  }
  console.log(`${COLORS.bold}└──────────────────────────────────────────────────────────────┘${COLORS.reset}`);
  console.log();

  // Commands
  console.log(`${COLORS.bold}Commands:${COLORS.reset}`);
  console.log(`  ${COLORS.yellow}t <id> <text>${COLORS.reset}  - Type text into agent pane (tmux send-keys)`);
  console.log(`  ${COLORS.yellow}r${COLORS.reset}             - Refresh dashboard`);
  console.log(`  ${COLORS.yellow}p${COLORS.reset}             - List panes`);
  console.log(`  ${COLORS.yellow}c${COLORS.reset}             - Clear logs`);
  console.log(`  ${COLORS.yellow}q${COLORS.reset}             - Quit`);
  console.log();
}

// Handle stdin for commands
async function handleInput() {
  const stdin = Bun.stdin.stream();
  const reader = stdin.getReader();
  const decoder = new TextDecoder();

  process.stdout.write(`${COLORS.cyan}>${COLORS.reset} `);

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const input = decoder.decode(value).trim();

    if (input === "q" || input === "quit") {
      console.log("Goodbye!");
      process.exit(0);
    }

    if (input === "r" || input === "refresh") {
      renderDashboard();
      process.stdout.write(`${COLORS.cyan}>${COLORS.reset} `);
      continue;
    }

    if (input === "c" || input === "clear") {
      clearSession();
      console.log(`${COLORS.green}Logs cleared${COLORS.reset}`);
      process.stdout.write(`${COLORS.cyan}>${COLORS.reset} `);
      continue;
    }

    if (input === "p" || input === "panes") {
      const panes = await listPanes();
      console.log(`${COLORS.bold}Panes:${COLORS.reset}\n${panes}`);
      process.stdout.write(`${COLORS.cyan}>${COLORS.reset} `);
      continue;
    }

    // t <id> <text> - type into agent pane
    if (input.startsWith("t ") || input.startsWith("type ")) {
      const parts = input.split(" ");
      const agentId = parseInt(parts[1] ?? "0");
      const text = parts.slice(2).join(" ");

      if (!agentId || !text) {
        console.log(`${COLORS.red}Usage: t <agent_id> <text>${COLORS.reset}`);
      } else {
        const success = await sendToAgent(agentId, text);
        if (success) {
          console.log(`${COLORS.green}Sent to agent ${agentId}: ${text}${COLORS.reset}`);
        } else {
          console.log(`${COLORS.red}Failed to send to agent ${agentId}${COLORS.reset}`);
        }
      }
      process.stdout.write(`${COLORS.cyan}>${COLORS.reset} `);
      continue;
    }

    if (input) {
      console.log(`${COLORS.gray}Unknown: ${input}. Try: t <id> <text>, r, p, c, q${COLORS.reset}`);
      process.stdout.write(`${COLORS.cyan}>${COLORS.reset} `);
    }
  }
}

// Main
function startDashboard() {
  renderDashboard();
  handleInput();
}

console.log("Starting orchestrator...");
startDashboard();
