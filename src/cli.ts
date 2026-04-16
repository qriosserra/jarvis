#!/usr/bin/env node
/**
 * CLI entry point for simulated text interactions.
 *
 * Bootstraps the full Jarvis pipeline (DB, Redis, repos, providers,
 * queues) *without* Discord, then processes a text request through
 * the same interpretation → response / action pipeline.
 *
 * Deterministic actions are simulated — no live Discord mutations.
 *
 * Usage:
 *   pnpm cli "What time is it?"
 *   pnpm cli --guild sim-guild --user sim-user "rename alice to Ally"
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createLogger } from './lib/logger.js';
import { runWithCorrelationId } from './lib/correlation.js';
import { bootstrap } from './bootstrap.js';
import { handleInteraction } from './interaction/orchestrator.js';
import type { InteractionContext, RequestTrigger } from './interaction/types.js';

const logger = createLogger('cli');

// ── Arg parsing ───────────────────────────────────────────────────────

interface CliOptions {
  guild: string;
  channel: string;
  user: string;
  username: string;
  persona: string;
  language?: string;
  trigger: RequestTrigger;
  noMemory: boolean;
}

function parseCliArgs(): { requestText: string; options: CliOptions } {
  const { values, positionals } = parseArgs({
    options: {
      guild:    { type: 'string', default: 'cli-guild' },
      channel:  { type: 'string', default: 'cli-channel' },
      user:     { type: 'string', default: 'cli-user' },
      username: { type: 'string', default: 'cli-user' },
      persona:  { type: 'string', default: 'jarvis' },
      language: { type: 'string' },
      trigger:    { type: 'string', default: 'mention' },
      'no-memory': { type: 'boolean', default: false },
      help:       { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(`
Jarvis CLI — simulated text interaction

Usage:
  pnpm cli [options] "<request>"

Options:
  --guild <id>       Guild ID for the simulated request     (default: cli-guild)
  --channel <id>     Channel ID for the simulated request   (default: cli-channel)
  --user <id>        Requester member ID                    (default: cli-user)
  --username <name>  Requester username                     (default: cli-user)
  --persona <name>   Persona name                           (default: jarvis)
  --language <code>  Language hint (e.g. "en", "nl")
  --trigger <type>   Request trigger: mention|reply|indirect (default: mention)
  --no-memory        Skip memory persistence
  -h, --help         Show this help

Examples:
  pnpm cli "What time is it?"
  pnpm cli --language nl "Hoe laat is het?"
  pnpm cli "rename alice to Ally"
`);
    process.exit(0);
  }

  const requestText = positionals.join(' ');

  return {
    requestText,
    options: {
      guild: values.guild as string,
      channel: values.channel as string,
      user: values.user as string,
      username: values.username as string,
      persona: values.persona as string,
      language: values.language as string | undefined,
      trigger: (values.trigger as RequestTrigger) ?? 'mention',
      noMemory: Boolean(values['no-memory']),
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { requestText, options } = parseCliArgs();

  console.log('\n🔧 Bootstrapping Jarvis (headless)…\n');
  const { container, shutdown } = await bootstrap();

  const correlationId = randomUUID();

  const ctx: InteractionContext = {
    correlationId,
    guildId: options.guild,
    guildName: options.guild,
    channelId: options.channel,
    surface: 'text',
    requester: {
      id: options.user,
      username: options.username,
      displayName: options.username,
    },
    requestText,
    trigger: options.trigger,
    personaId: options.persona,
    language: options.language,
    timestamp: new Date(),
    simulateActions: true,
    backgroundTasks: [],
    skipMemoryPersistence: options.noMemory,
    replyHandler: (text: string) => {
      console.log('\n┌─ Jarvis reply ─────────────────────────────────────────');
      console.log(`│ ${text.replace(/\n/g, '\n│ ')}`);
      console.log('└────────────────────────────────────────────────────────\n');
    },
  };

  console.log(`📨 Request: "${requestText}"`);
  console.log(`   guild=${options.guild}  user=${options.user}  trigger=${options.trigger}`);
  console.log(`   correlationId=${correlationId}\n`);

  await runWithCorrelationId(
    () => handleInteraction(ctx),
    correlationId,
  );

  // Wait for background tasks (memory persistence) before tearing down infra
  if (ctx.backgroundTasks!.length > 0) {
    logger.info(`Awaiting ${ctx.backgroundTasks!.length} background task(s)…`);
    await Promise.allSettled(ctx.backgroundTasks!);
  }

  await shutdown();
}

main().catch((err) => {
  logger.fatal({ err }, 'CLI failed');
  process.exit(1);
});
