import { describe, it, expect } from 'vitest';
import { isAddressedToJarvis, stripBotNamePrefix } from '../speech-detect.js';

describe('isAddressedToJarvis', () => {
  it('detects "Jarvis, do something"', () => {
    expect(isAddressedToJarvis('Jarvis, do something')).toBe(true);
  });

  it('detects "jarvis" case-insensitively', () => {
    expect(isAddressedToJarvis('JARVIS please help')).toBe(true);
  });

  it('detects Jarvis in the middle of a sentence', () => {
    expect(isAddressedToJarvis('Hey Jarvis what time is it')).toBe(true);
  });

  it('detects Jarvis at the end', () => {
    expect(isAddressedToJarvis('can you help me Jarvis')).toBe(true);
  });

  it('returns false for unrelated speech', () => {
    expect(isAddressedToJarvis('hello everyone how are you')).toBe(false);
  });

  it('returns false for partial name matches without word boundaries', () => {
    expect(isAddressedToJarvis('jarvislike behavior')).toBe(true); // starts with jarvis
  });

  it('supports custom bot names', () => {
    expect(isAddressedToJarvis('Alfred, do the thing', ['alfred'])).toBe(true);
    expect(isAddressedToJarvis('Jarvis, do the thing', ['alfred'])).toBe(false);
  });
});

describe('stripBotNamePrefix', () => {
  it('strips "Jarvis, " prefix', () => {
    expect(stripBotNamePrefix('Jarvis, what time is it')).toBe('what time is it');
  });

  it('strips "Hey jarvis " prefix', () => {
    expect(stripBotNamePrefix('Hey jarvis can you help')).toBe('can you help');
  });

  it('strips "ok jarvis" prefix', () => {
    expect(stripBotNamePrefix('ok jarvis play music')).toBe('play music');
  });

  it('returns full text when Jarvis is not a prefix', () => {
    expect(stripBotNamePrefix('can you help me Jarvis')).toBe('can you help me Jarvis');
  });

  it('trims resulting text', () => {
    expect(stripBotNamePrefix('Jarvis   ')).toBe('');
  });
});
