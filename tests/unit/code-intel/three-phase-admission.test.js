// The three-phase admission pipeline, and the provider divergence it exists to preserve.
//
//   1. structural decode   shared, no I/O
//   2. scope adapter       PROVIDER, no I/O
//   3. document coherence  shared, exactly one read
//
// ⛔ WHY PHASE 2 IS THE PROVIDER'S. cpp-clangd stores an external definition as absolute-path
// evidence; lsp-collect refuses it, because pyright resolves imports into installed site-packages
// and its own typeshed stubs and those are real facts about the wider world, not nodes in THIS
// graph. Unifying that policy would silently migrate one provider's stored population.
//
// ⛔ AND A SCOPE SKIP IS NOT A REFUSAL. "Outside our graph" is a policy; "incoherent" is an
// accusation about the producer. Counting one as the other would put a fabricated defect rate on
// a provider that did nothing wrong.
import { describe, it, expect } from 'vitest';
import { admitLocations, SCOPE_ELIGIBLE, ADMISSION, LOCATION_REASONS } from '../../../mcp/stdio/code-intel/location-coherence.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const IN_REPO = 'file:///C:/repo/src/one.cpp';
const EXTERNAL = 'file:///C:/elsewhere/vendor/two.cpp';
const RANGE = { start: { line: 0, character: 5 }, end: { line: 0, character: 16 } };
const TOKEN = 'alphaCaller';
const TEXT = 'void alphaCaller() {}';

// Records every path the document phase actually reads, so "phase 2 ran first" is observed rather
// than assumed from source order.
function trackingReader(paths = []) {
  const seen = [];
  const read = (filePath) => {
    seen.push(filePath);
    return paths.includes(filePath) || paths.length === 0
      ? { status: 'ok', text: TEXT }
      : { status: 'unavailable', reason: 'file_status_unavailable' };
  };
  read.seen = seen;
  return read;
}

const cppScope = () => SCOPE_ELIGIBLE;                                   // everything eligible
const repoScope = (uri) => (uri.includes('/repo/') ? SCOPE_ELIGIBLE : 'out_of_repo');

describe('three-phase admission', () => {
  it('POSITIVE CONTROL: an in-repo valid Location is ADMITTED under BOTH scope policies', () => {
    for (const [label, scope] of [['cpp-style', cppScope], ['lsp-collect-style', repoScope]]) {
      const gate = admitLocations([{ uri: IN_REPO, range: RANGE }], {
        method: 'textDocument/definition', expectedToken: TOKEN, readDocument: trackingReader(), scope,
      });
      expect(gate.admitted, `${label} must admit an in-repo valid Location`).toHaveLength(1);
      expect(gate.scopeSkipped).toHaveLength(0);
      expect(gate.refused).toHaveLength(0);
    }
  });

  it('★ THE INTENTIONAL DIVERGENCE: the same external Location is admitted by one policy and scope-skipped by the other', () => {
    const external = [{ uri: EXTERNAL, range: RANGE }];

    const cpp = admitLocations(external, {
      method: 'textDocument/definition', expectedToken: TOKEN, readDocument: trackingReader(), scope: cppScope,
    });
    expect(cpp.admitted, 'cpp keeps external evidence').toHaveLength(1);
    expect(cpp.scopeSkipped).toHaveLength(0);

    const lsp = admitLocations(external, {
      method: 'textDocument/definition', expectedToken: TOKEN, readDocument: trackingReader(), scope: repoScope,
    });
    expect(lsp.admitted, 'lsp-collect stores no out-of-repo node').toHaveLength(0);
    expect(lsp.scopeSkipped).toHaveLength(1);
    expect(lsp.scopeSkipped[0].reason).toBe('out_of_repo');
    // ⛔ and it is NOT an accusation about the producer
    expect(lsp.refused, 'a scope skip must never be counted as a refusal').toHaveLength(0);
    expect(lsp.unavailable).toHaveLength(0);
  });

  it('⛔ PHASE 2 RUNS BEFORE PHASE 3 — a scope-skipped Location is never read', () => {
    // Reversed, the guard reads every document it was always going to discard. On the ts/pyright
    // path that is every site-packages and typeshed file pyright resolves into.
    const reader = trackingReader();
    const gate = admitLocations(
      [{ uri: EXTERNAL, range: RANGE }, { uri: IN_REPO, range: RANGE }],
      { method: 'textDocument/references', expectedToken: TOKEN, readDocument: reader, scope: repoScope },
    );
    expect(gate.scopeSkipped).toHaveLength(1);
    expect(gate.admitted).toHaveLength(1);
    // ⚠ An earlier version of this assertion compared `reader.seen` to an expression derived from
    // `reader.seen[0]` — the array against itself. It passed unconditionally and proved nothing.
    // These three are stated against literals instead.
    expect(reader.seen, 'exactly one document may be opened').toHaveLength(1);
    expect(String(reader.seen[0]), 'the in-scope document is the one read').toMatch(/one\.cpp$/);
    // ⚠ A BARE not.toMatch HERE WOULD PROVE NOTHING. It passes when the output is clean AND when
    // the matcher is dead, and nothing in a green run separates the two. Asserted over EVERY path
    // read, not just seen[0], so the prohibition covers the whole read set.
    expectAbsentWithLiveMatcher(
      /two\.cpp/,
      { forbidden: 'C:/elsewhere/vendor/two.cpp', allowed: 'C:/repo/src/one.cpp' },
      reader.seen.map(String).join('|'),
      'the out-of-scope document must never be opened',
    );
  });

  it('a structurally invalid Location is REFUSED in phase 1, before scope is even consulted', () => {
    let scopeCalls = 0;
    const scope = (uri) => { scopeCalls += 1; return repoScope(uri); };
    const gate = admitLocations([{ uri: IN_REPO, range: { start: { line: -1, character: 0 }, end: { line: 0, character: 1 } } }], {
      method: 'textDocument/definition', expectedToken: TOKEN, readDocument: trackingReader(), scope,
    });
    expect(gate.refused).toHaveLength(1);
    expect(gate.refused[0].reason).toBe(LOCATION_REASONS.INVALID_RANGE_SYNTAX);
    expect(scopeCalls, 'phase 2 must not run on a location phase 1 already rejected').toBe(0);
  });

  it('NEGATIVE CONTROL: with no scope adapter everything is eligible, so cpp behaviour is unchanged', () => {
    const gate = admitLocations([{ uri: EXTERNAL, range: RANGE }], {
      method: 'textDocument/definition', expectedToken: TOKEN, readDocument: trackingReader(),
    });
    expect(gate.admitted).toHaveLength(1);
    expect(gate.scopeSkipped).toHaveLength(0);
  });
});
