// ★ M2's OTHER HALF: state what was NOT modelled, not only how good the index is.
//
// Every TRUST line this repo emitted described EVIDENCE QUALITY — heuristic-only, coverage
// incomplete, index not ready, collection stale, fetch cap hit. All of them answer "how much do we
// trust what we indexed". None answered "what can this analysis not see at all", and a search for
// "not modelled" across mcp/ returned ZERO hits before this.
//
// The distinction matters at exactly one moment: an agent reading "NO CALLERS" and deciding whether
// a symbol is safe to delete. A stale index means "look again". An unmodelled construct means
// "looking again with the same tool will give the same wrong answer".
//
// ⚠ CLAIM CEILING, ASSERTED BELOW: this states a property of the ANALYSIS. It must never read as a
// claim that the queried symbol is affected by macros or conditional compilation — that would be a
// suspicion with no evidence behind it, attached to every C++ absence.
import { describe, it, expect } from 'vitest';
import { buildAbsenceTrustLine, constructCoverageClause } from '../../../mcp/stdio/query/lsp-evidence.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

describe('an absence claim names what the analysis structurally cannot see', () => {
  it('★ a C++ absence names the constructs, and only the ones actually observed', async () => {
    const line = await buildAbsenceTrustLine({ noun: 'callers', language: 'cpp' });
    expect(line).toMatch(/NOT MODELLED/);
    expect(line, 'macros — the only construct blind in BOTH tiers').toMatch(/macro-generated call is invisible to BOTH tiers/);
    expect(line, 'indirection').toMatch(/function-pointer calls/);
    expect(line, 'conditional compilation').toMatch(/inactive #ifdef branch/);
    expect(line, 'included .cpp').toMatch(/#include'd \.cpp/);
  });

  it("⛔ it does NOT claim extern-without-header is unmodelled — both tiers resolve it", async () => {
    // M2's milestone text lists `extern-without-header`. Measured, BOTH tiers resolve it
    // (heuristic conf=0.60, then conf=0.95 [lsp✓] after collection). Shipping it would be a FALSE
    // caveat: telling an agent we cannot see something we can corrodes trust in correct results
    // exactly as badly as the reverse. A milestone listing something is not evidence that it holds.
    const line = await buildAbsenceTrustLine({ noun: 'callers', language: 'cpp' });
    expectAbsentWithLiveMatcher(
      /extern/i,
      { forbidden: "NOT MODELLED: extern declarations without a header, and a macro-generated call",
        allowed: 'NOT MODELLED: a macro-generated call is invisible to BOTH tiers.' },
      line,
      'a construct the tool handles must not be listed as unmodelled',
    );
  });

  it('⛔ it names the DIRECTION each tier fails in — measured, after the first version was wrong', async () => {
    // The first version said "invisible to BOTH tiers". It was derived from the compile-database
    // model and shipped unobserved. A fixture settled it: with a call inside `#ifdef FEATURE_X`
    // and FEATURE_X undefined, clangd produced NO edge (conf=0.95 [lsp✓] only for the
    // always-compiled control) while tree-sitter produced one at conf=0.60 — it parses text and
    // never evaluates the preprocessor.
    //
    // ⇒ The tiers do not share the blind spot; they fail in OPPOSITE directions, and the direction
    // is the actionable part. A reader told "both are blind" would distrust the heuristic set for
    // the wrong reason — its actual failure here is reporting calls that never compile.
    const line = await buildAbsenceTrustLine({ noun: 'callers', language: 'cpp' });
    // ⛔ BOTH SIDES ARE ASSERTED, and the second only because a mutant caught its absence once.
    // Asserting one direction of a two-sided claim and not its counterpart is how the claim rots
    // back into the one-sided version that was wrong to begin with.
    expect(line, 'what the heuristic tier misses').toMatch(/heuristic graph misses function-pointer calls that clangd resolves/);
    expect(line, 'what clangd misses').toMatch(/clangd covers only what the compile DB compiles/);
    expect(line, 'and the heuristic overcount').toMatch(/counting\s+inactive branches as if live/);
  });

  it('⛔ CLAIM CEILING: it describes the analysis, never the queried symbol', async () => {
    const line = await buildAbsenceTrustLine({ noun: 'callers', language: 'cpp' });
    expect(line).toMatch(/NOT that this symbol is affected/);
  });

  it('★★★ a JavaScript/Python absence NAMES its own blind spot — the premise below expired', () => {
    // ⚠ THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-09-03, and the reasoning it carried was:
    //
    //   "The 445-byte warning wall this project already tore out was unconditional prose. A caveat
    //    everyone skims protects nobody, so this one is paid for only where the constructs exist."
    //
    // The cost argument is still right. The PREMISE is what expired: "where the constructs exist"
    // assumed JS and Python have no unmodelled call construct worth naming. A fixture indexed by the
    // real pipeline falsified that — JS `table[name]()` and `o[k]()`, Python `getattr(obj,name)()`
    // produce NO caller edge while an ordinary direct call in the same file does.
    // scripts/probe-dynamic-dispatch-blindspots.mjs
    //
    // ⚠ AND THE BYTES WERE MEASURED RATHER THAN WAVED AT, because I am the one who wanted the change
    // to stand: cpp 453B (71.1% of the absence answer, already shipped and accepted), javascript
    // 185B (50.1%), python 168B (47.7%). The new clauses are SMALLER than the accepted one on the
    // same surface, so the wall precedent does not distinguish them. Those percentages are an upper
    // bound — they exclude the SCOPE clause a real answer also carries.
    //
    // ⛔ WHAT WOULD REVERSE THIS: evidence that agents reading a JS "no callers" do not act on it, or
    // that computed-key dispatch is vanishingly rare in real JS. Neither is measured.
    expect(constructCoverageClause('javascript')).toMatch(/NOT MODELLED/);
    expect(constructCoverageClause('javascript'), 'name the construct, not a vague caution').toMatch(/computed key/);
    expect(constructCoverageClause('typescript')).toMatch(/computed key/);
    expect(constructCoverageClause('python')).toMatch(/getattr/);
  });

  it('⛔ a language with NO verified blind spot still pays zero — the wall lesson survives', () => {
    // The original reasoning is kept where it still applies. Eight of the twelve configured
    // languages have no fixture establishing what our extractor misses, so they say nothing rather
    // than carrying invented prose. Silence here is a recorded decision, not an oversight.
    expectAbsentWithLiveMatcher(
      /NOT MODELLED/,
      { forbidden: ' NOT MODELLED: a call through a computed key — table[name](), obj[k]()',
        allowed: '' },
      constructCoverageClause('ruby'),
      'an uninvestigated language must not carry an invented caveat',
    );
    expect(constructCoverageClause('go')).toBe('');
  });

  it('the C-family is recognised through the backend registry, not a parallel list', () => {
    // `c` aliases to `cpp` in code-intel/backends.js, so C gets the clause without a second list
    // here that could drift from the registry.
    expect(constructCoverageClause('c')).toMatch(/NOT MODELLED/);
    expect(constructCoverageClause('CPP')).toMatch(/NOT MODELLED/);
    // `c_cpp` is the resolver's family bucket (ingest/resolver.js:47-48) and is NOT a registry
    // alias — matched explicitly, because adding it to the alias map would change which backend
    // gets selected for those rows.
    expect(constructCoverageClause('c_cpp')).toMatch(/NOT MODELLED/);
  });

  it('an unknown or missing language adds nothing — fail closed, not fail loud', () => {
    expect(constructCoverageClause(null)).toBe('');
    expect(constructCoverageClause(undefined)).toBe('');
    expect(constructCoverageClause('')).toBe('');
    expect(constructCoverageClause('rust')).toBe('');
  });

  it('the base absence caveat is unchanged for every language', async () => {
    // Regression guard: the construct clause is ADDITIVE. The existing not-exhaustive caveat is
    // what routes an agent away from treating absence as proof, and it must survive.
    for (const language of [null, 'cpp', 'javascript']) {
      const line = await buildAbsenceTrustLine({ noun: 'callers', language });
      expect(line, `base caveat missing for ${language}`).toMatch(/absence is from the heuristic graph and is NOT exhaustive/);
    }
  });
});
