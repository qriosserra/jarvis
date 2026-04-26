import { z } from 'zod';

const envSchema = z.object({
  // Discord (optional — not needed for CLI/headless mode)
  DISCORD_TOKEN: z.string().min(1).optional(),
  DISCORD_CLIENT_ID: z.string().min(1).optional(),

  // PostgreSQL
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .default('postgresql://jarvis:jarvis@localhost:5432/jarvis'),

  // Redis
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // LLM provider routing
  LLM_INTERPRETATION_PROVIDER: z.string().default('xai'),
  LLM_INTERPRETATION_MODEL: z.string().default('grok-3-mini'),
  LLM_RESPONSE_PROVIDER: z.string().default('xai'),
  LLM_RESPONSE_MODEL: z.string().default('grok-3-mini'),
  LLM_EMBEDDING_PROVIDER: z.string().default('voyage'),
  LLM_EMBEDDING_MODEL: z.string().default('voyage-4-lite'),
  OPENAI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),

  // STT
  STT_PROVIDER: z.string().default('deepgram'),
  DEEPGRAM_API_KEY: z.string().optional(),

  // TTS
  TTS_PROVIDER: z.string().default('cartesia'),
  CARTESIA_API_KEY: z.string().optional(),

  // Research
  RESEARCH_PROVIDER: z.string().default('tavily'),
  TAVILY_API_KEY: z.string().optional(),

  // Persona
  DEFAULT_PERSONA: z.string().default('jarvis'),

  // Application
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  LOG_CONSOLE_ENABLED: z.coerce.boolean().default(true),
  LOG_FILE_ENABLED: z.coerce.boolean().default(false),
  LOG_FILE_PATH: z.string().default('./logs/app.log'),
  LOG_DB_ENABLED: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  logLevel: Env['LOG_LEVEL'];

  log: {
    consoleEnabled: boolean;
    fileEnabled: boolean;
    filePath: string;
    dbEnabled: boolean;
  };

  discord: {
    token?: string;
    clientId?: string;
  };

  database: {
    url: string;
  };

  redis: {
    url: string;
  };

  llm: {
    interpretation: { provider: string; model: string };
    response: { provider: string; model: string };
    embedding: { provider: string; model: string };
  };

  stt: {
    provider: string;
  };

  tts: {
    provider: string;
  };

  research: {
    provider: string;
  };

  persona: {
    default: string;
  };

  secrets: {
    openaiApiKey?: string;
    xaiApiKey?: string;
    voyageApiKey?: string;
    deepgramApiKey?: string;
    cartesiaApiKey?: string;
    tavilyApiKey?: string;
  };
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  const env = parsed.data;

  return {
    env: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,

    log: {
      consoleEnabled: env.LOG_CONSOLE_ENABLED,
      fileEnabled: env.LOG_FILE_ENABLED,
      filePath: env.LOG_FILE_PATH,
      dbEnabled: env.LOG_DB_ENABLED,
    },

    discord: {
      token: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
    },

    database: {
      url: env.DATABASE_URL,
    },

    redis: {
      url: env.REDIS_URL,
    },

    llm: {
      interpretation: {
        provider: env.LLM_INTERPRETATION_PROVIDER,
        model: env.LLM_INTERPRETATION_MODEL,
      },
      response: {
        provider: env.LLM_RESPONSE_PROVIDER,
        model: env.LLM_RESPONSE_MODEL,
      },
      embedding: {
        provider: env.LLM_EMBEDDING_PROVIDER,
        model: env.LLM_EMBEDDING_MODEL,
      },
    },

    stt: {
      provider: env.STT_PROVIDER,
    },

    tts: {
      provider: env.TTS_PROVIDER,
    },

    research: {
      provider: env.RESEARCH_PROVIDER,
    },

    persona: {
      default: env.DEFAULT_PERSONA,
    },

    secrets: {
      openaiApiKey: env.OPENAI_API_KEY,
      xaiApiKey: env.XAI_API_KEY,
      voyageApiKey: env.VOYAGE_API_KEY,
      deepgramApiKey: env.DEEPGRAM_API_KEY,
      cartesiaApiKey: env.CARTESIA_API_KEY,
      tavilyApiKey: env.TAVILY_API_KEY,
    },
  };
}
