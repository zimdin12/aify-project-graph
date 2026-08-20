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
  renderMarkdown, renderAgentMarkdown, renderOnboardAgentMarkdown, renderJson,
} from '../../../mcp/stdio/brief/render.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

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
  readFirstArr: [SRC, DOC],
  documentCount: 3,
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
    const d = { ...data(), readFirstArr: [DOC] };
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
const STATES = [
  { name: 'graph_empty', documentCount: 0, arr: [] },
  { name: 'indexed_without_link_candidates', documentCount: 42, arr: [] },
  { name: 'candidates_present', documentCount: 42, arr: [DOC] },
  { name: 'unknown', documentCount: null, arr: [] },
];

describe('the document-evidence state is typed, cross-surface and cause-neutral', () => {
  for (const st of STATES) {
    it(`★★★ ${st.name} — JSON carries counts AND state together`, () => {
      const j = renderJson({ ...data(), documentCount: st.documentCount, readFirstArr: st.arr }, '/repo');
      expect(j.document_evidence.state).toBe(st.name);
      expect(j.document_evidence.indexed_document_count).toBe(st.documentCount);
      expect(j.document_evidence.linked_candidate_count).toBe(st.arr.length);
    });
  }

  it('★★★ the compact surfaces are NOT silent on the two empty states', () => {
    // These are the artifacts read first, and silence there is what made the field case invisible.
    for (const documentCount of [0, 42]) {
      const d = { ...data(), documentCount, readFirstArr: [] };
      expect(renderAgentMarkdown(d), `agent brief, count=${documentCount}`).toMatch(/^DOCS:/m);
      expect(renderOnboardAgentMarkdown(d), `onboard, count=${documentCount}`).toMatch(/^DOCS:/m);
    }
  });

  it('★★★ graph_empty names NO cause and prescribes NO remedy', () => {
    // ⛔ The renderer knows the graph holds zero Document nodes. It does not know whether the
    // REPOSITORY holds any, and it has no carrier for the omission mechanism. Naming either would
    // be inferring a cause from absence — the thing the sentence beside it forbids.
    const md = renderMarkdown({ ...data(), documentCount: 0, readFirstArr: [] });
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
    const md = renderMarkdown({ ...data(), documentCount: 42, readFirstArr: [] });
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
    const d = { ...data(), documentCount: null, readFirstArr: [] };
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
