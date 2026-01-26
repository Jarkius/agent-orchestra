#!/usr/bin/env bun
/**
 * /memory-llm - Query external LLMs (Gemini, OpenAI, Anthropic)
 *
 * Usage:
 *   bun memory llm "What is TypeScript?"           # Query Gemini (default)
 *   bun memory llm --gemini "Question"             # Explicit Gemini
 *   bun memory llm --openai "Question"             # Use OpenAI
 *   bun memory llm --anthropic "Question"          # Use Anthropic
 *   bun memory llm --model gemini-3-pro "Question" # Specific model
 *   bun memory llm --thinking high "Complex Q"     # High reasoning depth
 *   bun memory llm providers                       # List available providers
 */

import { ExternalLLM, type LLMProvider, type LLMOptions } from '../../src/services/external-llm';

function printUsage() {
  console.log(`
Usage: bun memory llm [options] <prompt>

Options:
  --gemini        Use Gemini (default)
  --openai        Use OpenAI
  --anthropic     Use Anthropic
  --model <name>  Specific model (e.g., gemini-3-pro, gpt-4o)
  --thinking <level>  Gemini 3 thinking depth: low (recommended), medium, high
  --max-tokens <n>    Maximum output tokens

Commands:
  providers       List available providers (based on API keys)

Examples:
  bun memory llm "What is TypeScript?"
  bun memory llm --thinking high "Explain quantum computing"
  bun memory llm --model gemini-3-pro "Complex reasoning task"
  bun memory llm providers
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // Handle 'providers' command
  if (args[0] === 'providers') {
    const available = ExternalLLM.getAvailableProviders();
    console.log('\nAvailable LLM Providers:\n');
    if (available.length === 0) {
      console.log('  None configured. Set API keys in .env.local:');
      console.log('    GEMINI_API_KEY=xxx');
      console.log('    OPENAI_API_KEY=xxx');
      console.log('    ANTHROPIC_API_KEY=xxx');
    } else {
      for (const p of available) {
        console.log(`  ✅ ${p}`);
      }
    }
    console.log('');
    return;
  }

  // Parse options
  let provider: LLMProvider = 'gemini';
  const options: LLMOptions = {};
  const promptParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--gemini') {
      provider = 'gemini';
    } else if (arg === '--openai') {
      provider = 'openai';
    } else if (arg === '--anthropic') {
      provider = 'anthropic';
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === '--thinking' && args[i + 1]) {
      options.thinkingLevel = args[++i] as 'low' | 'medium' | 'high';
    } else if (arg === '--max-tokens' && args[i + 1]) {
      options.maxOutputTokens = parseInt(args[++i]!);
    } else if (!arg.startsWith('--')) {
      promptParts.push(arg);
    }
  }

  const prompt = promptParts.join(' ');
  if (!prompt) {
    console.error('Error: No prompt provided');
    printUsage();
    process.exit(1);
  }

  try {
    console.log(`\n🤖 Querying ${provider}...\n`);

    const llm = new ExternalLLM(provider);
    const response = await llm.query(prompt, options);

    console.log('━'.repeat(60));
    console.log(response.text);
    console.log('━'.repeat(60));

    if (response.usage) {
      console.log(`\n📊 Tokens: ${response.usage.inputTokens} in / ${response.usage.outputTokens} out`);
    }
    console.log(`📦 Model: ${response.model}`);
    console.log('');
  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
