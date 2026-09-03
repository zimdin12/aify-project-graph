// ⛔ A NEW LANGUAGE MUST NOT INHERIT SILENCE.
//
// `constructCoverageClause` states what the analysis cannot see, and it is used ONLY on the absence
// path — the "no callers" answer that licenses a deletion. It shipped for C/C++ alone, so ten of the
// twelve configured languages, including this product's own primary ones, said nothing there.
// Measured 2 of 12: docs/evidence/m2-contract/FINDING-not-modelled-is-cpp-only.md
//
// ⭐ THIS TEST IS THE FORCED DOOR. The map must carry a key for every language in the REAL registry,
// so adding a language makes someone decide — a clause, or an explicit null meaning "nothing
// verified yet". A missing key fails here instead of defaulting to silence in production.
//
// ⚠ DERIVED FROM LANGUAGE_CONFIGS, never a list retyped here. A parallel list would drift and this
// gate would then certify a registry it no longer describes.
import { describe, it, expect } from 'vitest';
import { constructCoverageClause, NOT_MODELLED_BY_LANGUAGE } from '../../../mcp/stdio/query/lsp-evidence.js';
import { LANGUAGE_CONFIGS } from '../../../mcp/stdio/ingest/languages/index.js';

// ⛔ The registry is an ARRAY of config objects. My first measurement called Object.keys on it and
// read the INDICES as language names, reporting "0 of 12" — including cpp, which demonstrably has a
// clause. The positive control is what caught it, and this comment is here so the next reader does
// not repeat the shape.
const LANGUAGES = LANGUAGE_CONFIGS.map((c) => c.language);

describe('the NOT MODELLED contract covers the whole language registry', () => {
  it('⛔ POSITIVE CONTROL: cpp states it — else every assertion below is vacuous', () => {
    expect(LANGUAGES.length, 'the registry must be non-empty and array-shaped').toBeGreaterThan(5);
    expect(constructCoverageClause('cpp')).toMatch(/NOT MODELLED/);
  });

  it('⛔ NEGATIVE CONTROL: an unknown language stays silent — the clause is not printed for anything', () => {
    expect(constructCoverageClause('zzq-not-a-language')).toBe('');
    expect(constructCoverageClause('')).toBe('');
    expect(constructCoverageClause(null)).toBe('');
  });

  it('★★★ every configured language has a RECORDED decision, not a default', () => {
    // A language absent from the map returns '' exactly like one deliberately recorded as silent,
    // so the two are indistinguishable at the call site — which is why the map is asserted directly
    // rather than inferred from the output.
    // ⛔ KEY PRESENCE, not output. A language absent from the map returns '' exactly like one
    // deliberately recorded as silent, so checking the OUTPUT cannot tell them apart — the door
    // would look shut while standing open. Asserting the keys is what makes it a real gate.
    const undecided = LANGUAGES.filter((l) => !(l in NOT_MODELLED_BY_LANGUAGE));
    expect(undecided, 'these languages would inherit silence without anyone deciding').toEqual([]);
  });

  it('★★★ the languages with a verified blind spot actually state it', () => {
    // Each of these was fixtured before its clause was written: no caller->callee edge while an
    // ordinary direct call in the same file produced one.
    for (const lang of ['javascript', 'typescript', 'python']) {
      expect(constructCoverageClause(lang), `${lang} must state its blind spot`).toMatch(/NOT MODELLED/);
    }
    expect(constructCoverageClause('javascript'), 'and name the construct').toMatch(/computed key/);
    expect(constructCoverageClause('python')).toMatch(/getattr/);
  });

  it('⛔ every clause disclaims that it is about the ANALYSIS, not about this symbol', () => {
    // Without this sentence a reader takes "NOT MODELLED: dynamic dispatch" as a statement that THIS
    // symbol is reached dynamically — a semantic claim none of these fixtures support.
    for (const lang of LANGUAGES) {
      const s = constructCoverageClause(lang);
      if (!s) continue;
      expect(s, `${lang} states a blind spot without disclaiming it`).toMatch(/what the analysis cannot see/);
    }
  });
});

