import { describe, it, expect } from 'vitest';
import { autoReindexEnabled } from '../../../mcp/stdio/freshness/auto-reindex.js';

describe('autoReindexEnabled', () => {
  it('is true for common truthy strings (case-insensitive)', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'On']) expect(autoReindexEnabled(v)).toBe(true);
  });
  it('is false for falsey / unset values', () => {
    for (const v of [undefined, null, '', '0', 'false', 'no', 'off', 'random']) expect(autoReindexEnabled(v)).toBe(false);
  });
});
