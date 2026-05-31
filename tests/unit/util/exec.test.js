import { describe, it, expect } from 'vitest';
import { WINDOWS_HIDE, withHidden } from '../../../mcp/stdio/util/exec.js';

describe('withHidden', () => {
  it('exports WINDOWS_HIDE as true', () => {
    expect(WINDOWS_HIDE).toBe(true);
  });

  it('adds windowsHide: true and preserves other keys', () => {
    const out = withHidden({ encoding: 'utf8' });
    expect(out.windowsHide).toBe(true);
    expect(out.encoding).toBe('utf8');
  });

  it('works with no arguments', () => {
    expect(withHidden()).toEqual({ windowsHide: true });
  });

  it('does not mutate its input', () => {
    const input = { encoding: 'utf8' };
    const out = withHidden(input);
    expect(input).toEqual({ encoding: 'utf8' });
    expect('windowsHide' in input).toBe(false);
    expect(out).not.toBe(input);
  });
});
