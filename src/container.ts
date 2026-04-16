import type { Kysely } from 'kysely';
import type { AppConfig } from './config/env.js';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import type { Queues } from './queue/definitions.js';
import type { ProviderRouter } from './providers/router.js';
import type { Database } from './db/kysely.js';
import type {
  GuildRepo,
  MemberRepo,
  UserRepo,
  GuildMembershipRepo,
  PersonaRepo,
  InteractionRepo,
  MemoryRecordRepo,
  IdentityAliasRepo,
  ActionOutcomeRepo,
  EmbeddingRepo,
  OperationLogRepo,
  MemoryRetrieval,
} from './db/repos.js';

export interface Repos {
  guilds: GuildRepo;
  members: MemberRepo;
  users: UserRepo;
  guildMemberships: GuildMembershipRepo;
  personas: PersonaRepo;
  interactions: InteractionRepo;
  memoryRecords: MemoryRecordRepo;
  identityAliases: IdentityAliasRepo;
  actionOutcomes: ActionOutcomeRepo;
  embeddings: EmbeddingRepo;
  operationLog: OperationLogRepo;
  memoryRetrieval: MemoryRetrieval;
}

export interface Container {
  config: AppConfig;
  /** Discord client — absent in headless/CLI mode. */
  discord?: Client;
  db: Kysely<Database>;
  redis: Redis;
  repos: Repos;
  queues: Queues;
  providers: ProviderRouter;
}

/**
 * Return the Discord client, throwing a clear error if the container
 * was initialised in headless mode (CLI, tests without Discord).
 */
export function getDiscordClient(): Client {
  const c = getContainer();
  if (!c.discord) {
    throw new Error('Discord client is not available — running in headless mode');
  }
  return c.discord;
}

let _container: Container | undefined;

export function setContainer(c: Container): void {
  _container = c;
}

export function getContainer(): Container {
  if (!_container) {
    throw new Error('Container not initialized — call setContainer() first');
  }
  return _container;
}
