import { Client, GatewayIntentBits, Partials } from 'discord.js';
import type { AppConfig } from '../config/env.js';

export function createDiscordClient(_config: AppConfig): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel],
  });

  return client;
}
