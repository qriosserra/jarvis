import type { AppConfig } from '../config/env.js';
import type {
  LlmProvider,
  SttProvider,
  TtsProvider,
  ResearchProvider,
  EmbeddingProvider,
} from './types.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('provider-router');

// ── AI task identifiers ───────────────────────────────────────────────

export type AiTask =
  | 'interpretation'
  | 'response'
  | 'transcription'
  | 'synthesis'
  | 'embedding'
  | 'research';

// ── Route definition ──────────────────────────────────────────────────

export interface ProviderRoute {
  task: AiTask;
  providerName: string;
  model?: string;
}

// ── Provider registry ─────────────────────────────────────────────────

export interface ProviderRegistry {
  llm: Map<string, LlmProvider>;
  stt: Map<string, SttProvider>;
  tts: Map<string, TtsProvider>;
  research: Map<string, ResearchProvider>;
  embedding: Map<string, EmbeddingProvider>;
}

// ── Router ────────────────────────────────────────────────────────────

export class ProviderRouter {
  private routes: Map<AiTask, ProviderRoute>;
  private registry: ProviderRegistry;

  constructor(registry: ProviderRegistry, routes: ProviderRoute[]) {
    this.registry = registry;
    this.routes = new Map(routes.map((r) => [r.task, r]));
  }

  /** Build routes from AppConfig. */
  static fromConfig(config: AppConfig): ProviderRoute[] {
    return [
      {
        task: 'interpretation',
        providerName: config.llm.interpretation.provider,
        model: config.llm.interpretation.model,
      },
      {
        task: 'response',
        providerName: config.llm.response.provider,
        model: config.llm.response.model,
      },
      {
        task: 'transcription',
        providerName: config.stt.provider,
      },
      {
        task: 'synthesis',
        providerName: config.tts.provider,
      },
      {
        task: 'embedding',
        providerName: config.llm.embedding.provider,
        model: config.llm.embedding.model,
      },
      {
        task: 'research',
        providerName: config.research.provider,
      },
    ];
  }

  /** Resolve the LLM provider for a given task (interpretation or response). */
  getLlm(task: 'interpretation' | 'response'): { provider: LlmProvider; model?: string } {
    const route = this.getRoute(task);
    const provider = this.registry.llm.get(route.providerName);
    if (!provider) {
      throw new Error(`LLM provider "${route.providerName}" not registered for task "${task}"`);
    }
    return { provider, model: route.model };
  }

  /** Resolve the STT provider. */
  getStt(): SttProvider {
    const route = this.getRoute('transcription');
    const provider = this.registry.stt.get(route.providerName);
    if (!provider) {
      throw new Error(`STT provider "${route.providerName}" not registered`);
    }
    return provider;
  }

  /** Resolve the TTS provider. */
  getTts(): TtsProvider {
    const route = this.getRoute('synthesis');
    const provider = this.registry.tts.get(route.providerName);
    if (!provider) {
      throw new Error(`TTS provider "${route.providerName}" not registered`);
    }
    return provider;
  }

  /** Resolve the research provider. */
  getResearch(): ResearchProvider {
    const route = this.getRoute('research');
    const provider = this.registry.research.get(route.providerName);
    if (!provider) {
      throw new Error(`Research provider "${route.providerName}" not registered`);
    }
    return provider;
  }

  /** Resolve the embedding provider. */
  getEmbedding(): { provider: EmbeddingProvider; model?: string } {
    const route = this.getRoute('embedding');
    const provider = this.registry.embedding.get(route.providerName);
    if (!provider) {
      throw new Error(`Embedding provider "${route.providerName}" not registered`);
    }
    return { provider, model: route.model };
  }

  /** List all configured routes (useful for logging at startup). */
  listRoutes(): ProviderRoute[] {
    return Array.from(this.routes.values());
  }

  private getRoute(task: AiTask): ProviderRoute {
    const route = this.routes.get(task);
    if (!route) {
      throw new Error(`No provider route configured for task "${task}"`);
    }
    return route;
  }
}

// ── Factory ───────────────────────────────────────────────────────────

export function createProviderRouter(
  config: AppConfig,
  registry: ProviderRegistry,
): ProviderRouter {
  const routes = ProviderRouter.fromConfig(config);
  const router = new ProviderRouter(registry, routes);

  for (const route of routes) {
    logger.info(
      { task: route.task, provider: route.providerName, model: route.model },
      'Provider route configured',
    );
  }

  return router;
}
