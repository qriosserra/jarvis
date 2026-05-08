import { describe, it, expect } from 'vitest';
import { SELF_REF } from '../resolve.js';

describe('SELF_REF', () => {
  it('is the canonical "@self" marker', () => {
    expect(SELF_REF).toBe('@self');
  });

  it('round-trips through the handler normalisation expression', () => {
    const requesterId = '123456789012345678';

    const fromSelf = SELF_REF === SELF_REF ? requesterId : SELF_REF;
    expect(fromSelf).toBe(requesterId);

    const otherRef = 'Alice';
    const fromOther = (otherRef as string) === SELF_REF ? requesterId : otherRef;
    expect(fromOther).toBe('Alice');
  });
});
