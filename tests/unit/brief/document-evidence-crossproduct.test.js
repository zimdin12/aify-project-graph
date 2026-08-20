// ⛔⛔ SEVEN REVISE ROUNDS ON ONE CARRIER, AND EVERY ONE WAS THE SAME QUESTION AT A DIFFERENT
// COORDINATE.
//
//     round 1-2  the candidate set, and the ordering over it
//     round 3    the state reached ONE surface of four
//     round 4    the count was a rendered sample, not a population
//     round 5    positional rows travelled as linked evidence
//     round 6    custody: positional rows erased stronger source facts; NaN died in the codec
//     round 7    the codec fix covered the CANDIDATE count and not the INDEXED one
//
// Each round I fixed the cell the witness named. The space is
//
//     4 surfaces  ×  2 count fields  ×  {valid, zero, absent, malformed}
//
// and a witness names one cell. **A fix aimed at a cell cannot close a space**, which is why this
// surface produced a round every time someone looked at a different corner of it.
//
// ⇒ THIS FILE ENUMERATES THE SPACE INSTEAD. The surfaces are DERIVED from the render module's own
// exports, so a renderer added later is covered without anyone remembering to add it here — the
// same reason the sweep derives its exclusions and the edge-class ledger derives its DELETE
// predicates. A list maintained by hand is a list that will be one entry short exactly when it
// matters.
import { describe, it, expect } from 'vitest';
import * as renderModule from '../../../mcp/stdio/brief/render.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// ⚠ DERIVED, NOT LISTED. Every exported `render*` function that returns a brief artifact.
const ALL_SURFACES = Object.entries(renderModule)
  .filter(([name, v]) => /^render/.test(name) && typeof v === 'function')
  .map(([name, fn]) => ({ name, fn }));

const baseData = (over = {}) => ({
  snapshot: {
    nodes: 10, edges: 5, files: 4, symbols: 6, unresolvedEdges: 0,
    commit: 'abc1234', indexedAt: '2026-08-20T00:00:00Z', languages: [],
  },
  entries: [],
  subs: [],
  hubsArr: [],
  readFirstArr: [],
  positionalDocumentFallback: [],
  tests: [],
  risksArr: [],
  recent: [],
  health: { level: 'ok', issues: [] },
  overlayHealth: null,
  overlay: null,
  brokenFeatureEdges: [],
  tasksArtifact: null,
  overlayQuality: null,
  dirtySeams: null,
  tooling: [],
  coverage: null,
  exports: [],
  manifestIndexedAt: '2026-08-20T00:00:00Z',
  manifestCommit: 'abc1234',
  ...over,
});

const MALFORMED = [NaN, Infinity, 1.5, '3', -1];
const COUNT_FIELDS = ['documentCount', 'documentCandidateCount'];

/** Render through a surface and return text, whatever the surface's native shape is. */
/**
 * A surface is a DOCUMENT-EVIDENCE surface if its output actually changes when the document counts
 * change. Physical membership: a renderer that consumes the data is in scope automatically, one
 * that ignores it is out automatically, and nobody maintains a list.
 */
const asTextRaw = (surface, data) => {
  const out = surface.fn(data, '/repo');
  return typeof out === 'string' ? out : JSON.stringify(out);
};

const asText = (surface, data) => asTextRaw(surface, data);

const DOC_SURFACES = ALL_SURFACES.filter((surface) => {
  const withDocs = asTextRaw(surface, baseData({ documentCount: 42, documentCandidateCount: 0 }));
  const without = asTextRaw(surface, baseData());
  return withDocs !== without;
});

describe('the document-evidence carrier holds across its whole space', () => {
  it('★★★ the surface list is DERIVED and non-trivial', () => {
    // ⛔ POSITIVE CONTROL. Every assertion below loops over these; an empty or tiny list would
    // satisfy all of them silently. This is the wrong-zero guard for the harness itself.
    expect(ALL_SURFACES.length, 'render surfaces discovered from the module').toBeGreaterThanOrEqual(5);
    expect(ALL_SURFACES.map((s) => s.name)).toContain('renderJson');
    // ⚠ AND MEMBERSHIP IS PHYSICAL, NOT NAME-SHAPED. My first version of this file looped over
    // EVERY `render*` export and immediately failed on `renderPlanAgentMarkdown` — a planning brief
    // that never references `readFirstArr` and legitimately carries no document evidence. Deriving
    // by name swept in a surface that is not in scope, which is the same defect as deriving by name
    // anywhere else: the rule was structural and the membership test was lexical.
    expect(DOC_SURFACES.length, 'and some of them actually consume document evidence')
      .toBeGreaterThanOrEqual(4);
    expect(DOC_SURFACES.length, 'but not all of them do — the plan brief has no doc section')
      .toBeLessThan(ALL_SURFACES.length);
  });

  for (const field of COUNT_FIELDS) {
    for (const bad of MALFORMED) {
      it(`★★★ no surface leaks a malformed ${field} (${String(bad)}) into its output`, () => {
        const data = baseData({ [field]: bad });
        for (const surface of DOC_SURFACES) {
          const text = asText(surface, data);
          // ⚠ The malformed value may appear inside a `{type, repr}` diagnostic — that is the
          // point of the diagnostic. What must never appear is a bare count field holding it.
          const pattern = new RegExp(`"(indexed_document_count|linked_candidate_count)":\\s*"?${
            String(bad).replace('.', '\\.')}"?`);
          expectAbsentWithLiveMatcher(
            pattern,
            {
              forbidden: `"indexed_document_count": ${String(bad)}`,
              allowed: '"indexed_document_count": null',
            },
            text,
            `${surface.name} must not put ${String(bad)} in a count field`,
          );
        }
      });
    }
  }

  for (const field of COUNT_FIELDS) {
    for (const bad of MALFORMED) {
      it(`★★★ a malformed ${field} (${String(bad)}) stays distinguishable from ABSENT on the wire`, () => {
        // ⛔ THROUGH THE REAL CODEC. NaN and Infinity serialize to `null`, which is exactly what an
        // absent count also produces — so an in-memory assertion certifies a property the published
        // artifact does not have.
        const withBad = JSON.parse(JSON.stringify(renderModule.renderJson(baseData({ [field]: bad }), '/repo')));
        const absent = JSON.parse(JSON.stringify(renderModule.renderJson(baseData(), '/repo')));
        expect(withBad.document_evidence.state).toBe('inconsistent');
        expect(absent.document_evidence.state, 'absence is not inconsistency').not.toBe('inconsistent');
        expect(JSON.stringify(withBad.document_evidence))
          .not.toBe(JSON.stringify(absent.document_evidence));
      });
    }
  }

  it('★★★ every DOC surface renders SOMETHING for each defined state — silence is a state too', () => {
    // ⛔ Round 3 was exactly this: the typed state reached the full markdown brief and none of the
    // compact artifacts an agent reads first. A per-state check on one surface cannot see it.
    const STATES = [
      { name: 'graph_empty', documentCount: 0, documentCandidateCount: 0 },
      { name: 'indexed_without_link_candidates', documentCount: 42, documentCandidateCount: 0 },
    ];
    for (const st of STATES) {
      for (const surface of DOC_SURFACES) {
        const text = asText(surface, baseData(st));
        expect(text.length, `${surface.name} produced nothing for ${st.name}`).toBeGreaterThan(0);
        expect(text, `${surface.name} is silent on ${st.name}`).toMatch(/DOCS|document/i);
      }
    }
  });

  it('★★★ CONTROL: a clean carrier leaks no diagnostic on any surface', () => {
    // Without this, "always emit a diagnostic" passes every assertion above and every artifact
    // reports itself broken — the permanent-warning failure this repo has shipped once already.
    const data = baseData({
      documentCount: 160,
      documentCandidateCount: 89,
      readFirstArr: [{ file: 'README.md', why: 'w', kind: 'doc' }],
    });
    for (const surface of DOC_SURFACES) {
      expectAbsentWithLiveMatcher(
        /INCONSISTENT|invalid_/,
        { forbidden: 'EVIDENCE INCONSISTENT', allowed: 'Linked document candidates' },
        asText(surface, data),
        `${surface.name} invented a problem`,
      );
    }
  });
});
