import { describe, it, expect } from 'vitest';
import { fatalIncludeErrors } from '../../../mcp/stdio/query/verbs/code_intel_live.js';

// An unresolved #include is fatal to the whole translation unit: clangd builds no AST, so every
// reference answer derived from it is empty for a reason that has nothing to do with the code.
// Reproduced 2026-08-25 — a TU with `#include <cstddef>` returned 0 references with status "ok"
// while an identical TU without it returned 2.

const session = (diagnostics) => ({ client: { diagnosticsFor: () => diagnostics } });

describe('fatalIncludeErrors', () => {
  it('detects an unresolved include and extracts the header name', () => {
    const found = fatalIncludeErrors(session([
      { severity: 1, message: "'cstddef' file not found" },
    ]), 'file:///x.cpp');
    expect(found).toHaveLength(1);
    expect(found[0].header).toBe('cstddef');
  });

  it('handles the quoted-include form as well as the angle-bracket one', () => {
    expect(fatalIncludeErrors(session([
      { severity: 1, message: '"engine/platform/Platform.h" file not found' },
    ]), 'u')[0].header).toBe('engine/platform/Platform.h');
  });

  it('⭐ does NOT fire on a warning — only an error can have stopped the parse', () => {
    // Firing on severity 2 would label healthy results untrustworthy, and a disclaimer that
    // attaches to everything tells the reader nothing.
    expect(fatalIncludeErrors(session([
      { severity: 2, message: "'cstddef' file not found" },
    ]), 'u')).toHaveLength(0);
  });

  it('does NOT fire on an unrelated compile error', () => {
    expect(fatalIncludeErrors(session([
      { severity: 1, message: "use of undeclared identifier 'missing'" },
    ]), 'u')).toHaveLength(0);
  });

  it('returns empty for a clean TU — the discrimination the guard exists for', () => {
    // A genuinely empty caller set must stay genuinely empty. Two empty results, only one of
    // them labelled untrustworthy, is the whole point.
    expect(fatalIncludeErrors(session([]), 'u')).toHaveLength(0);
  });

  it('fails safe when the diagnostics read throws — never breaks the query', () => {
    const throwing = { client: { diagnosticsFor: () => { throw new Error('boom'); } } };
    expect(fatalIncludeErrors(throwing, 'u')).toEqual([]);
  });

  it('tolerates a session with no client at all', () => {
    expect(fatalIncludeErrors({}, 'u')).toEqual([]);
    expect(fatalIncludeErrors(null, 'u')).toEqual([]);
  });
});
