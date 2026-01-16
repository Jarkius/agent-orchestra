#!/usr/bin/env bun
import { registerAgent, updateAgentStatus, sendMessage, getAgentMessages } from "./db";

const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
Agent Reporter - CLI for agents to communicate with orchestrator

Usage:
  bun run src/agent-report.ts <command> [args]

Commands:
  register <id> <pane_id> <pid>     Register agent with orchestrator
  status <id> <status> [task]       Update agent status
  msg <id> <content>                Send message to orchestrator
  check <id>                        Check for messages from orchestrator
  `);
}

switch (command) {
  case "register": {
    const [, id, paneId, pid] = args;
    if (!id || !paneId || !pid) {
      console.error("Usage: register <id> <pane_id> <pid>");
      process.exit(1);
    }
    registerAgent(parseInt(id), paneId, parseInt(pid));
    console.log(`Agent ${id} registered`);
    break;
  }

  case "status": {
    const [, id, status, ...taskParts] = args;
    const task = taskParts.join(" ");
    if (!id || !status) {
      console.error("Usage: status <id> <status> [task]");
      process.exit(1);
    }
    updateAgentStatus(parseInt(id), status, task || undefined);
    break;
  }

  case "msg": {
    const [, id, ...contentParts] = args;
    const content = contentParts.join(" ");
    if (!id || !content) {
      console.error("Usage: msg <id> <content>");
      process.exit(1);
    }
    sendMessage(id, "orchestrator", content);
    break;
  }

  case "check": {
    const [, id] = args;
    if (!id) {
      console.error("Usage: check <id>");
      process.exit(1);
    }
    const messages = getAgentMessages(parseInt(id), 5) as any[];
    if (messages.length > 0) {
      for (const msg of messages) {
        console.log(`[${msg.from_id}] ${msg.content}`);
      }
    }
    break;
  }

  default:
    printUsage();
    process.exit(1);
}
