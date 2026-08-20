// ⛔ "ALL FOUR SURFACES" WAS A CLAIM WITH NO EXECUTABLE DENOMINATOR.
//
// 310fc64 split document entries out of READ FIRST on the markdown brief, two compact renderings
// and the JSON payload. graph-senior-dev approved the change and then said the quiet part: source
// inspection showed it right, and there was ONE markdown-only regression test. A claim about four
// surfaces verified on one is a claim about one.
//
// ⇒ This file is that denominator: the SAME input through every public renderer, asserting the
// document went to the candidates side and the source entry stayed on the read side. A surface
// added later without the split fails here rather than quietly restoring the withdrawn claim.
//
// ★ AND THE JSON BREAK NEEDED A RECEIPT. `read_first` changed population silently — documents left
// it for `linked_document_candidates`. Without a discriminator a programmatic consumer cannot tell
// "no documents were recommended" from "the producer changed the contract": same bytes, opposite
// meanings. `brief_schema_version: 2` is that receipt, and it is asserted here.
import { describe, it, expect } from 'vitest';
import {
  renderMarkdown, renderAgentMarkdown, renderOnboardAgentMarkdown, renderJson, buildDocumentView,
} from '../../../mcp/stdio/brief/render.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// ⇒ DOCUMENTS ARRIVE THROUGH THE CANONICAL VIEW, NOT THROUGH `readFirstArr`. That array is source
// evidence only now — its `seen` dedupe was letting a linked document erase an export-backed source
// fact for the same path, the same custody defect the positional rows had one category earlier.
const view = (items = [], total = null, positional = [], documentCount = null) => ({
  documentView: buildDocumentView({
    linkedCandidates: { items, total },
    positionalFallback: positional,
    documentCount,
  }),
  documentCount,
  documentCandidateCount: total,
});

// ⚠ Every prohibition here goes through the live matcher rather than a bare `not.toMatch`. A
// negative assertion passes when the thing is absent AND when the pattern is broken, and those look
// identical — so each one carries a forbidden canary proving it can fire and an allowed canary
// proving it discriminates. The suite's ratchet has caught me writing bare ones three times today.
const absent = (subject, label) => expectAbsentWithLiveMatcher(
  /docs\/README\.md/,
  { forbidden: '- `docs/README.md` — 7 document(s) link here', allowed: '- `src/server.js` — 160 connections' },
  subject,
  label,
);

const DOC = { file: 'docs/README.md', why: '7 document(s) link here', kind: 'doc' };
const SRC = { file: 'src/server.js', why: '160 connections', kind: 'high-degree' };

/** One input, shared by every surface, so a difference between them is the renderer's doing. */
const data = () => ({
  snapshot: {
    nodes: 10, edges: 5, files: 4, symbols: 6, unresolvedEdges: 0,
    commit: 'abc1234', indexedAt: '2026-08-20T00:00:00Z', languages: [],
  },
  entries: [],
  subs: [],
  hubsArr: [],
  readFirstArr: [SRC],
  ...view([DOC], 1, [], 3),
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
});

/** Text between two headings, so "present in the file" cannot pass for "present in the section". */
const between = (text, start, end) => {
  const i = text.indexOf(start);
  if (i === -1) return null;
  const j = end ? text.indexOf(end, i + start.length) : -1;
  return text.slice(i, j === -1 ? undefined : j);
};

describe('the document/source split holds on every public surface', () => {
  it('★★★ markdown brief', () => {
    const md = renderMarkdown(data());
    const read = between(md, '## Read first', '## Linked document candidates');
    const docs = between(md, '## Linked document candidates', '\n## ');
    expect(read, 'the source entry stays under the read-order heading').toMatch(/src\/server\.js/);
    absent(read, 'and the document does not join it');
    expect(docs, 'the document is under the candidates heading').toMatch(/docs\/README\.md/);
    expect(docs, 'which states what it is NOT').toMatch(/NOT a reading order/);
  });

  it('★★★ compact agent rendering', () => {
    const md = renderAgentMarkdown(data());
    const read = between(md, 'READ:', 'DOCS (');
    expect(read).toMatch(/src\/server\.js/);
    absent(read, 'a document under READ: would restore the withdrawn claim');
    expect(md, 'the docs line names its basis in the heading itself')
      .toMatch(/DOCS \(link prominence, not a read order\):/);
  });

  it('★★★ onboard rendering', () => {
    const md = renderOnboardAgentMarkdown(data());
    const read = between(md, 'READ:', 'DOCS (');
    expect(read).toMatch(/src\/server\.js/);
    absent(read, 'onboard rendering keeps the split');
    expect(md).toMatch(/DOCS \(link prominence, not a read order\):/);
  });

  it('★★★ JSON payload — and it carries the version that makes the break readable', () => {
    const json = renderJson(data(), '/repo');
    expect(json.brief_schema_version, 'the receipt for an intentional population change').toBe(2);
    expect(json.read_first.map((r) => r.file), 'source only').toEqual(['src/server.js']);
    expect(json.linked_document_candidates.map((r) => r.file), 'documents, named for what ranks them')
      .toEqual(['docs/README.md']);
  });

  it('★★★ CONTROL: a document-only input leaves the READ surfaces empty, not mislabelled', () => {
    // ⛔ Without this, a renderer that dropped documents entirely would pass every assertion above —
    // "not under READ" is satisfied perfectly by "nowhere at all". The split must MOVE them, and
    // the read side must be genuinely absent rather than holding an empty heading.
    const d = { ...data(), readFirstArr: [], ...view([DOC], 1, [], 3) };
    const md = renderMarkdown(d);
    expectAbsentWithLiveMatcher(
      /## Read first/,
      { forbidden: '## Read first', allowed: '## Linked document candidates' },
      md,
      'no empty read-order heading',
    );
    expect(md).toMatch(/## Linked document candidates/);
    expect(renderJson(d, '/repo').read_first, 'and the payload agrees').toEqual([]);
    expect(renderJson(d, '/repo').linked_document_candidates).toHaveLength(1);
  });
});

// ⛔ THE TYPED STATE SHIPPED ON ONE SURFACE OF FOUR AND NAMED CAUSES IT COULD NOT ESTABLISH.
//
// graph-senior-dev ran the same `documentCount: 0` input through every renderer:
//
//     full markdown  state emitted        agent brief   SILENT
//     onboard brief  SILENT               JSON          SILENT (no count, no state)
//
// The compact artifacts an agent reads FIRST were silent in exactly the field state that motivated
// the fix, and `brief.json` could not tell 0 indexed Documents from 42 with no candidates.
//
// ⛔⛔ AND THE WORDING CONTRADICTED ITSELF: it said "not a statement about the repository" and then
// called zero Document nodes an INGESTION gap and prescribed re-indexing. A document-free repo
// produces the identical input. ef-manager's field evidence made it worse — in the motivating repo
// the three root documents PASS the historical predicate, so "re-index and it is fixed" was never
// established there either.
//
// ⇒ This matrix is the denominator: every state through every surface, in the harness that already
// exists rather than a fifth one-surface test.
// ⚠ EVERY CASE NOW SUPPLIES A TOTAL, and that is the contract rather than test bookkeeping. An
// absent total is UNKNOWN — the carrier no longer infers the population from the rendered sample,
// so a state can only be asserted when someone actually counted.
const STATES = [
  { name: 'graph_empty', documentCount: 0, total: 0, arr: [] },
  { name: 'indexed_without_link_candidates', documentCount: 42, total: 0, arr: [] },
  { name: 'candidates_present', documentCount: 42, total: 1, arr: [DOC] },
  { name: 'unknown', documentCount: null, total: null, arr: [] },
];

describe('the document-evidence state is typed, cross-surface and cause-neutral', () => {
  for (const st of STATES) {
    it(`★★★ ${st.name} — JSON carries counts AND state together`, () => {
      const j = renderJson({
        ...data(), readFirstArr: [], ...view(st.arr, st.total, [], st.documentCount),
      }, '/repo');
      expect(j.document_evidence.state).toBe(st.name);
      expect(j.document_evidence.indexed_document_count).toBe(st.documentCount);
      expect(j.document_evidence.linked_candidate_count).toBe(st.total);
    });
  }

  it('★★★ the compact surfaces are NOT silent on the two empty states', () => {
    // These are the artifacts read first, and silence there is what made the field case invisible.
    for (const documentCount of [0, 42]) {
      const d = { ...data(), readFirstArr: [], ...view([], 0, [], documentCount) };
      expect(renderAgentMarkdown(d), `agent brief, count=${documentCount}`).toMatch(/^DOCS:/m);
      expect(renderOnboardAgentMarkdown(d), `onboard, count=${documentCount}`).toMatch(/^DOCS:/m);
    }
  });

  it('★★★ graph_empty names NO cause and prescribes NO remedy', () => {
    // ⛔ The renderer knows the graph holds zero Document nodes. It does not know whether the
    // REPOSITORY holds any, and it has no carrier for the omission mechanism. Naming either would
    // be inferring a cause from absence — the thing the sentence beside it forbids.
    const md = renderMarkdown({ ...data(), readFirstArr: [], ...view([], 0, [], 0) });
    const sect = between(md, '## Linked document candidates', String.fromCharCode(10) + '## ');
    expect(sect, 'says what it observed').toMatch(/contains 0 Document nodes/);
    expect(sect, 'and says the cause is not established').toMatch(/NOT established/);
    expectAbsentWithLiveMatcher(
      /INGESTION gap|Re-index before/,
      { forbidden: 'That is an INGESTION gap, so Re-index before reading', allowed: 'Inspect the ingest corpus before treating' },
      sect,
      'no cause claim and no unconditional remedy',
    );
  });

  it('★★★ indexed_without_link_candidates does NOT claim the link layer is absent', () => {
    // Zero candidates is consistent with documents that genuinely carry no authored links, an
    // extractor that never ran, one that ran and produced zero, and edges purged since. This
    // carrier holds the result population, not producer liveness.
    const md = renderMarkdown({ ...data(), readFirstArr: [], ...view([], 0, [], 42) });
    const sect = between(md, '## Linked document candidates', String.fromCharCode(10) + '## ');
    expect(sect).toMatch(/42 document\(s\) indexed, 0 with indexed authored-link evidence/);
    expectAbsentWithLiveMatcher(
      /link layer is not/,
      { forbidden: 'the documents are here, the link layer is not', allowed: 'this carrier holds the result population' },
      sect,
      'no claim about a producer this carrier cannot see',
    );
  });

  it('★★★ UNKNOWN is consistent across surfaces — omitted in text, explicit in JSON', () => {
    // ⚠ Never guessed. A renderer with no count cannot tell the two empty states apart, so the text
    // surfaces say nothing and the payload says `unknown` rather than either of them.
    const d = { ...data(), readFirstArr: [], ...view([], null, [], null) };
    expectAbsentWithLiveMatcher(
      /## Linked document candidates/,
      { forbidden: '## Linked document candidates', allowed: '## Read first' },
      renderMarkdown(d),
      'no section when the count cannot be established',
    );
    expectAbsentWithLiveMatcher(
      /^DOCS:/m,
      { forbidden: 'DOCS: graph holds 0 Document nodes', allowed: 'READ:' },
      renderAgentMarkdown(d),
      'and no compact line either',
    );
    expect(renderJson(d, '/repo').document_evidence.state).toBe('unknown');
  });
});

// ⛔ TWO CONTRACT ATTACKS graph-senior-dev EXECUTED AGAINST 2de7fc4, kept as witnesses.
describe('the typed state carries a population, not a rendered sample', () => {
  it('★★★ JSON reports the candidate TOTAL, not the two that were rendered', () => {
    // ⛔ `linked_candidate_count` was `readFirstArr.filter(kind==="doc").length`, and `readFirst`
    // slices to two before returning. Measured on the real graph: population 89, reported 2.
    //
    // ★ A cap presented as a denominator — inside the typed state built to remove exactly that
    // defect, and the third time today. The first two were in code I inherited; this one I wrote.
    const d = { ...data(), readFirstArr: [SRC], ...view([DOC, DOC], 3, [], 10) };
    const ev = renderJson(d, '/repo').document_evidence;
    expect(ev.linked_candidate_count, 'the population').toBe(3);
    expect(ev.shown_candidate_count, 'and the sample, separately').toBe(2);
    expect(ev.state).toBe('candidates_present');
  });

  it('★★★ a capped list DISCLOSES the cap on the text surfaces', () => {
    // A cap nobody can see is a cap reported as a total one layer up.
    // ⚠ documentCount MUST exceed the candidate total or the invariant fires — my first version of
    // this fixture said 10 documents with 89 candidates and the new `inconsistent` state caught it.
    // The check earned its place on the test written to exercise a different property.
    const d = { ...data(), readFirstArr: [], ...view([DOC, DOC], 89, [], 160) };
    expect(renderMarkdown(d)).toMatch(/Showing 2 of 89/);
    expect(renderAgentMarkdown(d)).toMatch(/showing 2 of 89 linked candidates/i);
  });

  it('★★★ candidates_present is derived from the POPULATION, not the rendered array', () => {
    // ⚠ If the display slice were filtered downstream, the artifact reported
    // `indexed_without_link_candidates` while candidates existed. The state follows the evidence.
    const d = { ...data(), readFirstArr: [SRC], ...view([], 7, [], 10) };
    expect(renderJson(d, '/repo').document_evidence.state).toBe('candidates_present');
  });

  const IMPOSSIBLE = [
    { name: 'zero indexed but a candidate exists', documentCount: 0, total: 1 },
    { name: 'more candidates than documents', documentCount: 1, total: 2 },
    { name: 'a negative count', documentCount: -1, total: 0 },
  ];
  for (const c of IMPOSSIBLE) {
    it(`★★★ INCONSISTENT: ${c.name} — never serialized as a normal state`, () => {
      // ⛔ All three came back as confident answers before this: two as `candidates_present`, one as
      // `indexed_without_link_candidates`. A generated artifact publishing a contradiction as a fact
      // is worse than one publishing nothing — a consumer cannot tell it is holding an impossible
      // pair.
      const d = { ...data(), readFirstArr: [], ...view([], c.total, [], c.documentCount) };
      const ev = renderJson(d, '/repo').document_evidence;
      expect(ev.state, 'observed inconsistency is not absence').toBe('inconsistent');
      // ⚠ NOT collapsed to `unknown`. The values travel WITH the state so the contradiction is
      // auditable — but a count field is non-negative-integer-or-null, so a NEGATIVE input travels
      // as a diagnostic rather than sitting in the numeric field. This assertion used to demand
      // `-1` in `indexed_document_count`, which the contract now forbids: it was asserting the
      // shape the normalizer exists to prevent.
      const idx = ev.invalid_indexed_document_count
        ? Number(ev.invalid_indexed_document_count.repr) : ev.indexed_document_count;
      const lnk = ev.invalid_linked_candidate_count
        ? Number(ev.invalid_linked_candidate_count.repr) : ev.linked_candidate_count;
      expect(idx, 'the indexed value is recoverable either way').toBe(c.documentCount);
      expect(lnk, 'and so is the candidate value').toBe(c.total);
      expect(renderMarkdown(d), 'the text surface says so too').toMatch(/EVIDENCE INCONSISTENT/);
      expect(renderAgentMarkdown(d)).toMatch(/DOCS: evidence INCONSISTENT/);
    });
  }
});

// ⛔ THE POSITIONAL FALLBACK TRAVELLED AS LINK EVIDENCE, and the artifact contradicted itself.
//
// graph-senior-dev built a graph with two root Documents and zero edges. One artifact then said
// 0 linked candidates, 2 SHOWN candidates, and "Ranked by link prominence" — beside two entries
// whose own `why` read "position, not evidence". Three mutually exclusive statements in one section.
//
// ⇒ One producer was mixing two populations under one name. They are different evidence and now
// travel in different fields, so a consumer counting link evidence cannot be handed position.
// ⚠ Positional rows travel in their OWN data field now, never inside `readFirstArr`.
const POS = { file: 'AGENTS.md' };

describe('positional fallback is a separate population from linked evidence', () => {
  it('★★★ positional entries are NOT linked candidates and NOT read-first sources', () => {
    const d = { ...data(), readFirstArr: [SRC], ...view([], 0, [POS], 2) };
    const j = renderJson(d, '/repo');
    expect(j.linked_document_candidates, 'not link evidence').toEqual([]);
    expect(j.positional_document_fallback.map((r) => r.file), 'its own carrier').toEqual(['AGENTS.md']);
    // ⚠ `read_first` filtered on `kind !== 'doc'`, so a NEW doc kind fell into the source side. A
    // category added beside an inequality lands in whichever bucket the inequality does not name.
    expect(j.read_first.map((r) => r.file), 'and never the source side').toEqual(['src/server.js']);
  });

  it('★★★ shown-linked is 0 when only positional entries exist', () => {
    const d = { ...data(), readFirstArr: [], ...view([], 0, [POS, POS], 2) };
    const ev = renderJson(d, '/repo').document_evidence;
    expect(ev.shown_candidate_count, 'positional rows are not a linked sample').toBe(0);
    expect(ev.linked_candidate_count).toBe(0);
    expect(ev.state).toBe('indexed_without_link_candidates');
  });

  it('★★★ positional entries render under their OWN heading, not the link one', () => {
    const d = { ...data(), readFirstArr: [], ...view([], 0, [POS], 2) };
    const md = renderMarkdown(d);
    const pos = between(md, '## Root document fallback', String.fromCharCode(10) + '## ');
    expect(pos, 'a distinct heading is what stops the claim travelling').toMatch(/AGENTS\.md/);
    expect(pos).toMatch(/Position, NOT evidence/);
    const linked = between(md, '## Linked document candidates', String.fromCharCode(10) + '## ');
    expectAbsentWithLiveMatcher(
      /AGENTS\.md/,
      { forbidden: '- `AGENTS.md` — root-level document', allowed: '- `src/server.js` — 160 connections' },
      linked ?? '',
      'a positional row must not appear under a link-prominence heading',
    );
  });
});

// ⛔ A SUPPLIED-BUT-INVALID TOTAL WAS REPLACED BY THE SAMPLE BEFORE THE VALIDATOR SAW IT.
//
// `Number.isInteger(t) ? t : shown` meant 1.5, '3' and NaN all became the rendered count and came
// back as a confident `indexed_without_link_candidates`. The check could not detect a malformed
// total because the malformed total never reached it.
describe('malformed and contradictory totals fail closed', () => {
  const VECTORS = [
    { name: 'fractional total', total: 1.5 },
    { name: 'string total', total: '3' },
    { name: 'NaN total', total: NaN },
    // ⚠ Infinity has the same JSON behaviour as NaN and would have had the same false receipt.
    { name: 'Infinity total', total: Infinity },
  ];
  for (const v of VECTORS) {
    it(`★★★ ${v.name} is INCONSISTENT and carries its raw value`, () => {
      const d = { ...data(), readFirstArr: [], ...view([], v.total, [], 42) };
      // ⛔⛔ THROUGH THE ACTUAL CODEC. This asserted on the in-memory object, and `brief.json` is
      // produced with JSON.stringify: `JSON.parse(JSON.stringify({v: NaN}))` is `{v: null}`. So a
      // supplied NaN became indistinguishable from ABSENT in the published artifact — the exact
      // distinction `inconsistent` exists to preserve — while the test pinned a property the
      // artifact never had. A gate that runs before a destructive codec certifies the wrong object.
      const artifact = JSON.parse(JSON.stringify(renderJson(d, '/repo')));
      const ev = artifact.document_evidence;
      expect(ev.state).toBe('inconsistent');
      // The numeric field stays numeric-or-null; the malformed input travels JSON-safe beside it.
      expect(ev.linked_candidate_count, 'never a string or a NaN in a count field').toBeNull();
      expect(ev.invalid_linked_candidate_count.repr).toBe(String(v.total));
      expect(ev.invalid_linked_candidate_count.type).toBe(typeof v.total);
    });
  }

  it('★★★ shown exceeding the linked total is INCONSISTENT', () => {
    const d = { ...data(), readFirstArr: [], ...view([DOC, DOC], 1, [], 5) };
    expect(renderJson(d, '/repo').document_evidence.state).toBe('inconsistent');
  });

  it('★★★ an ABSENT total with shown items is candidates_present, total UNKNOWN', () => {
    // ⛔ Never sample-as-total. The population is unknown; that the sample is non-empty still proves
    // candidates exist, and those are two different facts.
    const d = { ...data(), readFirstArr: [], ...view([DOC, DOC], null, [], 5) };
    const ev = renderJson(d, '/repo').document_evidence;
    expect(ev.state).toBe('candidates_present');
    expect(ev.linked_candidate_count, 'not inferred from the sample').toBeNull();
    expect(ev.shown_candidate_count).toBe(2);
  });

  it('★★★ an ABSENT total with no shown items is UNKNOWN, not a confident zero', () => {
    const d = { ...data(), readFirstArr: [], ...view([], null, [], 5) };
    expect(renderJson(d, '/repo').document_evidence.state).toBe('unknown');
  });
});

// ⛔ THE WEAKER AUTHORITY WAS ERASING THE STRONGER ONE.
//
// Positional rows used to be pushed into `readFirst`'s accumulator and its `seen` dedupe BEFORE
// exports and source rows. graph-senior-dev executed the overlap: one root `AGENTS.md` with no
// links, plus an export-backed source fact for the SAME path. The positional row claimed `seen`
// first and the export fact was silently discarded — and the renderer's later re-split by kind
// could not recover it, because the row no longer existed.
//
// ⇒ Splitting by kind at RENDER time is presentation separation. This is PRODUCER separation: the
// positional population never enters the mixed array, so it cannot consume that array's dedupe or
// its limit.
describe('positional custody is separate from the source accumulator', () => {
  const EXPORT_BACKED = { file: 'AGENTS.md', why: 'backs an EXPORTS entry', kind: 'export' };
  const POSITIONAL = [{ file: 'AGENTS.md' }];

  it('★★★ one path can be BOTH positional and export-backed — neither erases the other', () => {
    const d = { ...data(), readFirstArr: [EXPORT_BACKED], ...view([], 0, POSITIONAL, 1) };
    const j = renderJson(d, '/repo');
    expect(j.read_first.map((r) => r.file), 'the stronger source fact survives').toEqual(['AGENTS.md']);
    expect(j.positional_document_fallback.map((r) => r.file), 'and position is reported separately')
      .toEqual(['AGENTS.md']);
    expect(j.linked_document_candidates, 'neither is link evidence').toEqual([]);
  });

  it('★★★ positional rows cannot consume the source population or its cap', () => {
    // They are not in `readFirstArr` at all, so a shrinking source limit cannot be spent on them.
    const d = {
      ...data(), readFirstArr: [SRC],
      ...view([], 0, [{ file: 'a.md' }, { file: 'b.md' }, { file: 'c.md' }], 3),
    };
    const j = renderJson(d, '/repo');
    expect(j.read_first.map((r) => r.file)).toEqual(['src/server.js']);
    expect(j.positional_document_fallback).toHaveLength(3);
    expect(j.document_evidence.shown_candidate_count, 'positional rows are not a linked sample').toBe(0);
  });
});

// ⛔ THE FIRST CODEC FIX COVERED THE SITE THE WITNESS NAMED, NOT THE CLASS.
//
// A malformed CANDIDATE total got a JSON-safe diagnostic. The malformed INDEXED count did not, and
// it crosses the same serializer. graph-senior-dev executed the wire artifact:
//
//     NaN      -> indexed_document_count: null    indistinguishable from ABSENT
//     Infinity -> indexed_document_count: null    same
//     1.5      -> indexed_document_count: 1.5     violates numeric-or-null
//     '3'      -> indexed_document_count: "3"     a STRING in a count field
//
// ★ An instance-shaped fix for a class-shaped defect — the pattern that cost 62,066 records earlier
// today, when a documented guard reached edge invalidation and not the record prune 600 lines away.
// I had the general lesson written down and still repaired one site.
describe('BOTH counts cross the codec identically', () => {
  const MALFORMED = [
    { name: 'NaN', value: NaN },
    { name: 'Infinity', value: Infinity },
    { name: 'fractional', value: 1.5 },
    { name: 'string', value: '3' },
  ];

  for (const m of MALFORMED) {
    it(`★★★ malformed INDEXED count (${m.name}) survives JSON as a diagnostic`, () => {
      const d = { ...data(), readFirstArr: [], ...view([], 0, [], m.value) };
      const wire = JSON.parse(JSON.stringify(renderJson(d, '/repo')));
      const ev = wire.document_evidence;
      expect(ev.state).toBe('inconsistent');
      expect(ev.indexed_document_count, 'numeric-or-null, never a string or a fraction').toBeNull();
      expect(ev.invalid_indexed_document_count.repr).toBe(String(m.value));
      expect(ev.invalid_indexed_document_count.type).toBe(typeof m.value);
    });
  }

  it('★★★ BOTH malformed — neither diagnostic erases the other', () => {
    const d = { ...data(), readFirstArr: [], ...view([], '3', [], NaN) };
    const ev = JSON.parse(JSON.stringify(renderJson(d, '/repo'))).document_evidence;
    expect(ev.invalid_indexed_document_count).toEqual({ type: 'number', repr: 'NaN' });
    expect(ev.invalid_linked_candidate_count).toEqual({ type: 'string', repr: '3' });
    expect(ev.indexed_document_count).toBeNull();
    expect(ev.linked_candidate_count).toBeNull();
  });

  it('★★★ CONTROL: valid counts carry NO diagnostic and are unchanged by the codec', () => {
    // ⛔ Without this, "always emit a diagnostic" passes every assertion above and every artifact
    // reports itself inconsistent — the permanent-warning failure this repo has already shipped
    // once, in a health check that warned on every repo.
    const d = { ...data(), readFirstArr: [], ...view([DOC], 89, [], 160) };
    const ev = JSON.parse(JSON.stringify(renderJson(d, '/repo'))).document_evidence;
    expect(ev.state).toBe('candidates_present');
    expect(ev.indexed_document_count).toBe(160);
    expect(ev.linked_candidate_count).toBe(89);
    expect(ev.invalid_indexed_document_count).toBeUndefined();
    expect(ev.invalid_linked_candidate_count).toBeUndefined();
  });

  it('★★★ the text surface shows WHICH value was wrong, for either count', () => {
    // A malformed indexed count used to render as a bare `null` — which absence also produces.
    const d = { ...data(), readFirstArr: [], ...view([], 0, [], NaN) };
    expect(renderMarkdown(d)).toMatch(/NaN \(number\) document\(s\) indexed/);
    expect(renderAgentMarkdown(d)).toMatch(/NaN \(number\) indexed/);
  });
});
