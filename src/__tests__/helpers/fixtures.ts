import { vi } from 'vitest';
import type { AppConfig } from '../../config/env.js';
import type { Container, Repos } from '../../container.js';
import type { ProviderRouter, ProviderRegistry } from '../../providers/router.js';
import type {
  LlmProvider,
  SttProvider,
  TtsProvider,
  ResearchProvider,
  EmbeddingProvider,
  LlmResponse,
  TtsResult,
} from '../../providers/types.js';
import type { InteractionContext } from '../../interaction/types.js';
import { setLatencyRepoAccessor } from '../../lib/latency-tracker.js';

// ── Stub providers ───────────────────────────────────────────────────

export function stubLlmProvider(overrides?: Partial<LlmProvider>): LlmProvider {
  return {
    name: 'stub-llm',
    complete: vi.fn(async () => ({
      content: '{"kind":"respond"}',
      model: 'stub',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })),
    ...overrides,
  };
}

export function stubSttProvider(): SttProvider {
  return {
    name: 'stub-stt',
    createStream: vi.fn(() => ({
      write: vi.fn(),
      end: vi.fn(),
      onTranscript: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    })),
  };
}

export function stubTtsProvider(overrides?: Partial<TtsProvider>): TtsProvider {
  return {
    name: 'stub-tts',
    synthesize: vi.fn(async (): Promise<TtsResult> => ({
      audio: Buffer.from('fake-audio'),
      format: 'pcm_16000',
      sampleRate: 16000,
    })),
    ...overrides,
  };
}

export function stubResearchProvider(): ResearchProvider {
  return {
    name: 'stub-research',
    search: vi.fn(async () => [
      { title: 'Test Result', url: 'https://example.com', snippet: 'A test snippet' },
    ]),
    getPageContent: vi.fn(async () => 'page content'),
  };
}

export function stubEmbeddingProvider(): EmbeddingProvider {
  return {
    name: 'stub-embedding',
    embed: vi.fn(async () => ({ embedding: new Array(384).fill(0), model: 'stub-embed' })),
    embedBatch: vi.fn(async () => []),
  };
}

// ── Stub config ──────────────────────────────────────────────────────

export function stubConfig(): AppConfig {
  return {
    env: 'test',
    logLevel: 'warn',
    discord: { token: 'test-token', clientId: 'test-client-id' },
    database: { url: 'postgresql://localhost/test' },
    redis: { url: 'redis://localhost' },
    llm: {
      interpretation: { provider: 'stub-llm', model: 'stub' },
      response: { provider: 'stub-llm', model: 'stub' },
      embedding: { provider: 'stub-embedding', model: 'stub-embed' },
    },
    stt: { provider: 'stub-stt' },
    tts: { provider: 'stub-tts' },
    research: { provider: 'stub-research' },
    persona: { default: 'jarvis' },
    secrets: {},
  };
}

// ── Stub repos ───────────────────────────────────────────────────────

export function stubRepos(): Repos {
  return {
    guilds: {
      findById: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    } as any,
    members: {
      findById: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    } as any,
    users: {
      findById: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: 'u1', username: 'testuser' })),
    } as any,
    guildMemberships: {
      findById: vi.fn(async () => null),
      findByGuildAndUser: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: 'gm-1', guildId: 'g1', userId: 'u1', displayName: null })),
    } as any,
    personas: {
      findByName: vi.fn(async () => ({
        id: 'p1',
        name: 'Jarvis',
        description: 'Default',
        systemPrompt: 'You are Jarvis.',
        responseStyle: {},
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    } as any,
    interactions: {
      create: vi.fn(async (data: any) => ({ id: 'int-1', ...data })),
      update: vi.fn(async () => {}),
      updateResponse: vi.fn(async () => {}),
    } as any,
    memoryRecords: {
      create: vi.fn(async (data: any) => ({ id: 'mr-1', ...data })),
    } as any,
    identityAliases: {
      upsert: vi.fn(async (data: any) => ({ id: 'ia-1', ...data })),
      findByMember: vi.fn(async () => []),
    } as any,
    actionOutcomes: {
      create: vi.fn(async (data: any) => ({ id: 'ao-1', ...data })),
    } as any,
    embeddings: {
      create: vi.fn(async () => ({})),
    } as any,
    operationLog: {
      create: vi.fn(async (data: any) => ({ id: 'ol-1', ...data })),
      finalize: vi.fn(async () => {}),
    } as any,
    memoryRetrieval: {
      searchHybrid: vi.fn(async () => []),
      searchByRecency: vi.fn(async () => []),
    } as any,
  };
}

// ── Stub queues ──────────────────────────────────────────────────────

export function stubQueues() {
  return {
    embeddingGeneration: { add: vi.fn(async () => ({})), close: vi.fn() },
    memoryConsolidation: { add: vi.fn(async () => ({})), close: vi.fn() },
  } as any;
}

// ── Stub provider router ─────────────────────────────────────────────

export function stubProviderRouter(overrides?: {
  llm?: LlmProvider;
  stt?: SttProvider;
  tts?: TtsProvider;
  research?: ResearchProvider;
  embedding?: EmbeddingProvider;
}): ProviderRouter {
  const llm = overrides?.llm ?? stubLlmProvider();
  const stt = overrides?.stt ?? stubSttProvider();
  const tts = overrides?.tts ?? stubTtsProvider();
  const research = overrides?.research ?? stubResearchProvider();
  const embedding = overrides?.embedding ?? stubEmbeddingProvider();

  return {
    getLlm: vi.fn((task: string) => ({ provider: llm, model: 'stub' })),
    getStt: vi.fn(() => stt),
    getTts: vi.fn(() => tts),
    getResearch: vi.fn(() => research),
    getEmbedding: vi.fn(() => ({ provider: embedding, model: 'stub-embed' })),
    listRoutes: vi.fn(() => []),
  } as unknown as ProviderRouter;
}

// ── Stub Discord client ──────────────────────────────────────────────

export function stubDiscordClient() {
  return {
    user: { id: 'bot-user-id', tag: 'Jarvis#0001' },
    guilds: {
      fetch: vi.fn(async (guildId: string) => stubGuild(guildId)),
    },
    channels: {
      fetch: vi.fn(async () => stubTextChannel()),
    },
    on: vi.fn(),
    once: vi.fn(),
    login: vi.fn(),
    destroy: vi.fn(),
  } as any;
}

export function stubGuild(id = 'g1') {
  const botMember = stubGuildMember('bot-user-id', 'Jarvis', {
    permissions: { has: () => true },
    roles: { highest: { position: 100 } },
  });
  return {
    id,
    ownerId: 'owner-id',
    systemChannel: stubTextChannel('general', 'ch-general'),
    channels: {
      cache: {
        get: vi.fn(),
        find: vi.fn(),
        filter: vi.fn(() => ({ size: 0, first: () => undefined, values: () => [] })),
      },
    },
    members: {
      fetch: vi.fn(async (userId?: string) => {
        if (!userId) return new Map();
        return stubGuildMember(userId);
      }),
      fetchMe: vi.fn(async () => botMember),
      cache: {
        filter: vi.fn(() => ({ size: 0, first: () => undefined, values: () => [] })),
      },
    },
    voiceAdapterCreator: {} as any,
  } as any;
}

export function stubGuildMember(id = 'u1', displayName = 'TestUser', overrides?: any) {
  return {
    id,
    displayName,
    nickname: null,
    user: { id, username: displayName.toLowerCase(), globalName: displayName },
    voice: { channel: null, setChannel: vi.fn(), setMute: vi.fn(), setDeaf: vi.fn() },
    roles: { highest: { position: 10 } },
    permissions: { has: () => true },
    setNickname: vi.fn(),
    ...overrides,
  };
}

export function stubTextChannel(name = 'general', id = 'ch-1') {
  return {
    id,
    name,
    type: 0, // GuildText
    send: vi.fn(async () => ({})),
    permissionsFor: vi.fn(() => ({ has: () => true })),
  };
}

export function stubMessage(overrides?: Partial<{
  content: string;
  guildId: string;
  channelId: string;
  authorId: string;
  authorBot: boolean;
  mentionedUserIds: string[];
  repliedUserId: string | null;
}>) {
  const opts = {
    content: 'hello',
    guildId: 'g1',
    channelId: 'ch-1',
    authorId: 'u1',
    authorBot: false,
    mentionedUserIds: [] as string[],
    repliedUserId: null as string | null,
    ...overrides,
  };

  const mentionedUsers = new Map(opts.mentionedUserIds.map((id) => [id, { id }]));

  return {
    id: 'msg-1',
    content: opts.content,
    author: { id: opts.authorId, bot: opts.authorBot, username: 'testuser' },
    guild: { id: opts.guildId },
    channel: { id: opts.channelId },
    member: {
      id: opts.authorId,
      displayName: 'TestUser',
    },
    createdAt: new Date(),
    mentions: {
      users: {
        has: (id: string) => mentionedUsers.has(id),
      },
      repliedUser: opts.repliedUserId ? { id: opts.repliedUserId } : null,
    },
    reply: vi.fn(async () => ({})),
  } as any;
}

// ── Full container assembly ──────────────────────────────────────────

export function stubContainer(overrides?: Partial<Container>): Container {
  const repos = overrides?.repos ?? stubRepos();
  setLatencyRepoAccessor(() => repos.operationLog);
  return {
    config: stubConfig(),
    discord: stubDiscordClient(),
    db: {} as any,
    redis: {} as any,
    repos,
    queues: stubQueues(),
    providers: stubProviderRouter(),
    ...overrides,
  };
}

// ── Interaction context factory ──────────────────────────────────────

export function fakeInteractionContext(overrides?: Partial<InteractionContext>): InteractionContext {
  return {
    correlationId: 'test-corr-id',
    guildId: 'g1',
    guildName: 'Test Guild',
    channelId: 'ch-1',
    surface: 'text',
    requester: { id: 'u1', username: 'testuser', displayName: 'TestUser' },
    requestText: 'What time is it?',
    trigger: 'mention',
    personaId: 'jarvis',
    timestamp: new Date(),
    ...overrides,
  };
}
