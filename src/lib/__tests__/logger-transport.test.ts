import { describe, it, expect } from 'vitest';
import {
  expandPrettyOutput,
  fixJsonStringValues,
  fixMultilineStringAlignment,
} from '../logger-transport.js';

// ── fixJsonStringValues ─────────────────────────────────────────────

describe('fixJsonStringValues', () => {
  it('unwraps a JSON array string value and re-indents inner lines', () => {
    const input = [
      '    response: "[',
      '  {',
      "    'category': 'fact',",
      '  }',
      ']"',
    ].join('\n');

    const expected = [
      '    response: [',
      '      {',
      "        'category': 'fact',",
      '      }',
      '    ]',
    ].join('\n');

    expect(fixJsonStringValues(input)).toBe(expected);
  });

  it('unwraps a JSON object string value', () => {
    const input = [
      '    data: "{',
      "  'key': 'value'",
      '}"',
    ].join('\n');

    const expected = [
      '    data: {',
      "      'key': 'value'",
      '    }',
    ].join('\n');

    expect(fixJsonStringValues(input)).toBe(expected);
  });

  it('does not double-indent the next field when JSON value is on one line', () => {
    const input = [
      '    response: "{\'kind\': \'respond\'}"',
      '    correlationId: abc-123',
    ].join('\n');

    expect(fixJsonStringValues(input)).toBe(input);
  });

  it('does not double-indent the next field when JSON value with trailing comma is on one line', () => {
    const input = [
      '    response: "{\'kind\': \'respond\'}",',
      '    correlationId: abc-123',
    ].join('\n');

    expect(fixJsonStringValues(input)).toBe(input);
  });

  it('leaves lines without JSON string fields untouched', () => {
    const input = [
      '  level: INFO',
      '  msg: hello world',
    ].join('\n');

    expect(fixJsonStringValues(input)).toBe(input);
  });

  it('handles nested brackets inside the JSON string value', () => {
    const input = [
      '    items: "[',
      '  [',
      '    1,',
      '    2',
      '  ]',
      ']"',
    ].join('\n');

    const expected = [
      '    items: [',
      '      [',
      '        1,',
      '        2',
      '      ]',
      '    ]',
    ].join('\n');

    expect(fixJsonStringValues(input)).toBe(expected);
  });

  it('handles content after the opening bracket on the same line', () => {
    const input = [
      '    arr: "[1,',
      '  2',
      ']"',
    ].join('\n');

    const expected = [
      '    arr: [1,',
      '      2',
      '    ]',
    ].join('\n');

    expect(fixJsonStringValues(input)).toBe(expected);
  });
});

// ── fixMultilineStringAlignment ─────────────────────────────────────

describe('fixMultilineStringAlignment', () => {
  it('aligns continuation lines with the opening quote column', () => {
    const input = [
      '        "content": "You are a memory extraction system.',
      'Given a completed interaction...',
      'please extract facts."',
    ].join('\n');

    //                  ^-- 20 chars to and including the opening "
    const indent = ' '.repeat('        "content": "'.length);
    const expected = [
      '        "content": "You are a memory extraction system.',
      indent + 'Given a completed interaction...',
      indent + 'please extract facts."',
    ].join('\n');

    expect(fixMultilineStringAlignment(input)).toBe(expected);
  });

  it('does not modify single-line string values', () => {
    const input = '        "role": "assistant"';
    expect(fixMultilineStringAlignment(input)).toBe(input);
  });

  it('does not modify lines without the quoted-key pattern', () => {
    const input = [
      '    response: [',
      '      {',
      '      }',
      '    ]',
    ].join('\n');

    expect(fixMultilineStringAlignment(input)).toBe(input);
  });

  it('handles multiple consecutive multi-line strings', () => {
    const prefixA = '    "a": "';
    const prefixB = '    "b": "';
    const indentA = ' '.repeat(prefixA.length);
    const indentB = ' '.repeat(prefixB.length);

    const input = [
      prefixA + 'line1',
      'line2"',
      prefixB + 'line3',
      'line4"',
    ].join('\n');

    const expected = [
      prefixA + 'line1',
      indentA + 'line2"',
      prefixB + 'line3',
      indentB + 'line4"',
    ].join('\n');

    expect(fixMultilineStringAlignment(input)).toBe(expected);
  });

  it('removes blank lines within a multi-line string value', () => {
    const prefix = '        "content": "';
    const indent = ' '.repeat(prefix.length);

    const input = [
      prefix + 'First line.',
      '',
      'Second line.',
      '',
      'Third line."',
    ].join('\n');

    const expected = [
      prefix + 'First line.',
      indent + 'Second line.',
      indent + 'Third line."',
    ].join('\n');

    expect(fixMultilineStringAlignment(input)).toBe(expected);
  });

  it('does not treat a single-line property with a trailing comma as multi-line', () => {
    const input = [
      '        "role": "system",',
      '        "content": "hello"',
    ].join('\n');

    expect(fixMultilineStringAlignment(input)).toBe(input);
  });

  it('aligns a multi-line content value that follows a trailing-comma single-line property', () => {
    const input = [
      '        "role": "system",',
      '        "content": "First line.',
      'Second line.',
      'Third line."',
    ].join('\n');

    const indent = ' '.repeat('        "content": "'.length);
    const expected = [
      '        "role": "system",',
      '        "content": "First line.',
      indent + 'Second line.',
      indent + 'Third line."',
    ].join('\n');

    expect(fixMultilineStringAlignment(input)).toBe(expected);
  });
});

// ── expandPrettyOutput (combined) ───────────────────────────────────

describe('expandPrettyOutput', () => {
  it('expands escaped newlines and escaped double-quotes', () => {
    const input = 'hello\\nworld \\"quoted\\"';
    expect(expandPrettyOutput(input)).toBe("hello\nworld 'quoted'");
  });

  it('applies JSON string unwrapping after escape expansion', () => {
    // Simulates what pino-pretty emits before expansion:
    // escaped newlines inside a JSON-string field value
    const input = '    response: "[\\n  {\\n    \\\"category\\\": \\\"fact\\\"\\n  }\\n]"';

    const expected = [
      '    response: [',
      '      {',
      "        'category': 'fact'",
      '      }',
      '    ]',
    ].join('\n');

    expect(expandPrettyOutput(input)).toBe(expected);
  });

  it('applies multi-line string alignment after escape expansion', () => {
    const input = '        "content": "First line.\\nSecond line.\\nThird line."';

    const indent = ' '.repeat('        "content": "'.length);
    const expected = [
      '        "content": "First line.',
      indent + 'Second line.',
      indent + 'Third line."',
    ].join('\n');

    expect(expandPrettyOutput(input)).toBe(expected);
  });

  it('returns plain text unchanged', () => {
    const input = 'simple log line without escapes';
    expect(expandPrettyOutput(input)).toBe(input);
  });
});
