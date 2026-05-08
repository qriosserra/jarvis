import type { AppConfig } from '../config/env.js';
import type { ProviderRegistry } from './router.js';
import { ProviderRouter } from './router.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('provider-validation');

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that configured provider secrets are present for all routed providers.
 * This runs at startup before concrete adapters are registered to fail fast
 * on missing credentials.
 */
export function validateProviderConfig(config: AppConfig): ValidationResult {
  const errors: string[] = [];
  const routes = ProviderRouter.fromConfig(config);

  // Indirect detection is opt-in and not represented in the route table;
  // when enabled, treat its configured provider as another consumer for the
  // purpose of secret validation.
  const indirectProviderName = config.interaction.indirectDetectionEnabled
    ? config.interaction.indirectDetectionProvider
    : '';

  if (config.interaction.indirectDetectionEnabled && !indirectProviderName) {
    errors.push(
      'LLM_INDIRECT_DETECTION_PROVIDER is required when INDIRECT_DETECTION_ENABLED=true',
    );
  }

  if (config.interaction.indirectDetectionEnabled && !config.interaction.indirectDetectionModel) {
    errors.push(
      'LLM_INDIRECT_DETECTION_MODEL is required when INDIRECT_DETECTION_ENABLED=true',
    );
  }

  if (!config.llm.interpretation.model) {
    errors.push('LLM_INTERPRETATION_MODEL is required');
  }

  if (!config.llm.response.model) {
    errors.push('LLM_RESPONSE_MODEL is required');
  }

  if (!config.llm.embedding.model) {
    errors.push('LLM_EMBEDDING_MODEL is required');
  }

  const needsProvider = (name: string) =>
    routes.some((r) => r.providerName === name) || indirectProviderName === name;

  if (needsProvider('openai') && !config.secrets.openaiApiKey) {
    errors.push('OPENAI_API_KEY is required when using the OpenAI provider');
  }

  if (needsProvider('xai') && !config.secrets.xaiApiKey) {
    errors.push('XAI_API_KEY is required when using the xAI provider');
  }

  if (needsProvider('voyage') && !config.secrets.voyageApiKey) {
    errors.push('VOYAGE_API_KEY is required when using the Voyage provider');
  }

  if (needsProvider('deepgram') && !config.secrets.deepgramApiKey) {
    errors.push('DEEPGRAM_API_KEY is required when using the Deepgram STT provider');
  }

  if (needsProvider('cartesia') && !config.secrets.cartesiaApiKey) {
    errors.push('CARTESIA_API_KEY is required when using the Cartesia TTS provider');
  }

  if (needsProvider('tavily') && !config.secrets.tavilyApiKey) {
    errors.push('TAVILY_API_KEY is required when using the Tavily research provider');
  }

  if (errors.length > 0) {
    for (const err of errors) {
      logger.error(err);
    }
  } else {
    logger.info('Provider configuration validated');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that all configured provider routes can be resolved against the
 * current registry. Call this after registering concrete adapters to ensure
 * every routed task has a matching provider instance.
 */
export function validateProviderRegistry(
  config: AppConfig,
  registry: ProviderRegistry,
): ValidationResult {
  const errors: string[] = [];
  const routes = ProviderRouter.fromConfig(config);

  for (const route of routes) {
    switch (route.task) {
      case 'interpretation':
      case 'response': {
        if (!registry.llm.has(route.providerName)) {
          errors.push(
            `LLM provider "${route.providerName}" is not registered (required for ${route.task})`,
          );
        }
        break;
      }
      case 'transcription': {
        if (!registry.stt.has(route.providerName)) {
          errors.push(
            `STT provider "${route.providerName}" is not registered (required for transcription)`,
          );
        }
        break;
      }
      case 'synthesis': {
        if (!registry.tts.has(route.providerName)) {
          errors.push(
            `TTS provider "${route.providerName}" is not registered (required for synthesis)`,
          );
        }
        break;
      }
      case 'embedding': {
        if (!registry.embedding.has(route.providerName)) {
          errors.push(
            `Embedding provider "${route.providerName}" is not registered (required for embedding)`,
          );
        }
        break;
      }
      case 'research': {
        if (!registry.research.has(route.providerName)) {
          errors.push(
            `Research provider "${route.providerName}" is not registered (required for research)`,
          );
        }
        break;
      }
    }
  }

  if (errors.length > 0) {
    for (const err of errors) {
      logger.error(err);
    }
  } else {
    logger.info('All provider routes resolved successfully');
  }

  return { valid: errors.length === 0, errors };
}
