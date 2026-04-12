/**
 * Startup validation script for Dockerized deployment.
 *
 * Verifies that all critical subsystems can initialize:
 * 1. Environment configuration loads without error
 * 2. PostgreSQL is reachable and migrations can run
 * 3. Redis is reachable
 * 4. Provider configuration is valid for the configured routes
 * 5. Discord client credentials are present
 *
 * Usage:  node dist/validate-startup.js
 * Exit:   0 on success, 1 on failure
 *
 * Designed to be run as a pre-flight check before the main bot starts,
 * or as a Docker health check.
 */
import { Pool } from 'pg';
import { Redis as IORedis } from 'ioredis';
import { loadConfig } from './config/env.js';
import { validateProviderConfig } from './providers/validation.js';
import { createLogger } from './lib/logger.js';

const logger = createLogger('validate-startup');

interface CheckResult {
  name: string;
  ok: boolean;
  message: string;
  durationMs: number;
}

async function runCheck(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const message = await fn();
    return { name, ok: true, message, durationMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, ok: false, message, durationMs: Date.now() - start };
  }
}

async function main(): Promise<void> {
  logger.info('Running startup validation…');

  const results: CheckResult[] = [];

  // 1. Configuration
  let config: ReturnType<typeof loadConfig> | undefined;
  results.push(
    await runCheck('config', async () => {
      config = loadConfig();
      return `env=${config.env}, logLevel=${config.logLevel}`;
    }),
  );

  if (!config) {
    reportAndExit(results);
    return;
  }

  // 2. PostgreSQL connectivity
  results.push(
    await runCheck('postgres', async () => {
      const pool = new Pool({ connectionString: config!.database.url });
      try {
        const { rows } = await pool.query('SELECT current_database() AS db, version()');
        return `connected to ${rows[0].db}`;
      } finally {
        await pool.end();
      }
    }),
  );

  // 3. Redis connectivity
  results.push(
    await runCheck('redis', async () => {
      const redis = new IORedis(config!.redis.url, { maxRetriesPerRequest: 1, connectTimeout: 5000 });
      try {
        const pong = await redis.ping();
        return `PING → ${pong}`;
      } finally {
        await redis.quit();
      }
    }),
  );

  // 4. Provider configuration
  results.push(
    await runCheck('providers', async () => {
      const validation = validateProviderConfig(config!);
      if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
      }
      return `all provider secrets valid (llm=${config!.llm.interpretation.provider}, stt=${config!.stt.provider}, tts=${config!.tts.provider})`;
    }),
  );

  // 5. Discord credentials present
  results.push(
    await runCheck('discord', async () => {
      if (!config!.discord.token) throw new Error('DISCORD_TOKEN is empty');
      if (!config!.discord.clientId) throw new Error('DISCORD_CLIENT_ID is empty');
      return `clientId=${config!.discord.clientId.slice(0, 6)}…`;
    }),
  );

  // 6. Default persona exists in database
  results.push(
    await runCheck('default-persona', async () => {
      const pool = new Pool({ connectionString: config!.database.url });
      try {
        const personaName = config!.persona.default;
        const { rows } = await pool.query(
          'SELECT id, name FROM personas WHERE name = $1',
          [personaName],
        );
        if (rows.length === 0) {
          throw new Error(
            `DEFAULT_PERSONA="${personaName}" does not match any row in the personas table — interaction persistence will fail`,
          );
        }
        return `persona "${personaName}" → id=${rows[0].id.slice(0, 8)}…`;
      } finally {
        await pool.end();
      }
    }),
  );

  // 7. Discord privileged intents advisory
  logger.info(
    [
      'Reminder: Jarvis requires these privileged Gateway Intents enabled in the Discord Developer Portal:',
      '  • MESSAGE CONTENT INTENT  — read message text',
      '  • SERVER MEMBERS INTENT   — member lookup, rename, move, mute, deafen, voice speaker attribution',
      'Portal: https://discord.com/developers/applications → your app → Bot → Privileged Gateway Intents',
      'If these are not enabled, the bot will fail at login with "Used disallowed intents".',
    ].join('\n'),
  );

  reportAndExit(results);
}

function reportAndExit(results: CheckResult[]): void {
  const allOk = results.every((r) => r.ok);

  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    const level = r.ok ? 'info' : 'error';
    logger[level](
      { check: r.name, ok: r.ok, durationMs: r.durationMs },
      `${icon} ${r.name}: ${r.message}`,
    );
  }

  if (allOk) {
    logger.info('All startup checks passed');
    process.exit(0);
  } else {
    const failed = results.filter((r) => !r.ok).map((r) => r.name);
    logger.error({ failed }, 'Startup validation failed');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'Startup validation crashed');
  process.exit(1);
});
