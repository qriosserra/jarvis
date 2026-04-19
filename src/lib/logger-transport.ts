import { Writable } from 'node:stream';
import { closeSync, openSync, writeSync } from 'node:fs';
import pinoPretty from 'pino-pretty';

/**
 * Custom pino transport that expands escaped sequences in pino-pretty's
 * formatted text output before writing to the destination.
 *
 * pino-pretty renders nested object/array values using JSON.stringify
 * semantics, which re-escapes real newlines to `\n` and real double-quotes
 * to `\"`.  This transport intercepts pino-pretty's already-formatted text
 * and expands those sequences into human-readable form.
 */
export default function createPrettyStringTransport(
  options: Record<string, unknown>,
) {
  const destination = new ExpandingWritable(options);
  return pinoPretty({ ...options, destination });
}

/**
 * A Writable stream passed as pino-pretty's `destination`.  pino-pretty
 * checks `typeof opts.destination.write === 'function'` and uses the object
 * directly, so any Writable satisfies the contract.
 *
 * Each chunk received here is a fully-formatted log line produced by
 * pino-pretty.  We expand literal escape sequences before writing to the
 * real file descriptor or path.
 */
class ExpandingWritable extends Writable {
  private readonly fd: number;
  private readonly ownsFd: boolean;

  constructor(options: Record<string, unknown>) {
    super({ autoDestroy: true, objectMode: true });
    const dest = options.destination;
    if (typeof dest === 'string') {
      this.fd = openSync(dest, 'a');
      this.ownsFd = true;
    } else {
      this.fd = (dest as number | undefined) ?? 1;
      this.ownsFd = false;
    }
  }

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (err?: Error | null) => void,
  ): void {
    const text = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
    writeSync(this.fd, expandPrettyOutput(text));
    callback();
  }

  override _destroy(
    err: Error | null,
    callback: (err?: Error | null) => void,
  ): void {
    if (this.ownsFd) {
      try {
        closeSync(this.fd);
      } catch {
        // Ignore errors on close
      }
    }
    callback(err);
  }
}

/**
 * Expand literal escape sequences in pino-pretty's formatted text output:
 *   - `\n` (backslash + n)  → real line break
 *   - `\"` (backslash + ") → single-quote
 *
 * These appear because pino-pretty JSON.stringify-es nested object values
 * when rendering them, re-escaping any real newlines and double-quotes that
 * were present in the original logged data.
 *
 * After expansion, two post-processing passes fix indentation:
 *   1. `fixJsonStringValues` — unwraps JSON array/object string values so
 *      they render without outer quotes and with correct field-relative indent.
 *   2. `fixMultilineStringAlignment` — aligns continuation lines of multi-line
 *      string values with the first character after the opening quote.
 */
export function expandPrettyOutput(text: string): string {
  const expanded = text.replace(/\\n/g, '\n').replace(/\\"/g, "'");
  return fixMultilineStringAlignment(fixJsonStringValues(expanded));
}

/**
 * Unwrap fields whose string value is a JSON array or object.
 *
 * pino-pretty renders such fields as:
 *     response: "[
 *   {
 *     'category': 'fact',
 *   }
 * ]"
 *
 * This function strips the outer quotes and re-indents the inner lines
 * relative to the field, producing:
 *     response: [
 *       {
 *         'category': 'fact',
 *       }
 *     ]
 */
export function fixJsonStringValues(text: string): string {
  const FIELD_OPEN_PATTERN = /^(\s+)(\w+): "(\[|\{)(.*)$/;
  const lines = text.split('\n');
  const result: string[] = [];
  let fieldIndent = '';
  let closingBracket = '';
  let insideJsonString = false;

  for (const line of lines) {
    if (insideJsonString) {
      const closingPattern = new RegExp(`^\\s*(\\${closingBracket})"\\s*$`);
      const closeMatch = line.match(closingPattern);
      if (closeMatch) {
        result.push(fieldIndent + closingBracket);
        insideJsonString = false;
      } else {
        result.push(fieldIndent + line);
      }
    } else {
      const match = line.match(FIELD_OPEN_PATTERN);
      if (match) {
        const [, indent, fieldName, bracket, rest] = match;
        const expectedClosing = bracket === '[' ? ']' : '}';
        const alreadyClosed =
          rest.endsWith(expectedClosing + '"') ||
          rest.endsWith(expectedClosing + '",');
        if (alreadyClosed) {
          result.push(line);
        } else {
          fieldIndent = indent;
          closingBracket = expectedClosing;
          insideJsonString = true;
          result.push(indent + fieldName + ': ' + bracket + rest);
        }
      } else {
        result.push(line);
      }
    }
  }

  return result.join('\n');
}

/**
 * Align continuation lines of multi-line string values.
 *
 * Inside nested JSON objects rendered by pino-pretty, a quoted key with a
 * multi-line string value looks like:
 *         "content": "You are a memory extraction system.\n
 * Given a completed interaction...
 *
 * After \n expansion the continuation lands at column 0.  This function
 * detects the opening pattern and prepends whitespace equal to the length
 * of everything up to (and including) the opening quote, so continuation
 * lines align with the first content character.
 */
export function fixMultilineStringAlignment(text: string): string {
  const KEY_VALUE_OPEN_PATTERN = /^(\s*"[^"]*":\s*")/;
  const lines = text.split('\n');
  const result: string[] = [];
  let alignIndent = '';
  let insideMultilineString = false;

  for (const line of lines) {
    if (insideMultilineString) {
      if (line.trim() === '') {
        continue;
      }
      result.push(alignIndent + line);
      if (/",?$/.test(line)) {
        insideMultilineString = false;
      }
    } else {
      result.push(line);
      const match = line.match(KEY_VALUE_OPEN_PATTERN);
      if (match) {
        const rest = line.slice(match[1].length);
        if (!/",?$/.test(rest)) {
          alignIndent = ' '.repeat(match[1].length);
          insideMultilineString = true;
        }
      }
    }
  }

  return result.join('\n');
}
