// ⛔ A SUPPORTED LANGUAGE WAS TOLD IT WAS UNSUPPORTED.
//
// Found 2026-09-05 by a preregistered Python query on a self-spawned server — the same instrument
// that produced the other five multi-language defects. A Python reference answer carried:
//
//     "prewarmSource": "unsupported_language"
//
// pyright served that very query (provenance came back "pyright@live"). Python IS a supported
// language. What is unsupported is PREWARM for Python — auto-prewarm is implemented only for C++,
// which is a fine feature boundary described by a word that denies something else entirely.
//
// ⚠ SEVERITY, STATED HONESTLY: this is telemetry, not a trust claim, and no shipped code branches on
// it. It is the mildest of the six. It stays worth fixing because an agent reading
// "unsupported_language" on a query the server just answered learns something false about what the
// tool can do — and the cost of the correct word is nothing.
//
// ⭐ Expectation derived from BACKENDS: a language with a registered backend is supported, whatever
// any single feature does about it.
import { describe, it, expect } from 'vitest';
import { BACKENDS } from '../../../mcp/stdio/code-intel/backends.js';
import { PREWARM_NOT_IMPLEMENTED } from '../../../mcp/stdio/query/verbs/code_intel_live.js';

describe('the prewarm label describes prewarm, not language support', () => {
  it('★★★ the label does not claim the LANGUAGE is unsupported', () => {
    expect(PREWARM_NOT_IMPLEMENTED).not.toMatch(/unsupported_language/);
    expect(PREWARM_NOT_IMPLEMENTED, 'it should name PREWARM as the thing that is missing')
      .toMatch(/prewarm/i);
  });

  it('★★★ POSITIVE CONTROL: the languages it fires for really ARE supported', () => {
    // Without this the rename would be cosmetic. The point is that these languages have working
    // backends — pyright answered the query that surfaced this — so calling them unsupported is
    // false rather than merely clumsy.
    for (const lang of ['python', 'typescript']) {
      expect(BACKENDS[lang], `${lang} must have a registered backend`).toBeTruthy();
      expect(BACKENDS[lang].providerName).toBeTruthy();
    }
  });

  it('★★ the label still says a NEGATIVE thing — it must not read as success', () => {
    // The other failure direction: renaming into something neutral would hide that prewarm did not
    // run at all, which is a real fact the caller is entitled to.
    expect(PREWARM_NOT_IMPLEMENTED).toMatch(/not[_ ]implemented|only|unavailable|skipped/i);
  });
});
