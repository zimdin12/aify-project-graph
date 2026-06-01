import { describe, it, expect } from 'vitest';
import { stalenessBanner } from '../../../mcp/stdio/query/staleness-banner.js';

describe('stalenessBanner', () => {
  it('returns empty string when nothing is stale', () => {
    expect(stalenessBanner([])).toBe('');
    expect(stalenessBanner(null)).toBe('');
  });
  it('renders one consistent line naming the stale files', () => {
    const b = stalenessBanner(['a/x.cpp', 'b/y.h']);
    expect(b).toMatch(/^⚠ stale:/);
    expect(b).toContain('a/x.cpp');
    expect(b).toContain('b/y.h');
    expect(b).toMatch(/Read these directly/i);
  });
  it('caps the file list and notes the overflow count', () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}.cpp`);
    const b = stalenessBanner(files, { max: 5 });
    expect(b).toContain('f0.cpp');
    expect(b).toMatch(/\+15 more/);
  });
});
