// ⛔ `provenance` NAMED THE WRONG ENGINE, IN THE ONE FIELD AN AGENT USES TO WEIGH A LOCATION.
//
// Found by ef-manager on a live session, 2026-09-05: a JavaScript definition came back
// `provenance: "clangd@live"` while `graph_health` in the same session reported
// `provider: "ts-langserver"`. Not an inference — five hardcoded string literals, including
// `code_intel_hierarchy.js:77  const LSP_PROVENANCE = 'clangd@live'`, a constant named for the
// general concept holding one provider's value.
//
// ⚠ BLAST RADIUS, CHECKED RATHER THAN ASSUMED, because the fix routes a NEW value into OLD branches
// and that shape burned me twice yesterday:
//   · `provenanceRank` keys on LSP_VERIFIED / EXTRACTED / INFERRED / AMBIGUOUS. Live provenance
//     strings were never in that table, so ranking is untouched.
//   · `verifiedEdgeLanguage` derives language from the EXTRACTOR tag (`cpp-clangd#hash`), not from
//     this field, so stored-edge language inference is untouched.
//   · `formatProvenanceTag` treats any string containing '@' as CODE_INTEL, so a new provider name
//     still tags correctly.
// ⇒ The defect is confined to what a live response TELLS an agent. That is narrower than it first
// looked, and it is still a false statement in a trust field.
//
// ⚠ AND THE NAME IS OVERLOADED: `LSP_PROVENANCE` is defined three times across the codebase with
// TWO different values — 'LSP_VERIFIED' in importer.js and lsp-evidence.js (stored edges), and
// 'clangd@live' here (live responses). Same identifier, different meanings, different files.
//
// ⭐ THE EXPECTATION BELOW COMES FROM `BACKENDS`, NOT FROM THE FUNCTION UNDER TEST. That table is
// the producer: it is what `graph_health` reports and what decides which server actually spawns. A
// test that read the expected names out of `liveProvenanceFor` would only prove the function agrees
// with itself, which is precisely how a ratchet enshrined a defect yesterday.
import { describe, it, expect } from 'vitest';
import { BACKENDS } from '../../../mcp/stdio/code-intel/backends.js';
import { liveProvenanceFor } from '../../../mcp/stdio/code-intel/provenance.js';

describe('live provenance names the engine that actually answered', () => {
  it('★★★ every registered backend gets ITS OWN name, harvested from BACKENDS', () => {
    const langs = Object.keys(BACKENDS);
    expect(langs.length, 'no backends found — the expectation would be vacuous').toBeGreaterThan(1);
    for (const lang of langs) {
      const expected = `${BACKENDS[lang].providerName}@live`;
      expect(liveProvenanceFor(lang), `${lang} must name its own provider`).toBe(expected);
    }
  });

  it('★★★ the names are genuinely DISTINCT — one string for all would satisfy nothing else here', () => {
    // Without this, a function returning a single constant could still pass a loosely written
    // version of the test above. That is the defect being fixed, so it gets its own assertion.
    const produced = Object.keys(BACKENDS).map(liveProvenanceFor);
    expect(new Set(produced).size, 'each backend must produce a different provenance').toBe(produced.length);
  });

  it('★★★ JavaScript reports the TypeScript server, because that is what answers it', () => {
    // The exact case ef-manager hit. JS has no server of its own; normalizeLanguage routes it to
    // the TS backend, so the honest answer names ts-langserver rather than clangd.
    expect(liveProvenanceFor('javascript')).toBe(`${BACKENDS.typescript.providerName}@live`);
    expect(liveProvenanceFor('javascript')).not.toContain('clangd');
  });

  it('★★★ an unknown language does NOT inherit clangd', () => {
    // ⛔ FAIL CLOSED. The whole defect was a specific engine name standing in for the general case.
    // A language with no registered backend must not borrow one, and must not claim compiler
    // provenance it cannot support.
    const unknown = liveProvenanceFor('zzq-not-a-language');
    expect(unknown).not.toContain('clangd');
    expect(unknown).toMatch(/unknown/i);
  });

  it('★★ C++ still reports clangd, so the old value survives where it was always TRUE', () => {
    // POSITIVE CONTROL on the direction that must not change: three existing test files pin
    // `clangd@live` for C++ fixtures, and they are right to.
    expect(liveProvenanceFor('cpp')).toBe('cpp-clangd@live');
  });
});
