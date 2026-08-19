// A DOUBT MUST BE SCOPED TO WHAT ACTUALLY CAUSES IT.
//
// ⛔ I CREATED THIS DEFECT WHILE FIXING ITS OPPOSITE, IN THE SAME COMMIT (be027e7).
//
// Run 1 of the efficacy series found graph_whereis stating no population when nothing was
// capped — a correct answer the reader could not rely on. I fixed that, and in the same commit
// widened graph_health's no-code-intel consequence to name "definition counts/locations" among
// the things that "cannot be treated as exhaustive".
//
// Run 2, on the fixed build, went the WRONG WAY: 21 tool calls against run 1's 15 and the
// baseline's 9. The arm reported why, and it is exact:
//
//   graph_whereis said  "10 of 10 ... Nothing was truncated."
//   graph_health said   "... AND definition counts/locations: none can be treated as exhaustive"
//
// One surface of the same server licensed the claim; the other de-licensed it, naming the exact
// query type; both sounded authoritative; nothing said which wins. So the arm re-derived all six
// answers from the TypeScript compiler API and paid for everything twice.
//
// ★ THE ARM'S FRAMING, WHICH IS THE LESSON: "an unwarranted DOUBT costs the reader exactly as
// much as an unwarranted claim, because they go and check either way." I fixed one asymmetry and
// manufactured its mirror image in the same edit.
//
// ⇒ Code-intel absence governs CROSS-REFERENCE facts — caller sets, deletion safety, override
// and overload resolution — because those need a compiler to resolve. It does NOT govern the
// local declaration table: a count of nodes whose exact label matches, over declaration types,
// is settled by extraction within a fresh index. The real limit on that count is what the
// EXTRACTOR can see (computed or generated definitions), which is a different cause and is
// stated as its own thing.
//
// ⚠ Evidence this is the right scoping, not a convenient one: two independent parsers — a
// tree-sitter reference built for this eval, and the TypeScript compiler API used by the arm —
// agreed with graph_whereis on all 16 definition sites across 6 symbols, with zero misses and
// zero extras, on a repo with NO code-intel collection.
import { describe, it, expect } from 'vitest';
import { buildNextActions } from '../../../mcp/stdio/query/verbs/health.js';

const noCollection = () => buildNextActions({
  codeIntel: { available: false, reason: 'no_collection' },
  overlay: { present: true }, overlayQuality: {}, artifactAges: {},
  stale: false, trust: 'weak', briefStaleVsManifest: false, trustUnresolvedEdges: 2168,
});

describe('the no-code-intel consequence is scoped to what code-intel governs', () => {
  const why = () => (noCollection().find((a) => /code-intel/i.test(a.why))?.why ?? '');

  it('★★★ still warns about the answers a compiler actually settles', () => {
    // The warning must not be lost — this is the half that was right all along.
    const w = why();
    expect(w, 'caller sets need cross-reference resolution').toMatch(/caller/i);
    expect(w, 'deletion safety is the highest-stakes claim the tool makes').toMatch(/deletion|delete/i);
  });

  it('★★★ does NOT blanket-de-license definition counts', () => {
    // The regression: naming definition counts as non-exhaustive contradicted graph_whereis's
    // own attestation on the same server, and the reader had no way to resolve it.
    const w = why();
    expect(w, 'a definition count is settled by extraction, not by a compiler')
      .not.toMatch(/definition counts?\/locations?: none|AND definition counts/i);
  });

  it('★★ names the REAL limit on a definition count, which is a different cause', () => {
    // Scoping a doubt is not deleting it. What actually limits a count is extractor visibility.
    const w = why();
    expect(w, 'the true limit is what the extractor can see').toMatch(/extract|parse|computed|generated/i);
  });

  it('★★ says nothing at all when a collection IS present — the negative half', () => {
    const actions = buildNextActions({
      codeIntel: { available: true, status: 'ok' },
      overlay: { present: true }, overlayQuality: {}, artifactAges: {},
      stale: false, trust: 'ok', briefStaleVsManifest: false, trustUnresolvedEdges: 10,
    });
    expect(actions.find((a) => /no code-intel collection/i.test(a.why))).toBeUndefined();
  });
});
