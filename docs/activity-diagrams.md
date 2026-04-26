# Activity Diagrams

Visual representation of the operations that run during a Jarvis interaction.
Each diagram is written in [PlantUML](https://plantuml.com/activity-diagram-beta) activity-diagram syntax and can be rendered with the VS Code PlantUML extension, the [online server](https://www.plantuml.com/plantuml/uml), or any PlantUML-compatible tool.

## Table of Contents

1. [Request Entry Points](#1-request-entry-points)
2. [Orchestrator Pipeline](#2-orchestrator-pipeline)
3. [Conversational Response Path](#3-conversational-response-path)
4. [Deterministic Action Path](#4-deterministic-action-path)
5. [Background Memory Pipeline](#5-background-memory-pipeline)

---

## 1. Request Entry Points

Covers the two surfaces (text message and voice utterance) that produce an `InteractionContext` and hand off to the orchestrator.

**Key files:** `src/discord/events.ts`, `src/voice/speech-detect.ts`

```plantuml
@startuml request-entry
title Jarvis — Request Entry Points

start

split
  :**[Text] Discord messageCreate**;
  if (author.bot\nor no guild?) then (yes)
    stop
  endif
  :detectTextRequest(message, botUserId);
  if (isForJarvis?) then (no)
    stop
  endif
  :extractRequestText\n(strip @mention);
  :Build InteractionContext\n(surface = "text"\ntrigger = mention | reply | indirect);

split again
  :**[Voice] SpeakerUtterance received**;
  :isAddressedToJarvis(transcript);
  if (addressed?) then (no)
    stop
  endif
  :attributeSpeaker(userId, guildId);
  if (member found?) then (no)
    :Decline — unattributable speaker;
    stop
  endif
  :stripBotNamePrefix(transcript);
  :Build InteractionContext\n(surface = "voice"\ntrigger = "voice-addressed");

end split

:Assign correlationId\n(runWithCorrelationId);

:handleInteraction(ctx) ▶ Diagram 2;

stop
@enduml
```

---

## 2. Orchestrator Pipeline

The core `handleInteraction` flow: bootstraps persistent state, creates the early interaction row, classifies intent via LLM, then routes to one of the two execution paths.

**Key files:** `src/interaction/orchestrator.ts`, `src/conversation/interpret.ts`

```plantuml
@startuml orchestrator
title Jarvis — Orchestrator Pipeline

start

:handleInteraction(ctx);

group "Bootstrap (sequential via runTrackedPipeline)" {
  :bootstrapGuild\n→ upsert guild row;
  :bootstrapMembership\n→ upsert user + guild_membership\n   set ctx.membershipId;
  :resolvePersona\n→ resolve persona UUID\n   set ctx.resolvedPersonaDbId;
}

:createEarlyInteraction\n→ insert interaction row (request metadata)\n   set ctx.interactionId;

note right
  interactionId is set here so that all
  downstream latency records and action
  outcomes can reference it via FK.
end note

:ingestRequesterNames (fire-and-forget);

group "Intent Interpretation" {
  :Load persona (for name-aware classification);
  :LLM classify intent\n(temp = 0.1 · max_tokens = 256);
  if (LLM call or parse fails?) then (yes)
    :Fallback → RespondIntent;
  else (no)
    :parseIntentJson → IntentOutcome;
    if (valid intent kind?) then (no)
      :Fallback → RespondIntent;
    endif
  endif
  :Record intentClassificationCounter metric;
}

if (isDeterministicIntent?) then (yes)
  :executeDeterministicAction(ctx, intent) ▶ Diagram 4;
else (no)
  :executeConversationalResponse(ctx, intent) ▶ Diagram 3;
endif

:Enqueue memory consolidation job\n{guildId, memberId} (fire-and-forget);

:Record interactionDuration metric;

stop
@enduml
```

---

## 3. Conversational Response Path

Handles the `respond`, `ask-clarification`, and `research-and-respond` intent kinds. Retrieves memory context, generates a response, delivers it surface-appropriately, then persists memories asynchronously.

**Key files:** `src/conversation/respond.ts`, `src/memory/retrieve.ts`, `src/memory/persist.ts`

```plantuml
@startuml conversational-response
title Jarvis — Conversational Response Path

start

:executeConversationalResponse(ctx, intent);

:loadPersona(personaId);

group "Memory Context Retrieval" {
  :selectBestName\n→ resolve requester preferred name;
  group "retrieveMemories" {
    :Embed request text\n(embeddingProvider.embed, inputType="query");
    if (embedding provider available?) then (yes)
      :searchHybrid\n(vector weight 60% · recency decay 30d\n limit = 10);
      if (results found?) then (no)
        :searchByRecency (fallback);
      endif
    else (no)
      :searchByRecency (fallback);
    endif
  }
  :formatContext → memoryContext string\n(requester name + ranked memories);
}

if (intent.kind == ask-clarification?) then (yes)
  :Return intent.question as response\n(no LLM call);
elseif (intent.kind == research-and-respond?) then (yes)
  :researchProvider.search(query, maxResults = 5);
  :buildResearchContext(results);
  :LLM synthesise with research context\n(temp = 0.5 · max_tokens = 1536);
else (respond)
  :LLM generate direct response\n(temp = 0.7 · max_tokens = 1024);
endif

if (surface == "voice"?) then (yes)
  :getActiveConnection(guildId);
  if (active voice connection?) then (no)
    :Fallback → deliverTextReply;
  else (yes)
    :speakWithAcknowledgement;
    note right
      Acknowledgement tone fires if
      response generation exceeds ackTimeoutMs.
    end note
    :TTS synthesise audio;
    :Play audio in active voice channel;
  endif
else (no)
  :deliverTextReply\n(sourceMessage.reply → channel.send fallback);
endif

:Backfill interaction.response_text (DB);

group "Memory Persistence (non-blocking)" {
  :extractMemories via LLM\n(temp = 0.2 · max_tokens = 512);
  :storeMemories → memoryRecord rows (DB);
  :Enqueue embeddingGeneration job per memory record;
}

stop
@enduml
```

---

## 4. Deterministic Action Path

Handles guild-mutating actions (voice join, member move / mute / deafen / rename, send text message). Runs a memory safety gate before execution, then delivers the result and persists the outcome.

**Key files:** `src/actions/executor.ts`, `src/actions/handlers.ts`, `src/memory/safety.ts`

```plantuml
@startuml deterministic-action
title Jarvis — Deterministic Action Path

start

:executeDeterministicAction(ctx, intent);

:executeAction(ctx, intent);

if (simulateActions?) then (yes)
  :simulateAction(intent)\n→ descriptive "would-do" result;
else (no)
  :discord.guilds.fetch(guildId);
  if (guild resolved?) then (no)
    :result → failure: "Could not resolve server";
  else (yes)
    :guild.members.fetchMe();
    if (botMember resolved?) then (no)
      :result → failure: "Could not resolve bot membership";
    else (yes)
      :checkMemorySafety(ctx, intent);
      if (safe?) then (no)
        :result → safety refusal\n(safetyCheck.reason);
      else (yes)
        switch (intent.kind)
        case (JoinVoice)
          :handleJoinVoice;
        case (SendTextMessage)
          :handleSendTextMessage;
        case (MoveMember)
          :handleMoveMember;
        case (MuteMember)
          :handleMuteMember;
        case (DeafenMember)
          :handleDeafenMember;
        case (RenameMember)
          :handleRenameMember;
        endswitch
        :result = ActionResult;
      endif
    endif
  endif
endif

:sendReply(ctx, result.message)\n(sourceMessage.reply → channel.send fallback);

:Backfill interaction.response_text (DB);
:Create action_outcome row (DB);
:Record actionOutcomeCounter metric;

:Enqueue action outcome memory (fire-and-forget);

stop
@enduml
```

---

## 5. Background Memory Pipeline

Shows the four independent async pipelines that run outside the latency-critical path. Memory extraction and action outcome persistence enqueue jobs consumed by the embedding worker; the consolidation worker runs on a separate schedule.

**Key files:** `src/memory/extract.ts`, `src/memory/persist.ts`, `src/queue/workers/embedding-generation.ts`, `src/queue/workers/memory-consolidation.ts`

```plantuml
@startuml background-memory
title Jarvis — Background Memory Pipeline

split
  :**Memory Extraction**\n(triggered after conversational response);
  :extractMemories(ctx, responseText, intentKind);
  :LLM extract structured memories\n(JSON array · temp = 0.2 · max_tokens = 512);
  :parseExtractedMemories → ExtractedMemory[]\n(max 3 items · categories: summary / fact / preference / action_outcome);
  :storeMemories → memoryRecord rows (DB);
  :Enqueue embeddingGeneration job\nper memoryRecord;
  stop

split again
  :**Action Outcome Memory**\n(triggered after deterministic action);
  :Build content string\n"Action <type> succeeded/failed: <message>";
  :memoryRecords.create (DB)\n(category = "action_outcome"\nconfidence = 1.0);
  :Enqueue embeddingGeneration job;
  stop

split again
  :**Embedding Generation Worker**\n(BullMQ · Redis-backed);
  :Dequeue job {memoryRecordId, content, guildId};
  :embeddingProvider.embed(content, inputType = "document");
  :Store embedding vector in embeddings table (DB);
  stop

split again
  :**Memory Consolidation Worker**\n(BullMQ · Redis-backed);
  :Dequeue job {guildId, memberId};
  :Consolidate and merge memory records;
  stop

end split

stop
@enduml
```
