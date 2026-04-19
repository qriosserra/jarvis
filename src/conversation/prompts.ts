import type { Persona } from '../db/types.js';

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
- For spoken requests that ask to announce, post, or tell something in text: use "send-text-message" and omit channelRef to target the guild's default general text channel unless the user names a specific channel.`;

/**
 * Build additional context for the interpretation prompt.
 * Includes persona name awareness and language hints.
 */
export function buildInterpretationContext(
  persona: Persona | null,
  language?: string,
): string {
  const parts: string[] = [];

  if (persona) {
    parts.push(
      `The assistant's current persona name is "${persona.name}". ` +
      'The user may address the assistant by this name.',
    );
  }

  if (language) {
    parts.push(`Detected user language: ${language}.`);
  }

  return parts.join(' ');
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

// ── Research-augmented prompt ───────────────────────────────────────

export function buildResearchContext(
  results: Array<{ title: string; url: string; snippet: string; content?: string }>,
): string {
  if (results.length === 0) return '';

  const entries = results
    .slice(0, 5)
    .map((r, i) => {
      const body = r.content ? r.content.slice(0, 800) : r.snippet;
      return `[${i + 1}] ${r.title}\n${r.url}\n${body}`;
    })
    .join('\n\n');

  return (
    'Use the following research results to inform your answer. ' +
    'Cite sources when relevant.\n\n' +
    entries
  );
}
