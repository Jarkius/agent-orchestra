/**
 * Gateway Types — Phase C (ADR-013 / ADR-018)
 *
 * Type definitions for the Messaging Gateway.
 */

// ============ Configuration ============

export interface GatewayConfig {
  enabled: boolean;
  port: number;
  channels: {
    telegram: {
      enabled: boolean;
      bot_token_env: string;
      allowed_users: string[];
    };
  };
  security: {
    allowed_users_only: boolean;
    sandbox_shell: boolean;
    max_tokens_per_message: number;
    daily_token_budget: number;
    rate_limit_per_minute: number;
    pairing_required: boolean;
    elevated_timeout_minutes: number;
  };
  claude: {
    api_key_env: string;
    default_model: string;
    opus_model: string;
    haiku_model: string;
  };
  llm: {
    provider: string; // 'auto' | 'gemini' | 'openai' | 'anthropic'
    gemini: { opus: string; sonnet: string; haiku: string };
    openai: { opus: string; sonnet: string; haiku: string };
    anthropic: { opus: string; sonnet: string; haiku: string };
  };
}

// ============ Agent Routing ============

export interface AgentRoute {
  agent: string;
  model: 'opus' | 'sonnet' | 'haiku';
  personality_file: string;
  description: string;
}

export const AGENT_ROUTES: Record<string, AgentRoute> = {
  oracle: {
    agent: 'Oracle',
    model: 'sonnet',
    personality_file: 'oracle-keeper.md',
    description: 'Orchestrator — wisdom, status, alignment',
  },
  neo: {
    agent: 'Neo',
    model: 'opus',
    personality_file: 'neo.md',
    description: 'Developer — code, implementation',
  },
  smith: {
    agent: 'Smith',
    model: 'opus',
    personality_file: 'agent-smith.md',
    description: 'Debugger — bugs, security, anomalies',
  },
  trinity: {
    agent: 'Trinity',
    model: 'opus',
    personality_file: 'trinity.md',
    description: 'Design — tokens, review, guide',
  },
  morpheus: {
    agent: 'Morpheus',
    model: 'sonnet',
    personality_file: 'morpheus.md',
    description: 'Navigator — external intel, research',
  },
  architect: {
    agent: 'Architect',
    model: 'opus',
    personality_file: 'architect.md',
    description: 'System Design — ADRs, architecture',
  },
  tank: {
    agent: 'Tank',
    model: 'haiku',
    personality_file: 'tank.md',
    description: 'Operator — code search, git, dependencies',
  },
  scribe: {
    agent: 'Scribe',
    model: 'sonnet',
    personality_file: 'scribe.md',
    description: 'Memory — retrospectives, documentation',
  },
};

// ============ Security ============

export interface RateLimitEntry {
  userId: string;
  timestamps: number[];
}

export interface PairingSession {
  code: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface UserSession {
  userId: string;
  paired: boolean;
  pairedAt?: number;
  elevated: boolean;
  elevatedUntil?: number;
  tokenUsageToday: number;
  lastReset: string; // YYYY-MM-DD
}

// ============ Messages ============

export interface GatewayMessage {
  userId: string;
  chatId: number;
  text: string;
  timestamp: number;
  agent?: string;
  replyToMessageId?: number;
}

export interface GatewayResponse {
  text: string;
  agent: string;
  model: string;
  tokensUsed: number;
  durationMs: number;
}

// ============ Tools (Claude API) ============

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
