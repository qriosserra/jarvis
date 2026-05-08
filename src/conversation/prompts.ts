import type { Persona } from '../db/types.js';
import type { IntentKind } from '../interaction/intent.js';
import type { ActionResult } from '../actions/types.js';

// ── Intent interpretation prompt ────────────────────────────────────

export const INTERPRETATION_SYSTEM_PROMPT = `You are an intent classifier for a Discord guild assistant.
Analyze the user's request and return a JSON object describing the intent.

## Intent types and their JSON schemas

General conversation or question:
  {"kind": "respond"}

Need more information before you can act:
  {"kind": "ask-clarification", "question": "your clarifying question"}

User is asking for information that requires web research:
  {"kind": "research-and-respond", "query": "concise search query"}

Join a voice channel:
  {"kind": "join-voice", "channelRef": "channel name or ID"}

Move a member to a different voice channel:
  {"kind": "move-member", "targetRef": "member name", "destinationRef": "channel name"}

Mute or unmute a member in voice:
  {"kind": "mute-member", "targetRef": "member name", "mute": true or false}

Deafen or undeafen a member in voice:
  {"kind": "deafen-member", "targetRef": "member name", "deafen": true or false}

Change a member's server nickname:
  {"kind": "rename-member", "targetRef": "member name", "newName": "new nickname"}

Send a text message in a channel:
  {"kind": "send-text-message", "message": "the message body", "channelRef": "channel name or omit for default"}

## Rules
- Return ONLY the JSON object, no explanation or markdown.
- For mute/deafen, "unmute" means mute=false, "undeafen" means deafen=false.
- Use "research-and-respond" when the answer likely requires current web information.
- Use "respond" for general chat, greetings, opinions, or anything you can answer directly.
- If the request is ambiguous about which action or target, use "ask-clarification".
- The user may speak in any language. Classify intent regardless of language.
- For spoken requests that ask to announce, post, or tell something in text: use "send-text-message" and omit channelRef to target the guild's default general text channel unless the user names a specific channel.
- When the user clearly refers to themselves (e.g. "me", "moi", "myself", "yo", "ich", "je", "mi", etc.) as the target of an action, use the special reference "@self" for targetRef.`;

/**
 * Build additional context for the interpretation prompt.
 * Includes persona name awareness, language hints, requester identity,
 * and recent conversation history so the classifier can resolve indirect
 * self-references (e.g. "mon prénom") and backward references.
 */
export function buildInterpretationContext(
  persona: Persona | null,
  language?: string,
  requesterName?: string | null,
  recentHistory?: Array<{ requestText: string; responseText: string | null }>,
): string {
  const parts: string[] = [];

  if (requesterName) {
    parts.push(
      `The user's known name is "${requesterName}". ` +
      'When they refer to themselves indirectly (e.g. "my name", "mon prénom", "mi nombre"), use this value.',
    );
  }

  if (persona) {
    parts.push(
      `The assistant's current persona name is "${persona.name}". ` +
      'The user may address the assistant by this name.',
    );
  }

  if (language) {
    parts.push(`Detected user language: ${language}.`);
  }

  const headerLine = parts.join(' ');

  if (recentHistory && recentHistory.length > 0) {
    const historyLines = recentHistory
      .slice(-5)
      .map((turn) => {
        const user = `User: ${turn.requestText}`;
        const jarvis = turn.responseText ? `\nJarvis: ${turn.responseText}` : '';
        return user + jarvis;
      })
      .join('\n\n');

    const historyBlock = `## Recent conversation\n${historyLines}`;
    return headerLine ? `${headerLine}\n\n${historyBlock}` : historyBlock;
  }

  return headerLine;
}

// ── Response generation prompt ──────────────────────────────────────

export function buildResponseSystemPrompt(
  persona: Persona | null,
  language?: string,
): string {
  const parts: string[] = [];

  if (persona) {
    parts.push(persona.systemPrompt);
    if (persona.responseStyle && Object.keys(persona.responseStyle).length > 0) {
      parts.push(`Response style: ${JSON.stringify(persona.responseStyle)}`);
    }
  } else {
    parts.push(
      'You are Jarvis, a helpful and knowledgeable Discord guild assistant. ' +
      'You are conversational, concise, and occasionally witty.',
    );
  }

  if (persona) {
    parts.push(
      `Your name is "${persona.name}". Always refer to yourself by this name.`,
    );
  }

  if (language && language !== 'en') {
    parts.push(
      `The user is communicating in "${language}". ` +
      'Respond in the same language when feasible.',
    );
  }

  parts.push(
    'Keep responses concise and well-formatted for Discord. ' +
    'Use markdown sparingly — bold for emphasis, code blocks for code.',
  );

  return parts.join('\n\n');
}

// ── Action outcome prompt ───────────────────────────────────────────

/**
 * Build a system-level context block describing what deterministic
 * action just ran and how it ended. The response LLM uses this as
 * factual grounding while phrasing the user-facing reply in the active
 * persona's voice.
 *
 * Mirrors `buildResearchContext` — injects facts without replacing the
 * original user request.
 */
export function buildActionOutcomeContext(
  intentKind: IntentKind,
  result: ActionResult,
): string {
  const status = result.success ? 'succeeded' : 'failed';
  return (
    'You just attempted a deterministic guild action on the user\'s behalf. ' +
    'Acknowledge the outcome to the user in your own persona voice. ' +
    'Stay faithful to the facts below — do not invent details, and if it failed, do not claim it succeeded.\n\n' +
    `Action: ${intentKind}\n` +
    `Status: ${status}\n` +
    `Factual outcome action: ${result.message}`
  );
}

// ── Research-augmented prompt ───────────────────────────────────────

export function buildResearchContext(
  results: Array<{ title: string; url: string; snippet: string; content?: string }>,
  opts?: { citations?: boolean },
): string {
  if (results.length === 0) return '';

  const entries = results
    .slice(0, 5)
    .map((r, i) => {
      const body = r.content ? r.content.slice(0, 800) : r.snippet;
      return `[${i + 1}] ${r.title}\n${r.url}\n${body}`;
    })
    .join('\n\n');

  const citationInstruction = opts?.citations
    ? 'At the end of your response, list the sources you used under a "Sources:" heading, one per line as `- [title](url)`.'
    : 'Cite sources when relevant.';

  return (
    'Use the following research results to inform your answer. ' +
    citationInstruction + '\n\n' +
    entries
  );
}
