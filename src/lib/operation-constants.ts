/**
 * Shared constants for `trackOperation` call sites.
 *
 * Centralises every `operationName`, `operationType`, and repeated
 * metadata string so they are defined once and reused consistently.
 */

// ── Operation names ───────────────────────────────────────────────────

export const OperationName = {
  // Root — end-to-end interaction span
  INTERACTION: 'interaction',

  // Pipeline — orchestration steps
  GUILD_BOOTSTRAP: 'guild_bootstrap',
  MEMBERSHIP_BOOTSTRAP: 'membership_bootstrap',
  PERSONA_RESOLUTION: 'persona_resolution',
  INTENT_INTERPRETATION: 'intent_interpretation',
  DETERMINISTIC_ACTION: 'deterministic_action',
  CONVERSATIONAL_RESPONSE: 'conversational_response',

  // LLM — language-model calls
  LLM_INTERPRETATION: 'llm_interpretation',
  LLM_RESPONSE: 'llm_response',
  LLM_RESEARCH_RESPONSE: 'llm_research_response',
  LLM_MEMORY_EXTRACTION: 'llm_memory_extraction',

  // Research — external search
  RESEARCH_SEARCH: 'research_search',

  // Embedding — vector operations
  EMBEDDING_QUERY: 'embedding_query',
  EMBEDDING_DOCUMENT: 'embedding_document',

  // TTS — text-to-speech synthesis
  TTS_SYNTHESIS: 'tts_synthesis',

  // Memory — background maintenance
  MEMORY_DELETE_EXPIRED: 'memory_delete_expired',

  /**
   * Prefix for dynamic per-action operation names.
   * Usage: `${OperationName.ACTION_PREFIX}${intent.kind}`
   */
  ACTION_PREFIX: 'action_',
} as const;

// ── Operation types ───────────────────────────────────────────────────

export const OperationType = {
  PIPELINE: 'pipeline',
  LLM: 'llm',
  EMBEDDING: 'embedding',
  TTS: 'tts',
  RESEARCH: 'research',
  DB: 'db',
} as const;

// ── Metadata string values ────────────────────────────────────────────

export const OperationMetadata = {
  Task: {
    INTERPRETATION: 'interpretation',
    RESPONSE: 'response',
    MEMORY_EXTRACTION: 'memory_extraction',
  },
  InputType: {
    QUERY: 'query',
    DOCUMENT: 'document',
  },
  Queue: {
    MEMORY_CONSOLIDATION: 'memory-consolidation',
    EMBEDDING_GENERATION: 'embedding-generation',
  },
} as const;
