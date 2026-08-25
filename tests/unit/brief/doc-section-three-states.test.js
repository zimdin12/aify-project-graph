// ⛔ AN EMPTY DOC SECTION MEANT TWO DIFFERENT THINGS AND SAID NEITHER.
//
// the field test found it while grading the ranking on other corpora: a repo with 15,628 nodes, 50,527
// edges and ZERO Document nodes, whose AGENTS.md, CLAUDE.md and README.md all exist on disk. The
// brief's doc section rendered EMPTY — indistinguishable from a repo that genuinely has no
// documents, when the real state was that the doc layer had never ingested any.
//
// ⇒ Those two states want OPPOSITE actions from the reader. One is nothing to do; the other is go
// re-index. Collapsing them hands the reader the reassuring one.
//
// ★ AND IT WAS IN THE FALLBACK I HAD SHIPPED TWO COMMITS EARLIER as a three-state fix. I covered
// "documents exist but none reference code" and never asked what happens when there are no
// documents at all — the third state was invisible from inside a repo that has 155 of them.
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../../mcp/stdio/brief/render.js';
import { buildDocumentView } from '../../../mcp/stdio/brief/document-view.js';

// ⇒ Documents arrive through the canonical view; `readFirstArr` is source evidence only.
const view = (items = [], total = null, documentCount = null) => ({
  documentView: buildDocumentView({ linkedCandidates: { items, total }, documentCount }),
  documentCount,
  documentCandidateCount: total,
});
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

/** The minimum shape renderAgentBrief needs, so each case differs only in what it is about. */
const baseData = (over = {}) => ({
  snapshot: {
    nodes: 10, edges: 5, commit: 'abc1234', indexedAt: '2026-08-20T00:00:00Z', languages: [],
  },
  entries: [],
  subs: [],
  hubsArr: [],
  readFirstArr: [],
  tests: [],
  risksArr: [],
  recent: [],
  health: { level: 'ok', issues: [] },
  overlayHealth: null,
  ...view([], null, null),
  ...over,
});

const section = (md) => {
  const i = md.indexOf('## Linked document candidates');
  return i === -1 ? null : md.slice(i, md.indexOf('\n##', i + 5) === -1 ? undefined : md.indexOf('\n##', i + 5));
};

describe('the doc section distinguishes its three states', () => {
  it('★★★ ZERO Document nodes reports the OBSERVATION and names no cause', async () => {
    // ⛔⛔ THIS TEST USED TO ASSERT `/INGESTION gap/` AND IT WAS PINNING A DEFECT — the second time
    // today one of my tests certified the thing a reviewer then removed.
    //
    // The renderer knows the GRAPH holds zero Document nodes. It does not know whether the
    // REPOSITORY holds any: a document-free repo produces the identical input. Calling that an
    // ingestion gap and prescribing a re-index infers a cause from absence, in the same breath as
    // a sentence saying not to — and the field test's field evidence killed the remedy too, since the
    // motivating repo's three root documents PASS the historical predicate.
    const md = renderMarkdown(baseData({ ...view([], 0, 0) }));
    const s = section(md);
    expect(s, 'the section must appear at all — silence is the defect').toBeTruthy();
    expect(s, 'states what was observed').toMatch(/contains 0 Document nodes/);
    expect(s, 'and that the cause is not established').toMatch(/NOT established/);
  }, 20_000);

  it('★★★ documents present but none linked says so, and names the count', async () => {
    // A different answer with a different action: the documents are indexed, the LINK layer is not
    // built. A reader who sees "no documents" here goes and re-indexes something that is fine.
    const md = renderMarkdown(baseData({ ...view([], 0, 42) }));
    const s = section(md);
    expect(s).toMatch(/42 document\(s\) indexed, 0 with indexed authored-link evidence/);
    // ⚠ AND IT NAMES NO PRODUCER. This used to assert "the link layer is not" — a claim about an
    // extractor the renderer cannot see. Zero candidates is equally consistent with documents that
    // genuinely carry no authored links, an extractor that never ran, one that produced zero, and
    // edges purged since.
    expect(s, 'lists the alternatives instead of picking one').toMatch(/result population, not producer liveness/);
  }, 20_000);

  it('★★★ candidates present render them and make no ingestion claim', async () => {
    // ⛔ THE CONTROL. Without it, "always explain the empty case" is satisfied by a renderer that
    // explains it even when there is nothing empty — the permanent-warning failure this repo has
    // already shipped once.
    const md = renderMarkdown(baseData({
      readFirstArr: [],
      ...view([{ file: 'README.md', why: '7 document(s) link here', kind: 'doc' }], 1, 42),
    }));
    const s = section(md);
    expect(s).toMatch(/README\.md/);
    // ⚠ Through the live matcher: a bare negative passes when the thing is absent AND when the
    // pattern is broken, and those are indistinguishable. The canaries prove it can fire and that
    // it discriminates before the prohibition is worth anything.
    expectAbsentWithLiveMatcher(
      /INGESTION gap/i,
      { forbidden: 'that is an INGESTION gap, not a', allowed: 'ranked by link prominence' },
      s,
      'no ingestion advice when there is evidence to show',
    );
  }, 20_000);

  it('★★★ an UNKNOWN count says nothing rather than guessing which state it is', async () => {
    // ⚠ A renderer given no count cannot tell the two apart, and inventing either would be the
    // collapse this file exists to prevent. `documentCount` defaults to null — three states, and
    // the third is "cannot answer".
    // ⚠ A view with UNKNOWN counts, not an ABSENT view. Those are different failures now: absent
    // means the caller never built the model and the renderer refuses; unknown means the model was
    // built and could not establish a count. The old fixture conflated them by omitting the view.
    const md = renderMarkdown(baseData({ ...view([], null, null) }));
    expect(section(md), 'no count, no claim').toBeNull();
  }, 20_000);

  it('★★★ the doc entries never appear under the READ FIRST heading', async () => {
    // The withdrawn claim, pinned. Source entries keep that heading; documents must not rejoin it,
    // and a shared section would restore the claim by omission.
    const md = renderMarkdown(baseData({
      readFirstArr: [{ file: 'src/server.js', why: '160 connections', kind: 'high-degree' }],
      ...view([{ file: 'README.md', why: '7 document(s) link here', kind: 'doc' }], 1, 3),
    }));
    const readSection = md.slice(md.indexOf('## Read first'), md.indexOf('## Linked document'));
    expect(readSection).toMatch(/src\/server\.js/);
    expectAbsentWithLiveMatcher(
      /README\.md/,
      { forbidden: '- `README.md` — 7 document(s) link here', allowed: '- `src/server.js` — 160 connections' },
      readSection,
      'a document must not sit under a read-order heading',
    );
  }, 20_000);
});
