import { createLogger } from './lib/logger.js';
import { createDiscordClient } from './discord/client.js';
import { registerEventHandlers } from './discord/events.js';
import { setContainer } from './container.js';
import { bootstrap } from './bootstrap.js';

const logger = createLogger('main');

async function main(): Promise<void> {
  // Shared infrastructure (DB, Redis, repos, providers, queues, workers)
  const { config, container, shutdown: infraShutdown } = await bootstrap();

  // Validate Discord credentials are present for bot mode
  if (!config.discord.token || !config.discord.clientId) {
    throw new Error(
      'DISCORD_TOKEN and DISCORD_CLIENT_ID are required for bot mode. ' +
      'For headless testing use `pnpm cli`.',
    );
  }

  // Discord
  const client = createDiscordClient(config);

  // Wire Discord client into the container
  container.discord = client;
  setContainer(container);

  // Register gateway event handlers before login
  registerEventHandlers(client);

  client.once('clientReady', () => {
    logger.info({ tag: client.user?.tag }, 'Jarvis connected to Discord');
  });

  try {
    await client.login(config.discord.token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('disallowed intents')) {
      logger.fatal(
        { err },
        [
          'Discord rejected login: Used disallowed intents.',
          'Jarvis requires these privileged Gateway Intents to be enabled in the Discord Developer Portal:',
          '  • MESSAGE CONTENT INTENT  — needed to read message text',
          '  • SERVER MEMBERS INTENT   — needed for member lookup, rename, move, mute, deafen, and voice speaker attribution',
          'Enable them at: https://discord.com/developers/applications → your app → Bot → Privileged Gateway Intents',
        ].join('\n'),
      );
      process.exit(1);
    }
    throw err;
  }

  // Graceful shutdown
  const shutdown = async () => {
    client.destroy();
    await infraShutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Jarvis failed to start');
  process.exit(1);
});
