// ⛔ THE DOC SECTION OF THE BRIEF AN AGENT READS FIRST WAS EMPTY, AND HAD BEEN FOR THE REPO'S LIFE.
//
// `readFirst` picked documents with
//     WHERE type = 'Document' AND label IN ('ARCHITECTURE.md','DESIGN.md','DEVELOPMENT.md')
// Measured on this repo, with both controls in the same run:
//
//     Document nodes                                     155
//     matching that allowlist                              0
//     negative control (a name nobody has)                 0
//
// The recorded figure was 0 of 74. The doc-corpus fix doubled the population and changed nothing,
// because the outcome was never about how many documents exist — it was about three names.
//
// ★ AND IT LABELLED WHATEVER IT RETURNED "architecture doc" — a claim about the document's KIND
// that nothing in the graph supported. True of the allowlist's intent and of no row it ever
// returned, which is why nobody noticed the section was empty: the code read as if it worked.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFirst } from '../../../mcp/stdio/brief/graph-shape.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let root;
afterEach(async () => {
  if (root) { try { await rm(root, { recursive: true, force: true }); } catch { /* win lock */ } }
  root = undefined;
});

async function graph() {
  root = await mkdtemp(join(tmpdir(), 'apg-readfirst-'));
  await mkdir(join(root, '.aify-graph'), { recursive: true });
  const db = openDb(join(root, '.aify-graph', 'graph.sqlite'));
  db.node = (id, type, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,$t,$l,$f,1,1,'',1,'{}')`,
    { id, t: type, l: file.split('/').pop(), f: file });
  db.link = (from, to) => db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ($f,$t,'LINKS_TO','x',1,1,'EXTRACTED','doc_link:markdown')`, { f: from, t: to });
  return db;
}

const docsOf = (db) => readFirst(db, 6, {}).filter((r) => r.kind === 'doc');
// ⚠ POSITIONAL ENTRIES ARE A DIFFERENT KIND NOW. They used to be pushed as `kind: 'doc'` carrying
// disclaiming prose, so every consumer counting doc-evidence counted them and only a human reading
// the sentence could tell. The distinction lives in the data; these tests read it from there.
const positionalOf = (db) => readFirst(db, 6, {}).filter((r) => r.kind === 'doc-position');

describe('the brief picks orienting documents by evidence, not by name', () => {
  it('★★★ a document matching NO expected name is returned — that IS the defect', async () => {
    // ⛔ THE DISCRIMINATING CASE. Under the allowlist this returned nothing at all, because the
    // repo's real orienting document is called something the list did not anticipate. Any fix that
    // merely ADDED names to the list would still fail here.
    const db = await graph();
    db.node('d1', 'Document', 'ORIENTATION-FOR-NEWCOMERS.md');
    db.node('c1', 'File', 'src/a.js');
    db.node('c2', 'File', 'src/b.js');
    db.link('d1', 'c1'); db.link('d1', 'c2');

    const docs = docsOf(db);
    expect(docs.length, 'a document that references code is an orienting document').toBe(1);
    expect(docs[0].file).toBe('ORIENTATION-FOR-NEWCOMERS.md');
    expect(docs[0].why, 'and the why carries its evidence, not a claim about its kind')
      .toMatch(/2 repository file\(s\) referenced/);
    db.close();
  }, 30_000);

  it('★★★ an expected NAME with no evidence loses to an unexpected name with evidence', async () => {
    // ⛔ THE CONTROL THAT PROVES THE ALLOWLIST IS GONE RATHER THAN DEMOTED. A fix that kept the
    // three names as a preference would pass the test above and fail this one.
    const db = await graph();
    db.node('arch', 'Document', 'ARCHITECTURE.md');       // the old allowlist's favourite
    db.node('other', 'Document', 'notes-on-the-thing.md');
    db.node('c1', 'File', 'src/a.js');
    db.link('other', 'c1');                                // only `other` references code

    const docs = docsOf(db);
    expect(docs.map((d) => d.file), 'evidence beats the name it used to require')
      .toEqual(['notes-on-the-thing.md']);
    db.close();
  }, 30_000);

  it('★★★ CANONICALITY outranks coverage — a big superseded plan loses to a linked README', async () => {
    // ⛔ MEASURED, NOT HYPOTHETICAL. Ordering by code references alone put
    // `docs/superpowers/plans/2026-04-16-...-v1.md` (36 refs) ABOVE README.md (27) on this repo.
    // Honest about what each describes, and bad orientation advice: high outbound degree means
    // "describes a lot of code", never "describes the code as it is now".
    //
    // ⇒ Inbound doc→doc links are the derived answer to a different question — which documents the
    // DOCUMENTS THEMSELVES treat as canonical. Primary sort, with coverage as the tiebreak.
    const db = await graph();
    db.node('readme', 'Document', 'README.md');
    db.node('plan', 'Document', 'docs/plans/old-v1.md');
    for (let i = 0; i < 5; i += 1) {           // the plan describes MORE code
      db.node(`p${i}`, 'File', `src/p${i}.js`);
      db.link('plan', `p${i}`);
    }
    db.node('r0', 'File', 'src/r0.js');
    db.link('readme', 'r0');                    // README describes less...
    db.node('o1', 'Document', 'other1.md');
    db.node('o2', 'Document', 'other2.md');
    db.link('o1', 'readme'); db.link('o2', 'readme');   // ...but the docs point AT it

    const docs = docsOf(db);
    expect(docs[0].file, 'the document other documents point to comes first').toBe('README.md');
    expect(docs[0].why).toMatch(/2 document\(s\) link here/);
    db.close();
  }, 30_000);

  it('★★★ no doc references code → root-level docs, and the why SAYS the basis changed', async () => {
    // ⛔ THREE STATES, NOT TWO. "No document references code" is a different answer from "here are
    // the orienting documents", and an empty section collapses them — it reads as "this repo has
    // no docs" when it may mean the doc layer has never been built. The distinction is what tells
    // a reader whether to go build it.
    const db = await graph();
    db.node('a', 'Document', 'README.md');
    db.node('b', 'Document', 'docs/deep/buried.md');
    db.node('c1', 'File', 'src/a.js');          // code exists; nothing links to it

    expect(docsOf(db), 'nothing qualifies as LINK evidence').toEqual([]);
    const pos = positionalOf(db);
    expect(pos.map((d) => d.file), 'root-level only, in its own carrier').toEqual(['README.md']);
    expect(pos[0].why, 'and it refuses to present position as evidence')
      .toMatch(/position, not evidence/);
    db.close();
  }, 30_000);

  it('★★★ REVERSED: a doc index other documents point AT is eligible with no code refs', async () => {
    // ⛔⛔ THIS TEST USED TO ASSERT THE OPPOSITE, AND IT PINNED A DEFECT.
    //
    // It read "doc→doc links alone do not qualify a document as orienting", and it passed because
    // the candidate query joined from the candidate to a NON-Document target — so a document could
    // not be a candidate unless it referenced code. graph-senior-dev executed the consequence:
    //
    //     other.md LINKS_TO docs/index.md, and the index has no outgoing code edge
    //     -> result: [{"file":"other.md","why":"root-level document; ... position, not evidence"}]
    //
    // The inbound-linked index was ABSENT and the unrelated source document won on root position,
    // which directly contradicts "which documents the DOCUMENTS treat as the entry point".
    //
    // ★ I wrote the test, it agreed with the code, and the agreement was the bug. A test written
    // from the implementation cannot catch the implementation — it can only lock it in.
    const db = await graph();
    db.node('idx', 'Document', 'docs/index.md');
    db.node('other', 'Document', 'other.md');
    db.link('other', 'idx');                    // the index is pointed AT and references no code

    const docs = docsOf(db);
    expect(docs.map((d) => d.file), 'inbound authority alone is evidence').toContain('docs/index.md');
    expect(docs[0].file, 'and it outranks the document that merely links to it').toBe('docs/index.md');
    db.close();
  }, 30_000);
});

// ⛔ INBOUND LINKS COLLAPSE TO ZERO ON A REPO WHOSE DOCUMENTS DO NOT CROSS-LINK, and there the
// superseded-plan problem returns: coverage alone put a four-month-old v1 plan (36 code refs) above
// README (27) on this repo. So recency is the second ordered signal.
//
// ★ ef-manager REFUTED THE OBVIOUS ALTERNATIVE WITH DATA BEFORE PROPOSING THIS ONE. Their
// hypothesis was that a stale document's references fail to resolve. Measured, it ANTI-CORRELATES:
// four-month-old plans resolve at 65-86% while documents updated this month resolve at 28-29%,
// because resolution rate is a GENRE signal — a plan is nearly all code references, a README is
// prose about commands and external projects. It measures "how much of this document is code
// references" and reads as "how much of this is still true".
describe('recency decides when no document is treated as canonical', () => {
  it('★★★ tied inbound → the recently-changed document wins over the bigger stale one', async () => {
    const db = await graph();
    db.node('plan', 'Document', 'docs/plans/old-v1.md');
    db.node('readme', 'Document', 'README.md');
    for (let i = 0; i < 5; i += 1) {           // the stale plan describes MORE code
      db.node(`p${i}`, 'File', `src/p${i}.js`);
      db.link('plan', `p${i}`);
    }
    db.node('r0', 'File', 'src/r0.js');
    db.link('readme', 'r0');
    // ⚠ NOBODY links to either — inbound is 0 for both, which is the case that defeats signal 1.
    const docRecency = new Map([['README.md', '2026-08-20'], ['docs/plans/old-v1.md', '2026-04-16']]);

    const withRecency = readFirst(db, 6, { docRecency }).filter((r) => r.kind === 'doc');
    expect(withRecency[0].file, 'recently changed beats larger-but-stale').toBe('README.md');
    expect(withRecency[0].why).toMatch(/last edited 2026-08-20/);

    // ⛔ THE CONTROL THAT PROVES RECENCY IS DOING THE WORK. Without it the ordering INVERTS — so
    // this pair shows the signal changes the answer, rather than agreeing with one already correct.
    const without = readFirst(db, 6, {}).filter((r) => r.kind === 'doc');
    expect(without[0].file, 'without recency, raw coverage wins and the stale plan leads')
      .toBe('docs/plans/old-v1.md');
    db.close();
  }, 30_000);

  it('★★★ UNKNOWN recency sorts LAST, not oldest', async () => {
    // ⛔ A document git cannot date — untracked, or no git at all — has no recency evidence.
    // Treating "cannot tell" as "ancient" is the two-state collapse this repo found eight times in
    // one session, and it would bury a brand-new untracked design doc beneath everything.
    const db = await graph();
    db.node('dated', 'Document', 'dated.md');
    db.node('undated', 'Document', 'undated.md');
    db.node('c1', 'File', 'src/a.js'); db.node('c2', 'File', 'src/b.js');
    db.link('dated', 'c1');
    db.link('undated', 'c1'); db.link('undated', 'c2');   // undated describes MORE code

    const docs = readFirst(db, 6, { docRecency: new Map([['dated.md', '2020-01-01']]) })
      .filter((r) => r.kind === 'doc');
    expect(docs[0].file, 'a dated document outranks an undated one even when older').toBe('dated.md');
    expect(docs.map((d) => d.file), 'and the undated one is kept, not dropped').toContain('undated.md');
    db.close();
  }, 30_000);

  it('★★★ the why never claims accuracy', async () => {
    // Degree means "describes a lot of code"; recency means "was edited recently". Neither means
    // "is correct", and this session found three comments that were prominent, adjacent and false.
    const db = await graph();
    db.node('d', 'Document', 'X.md');
    db.node('c', 'File', 'src/a.js');
    db.link('d', 'c');
    const docs = readFirst(db, 6, {}).filter((r) => r.kind === 'doc');
    expect(docs[0].why).toMatch(/evidence of relevance, not of accuracy/);
    db.close();
  }, 30_000);
});

// ⛔ THE HOSTILE WITNESSES graph-senior-dev EXECUTED AGAINST 900b7bb, kept as tests so the two
// defects cannot return quietly.
describe('the ranking sees the whole population and only its own authority', () => {
  it('★★★ recency ranks EVERY candidate, not a pre-truncated sample', async () => {
    // ⛔ The first version took `LIMIT 12` in SQL ordered by inbound/degree, then applied recency in
    // JS — so recency was the second key over the top-12-by-a-different-order, not over documents.
    // Dev's fixture, reproduced: 13 documents, all inbound 0, degree descending, and the NEWEST
    // holding the LOWEST degree so it falls outside any degree-ordered window.
    const db = await graph();
    const docRecency = new Map();
    for (let i = 0; i < 13; i += 1) {
      const f = `docs/d${String(i).padStart(2, '0')}.md`;
      db.node(`d${i}`, 'Document', f);
      for (let j = 0; j < 13 - i; j += 1) {          // degree 13 down to 1
        db.node(`c${i}_${j}`, 'File', `src/c${i}_${j}.js`);
        db.link(`d${i}`, `c${i}_${j}`);
      }
      docRecency.set(f, i === 12 ? '2099-01-01' : '2000-01-01');
    }
    const docs = readFirst(db, 6, { docRecency }).filter((r) => r.kind === 'doc');
    expect(docs[0].file, 'the newest document must reach the sort at all').toBe('docs/d12.md');
    db.close();
  }, 30_000);

  it('★★★ legacy MENTIONS are REPORTED but never ranked on', async () => {
    // ⚠ The counts used to include every relation from any Document source, so the retiring legacy
    // MENTIONS population influenced ranking silently — 532 authored LINKS_TO against 99 legacy
    // MENTIONS on this repo, combined under one label. Two authorities under one number is how a
    // figure stops meaning anything.
    const db = await graph();
    db.node('linked', 'Document', 'linked.md');
    db.node('mentioner', 'Document', 'mentioner.md');
    db.node('c1', 'File', 'src/a.js');
    db.link('linked', 'c1');                                   // ONE authored link
    for (let i = 0; i < 20; i += 1) {                          // TWENTY legacy mentions
      db.node(`s${i}`, 'Function', 'src/a.js');
      db.run(`INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
              VALUES ('mentioner','s${i}','MENTIONS','x',1,1,'EXTRACTED','doc_ref:qualified')`);
    }
    const docs = readFirst(db, 6, {}).filter((r) => r.kind === 'doc');
    expect(docs[0].file, 'one authored link outranks twenty mentions').toBe('linked.md');
    expect(docs.map((d) => d.file), 'a mentions-only document is not a candidate')
      .not.toContain('mentioner.md');
    db.close();
  }, 30_000);

  it('★★★ a non-authored LINKS_TO edge does not confer authority', async () => {
    // Extractor-scoped: only `doc_link:*` edges are this ranking's evidence. Another producer's
    // LINKS_TO is not ours to read as an authored link — the same boundary the extractor-ownership
    // gate enforces for DELETEs.
    const db = await graph();
    db.node('a', 'Document', 'a.md');
    db.node('c1', 'File', 'src/a.js');
    db.run(`INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
            VALUES ('a','c1','LINKS_TO','x',1,1,'EXTRACTED','some-other-producer')`);
    expect(docsOf(db), 'a foreign extractor confers no link evidence').toEqual([]);
    expect(positionalOf(db)[0].why, 'falls through to the positional carrier')
      .toMatch(/position, not evidence/);
    db.close();
  }, 30_000);

  it('★★★ equal-length paths break lexically, so the brief stays byte-deterministic', async () => {
    // `a.file.length - b.file.length` returns 0 for equal-length paths and leaves order dependent
    // on SQLite row order — the same graph would render two different briefs.
    const db = await graph();
    db.node('z', 'Document', 'docs/zzz.md');
    db.node('a', 'Document', 'docs/aaa.md');
    db.node('c1', 'File', 'src/a.js');
    db.link('z', 'c1'); db.link('a', 'c1');
    const first = readFirst(db, 6, {}).filter((r) => r.kind === 'doc').map((d) => d.file);
    const second = readFirst(db, 6, {}).filter((r) => r.kind === 'doc').map((d) => d.file);
    expect(first, 'ties resolve lexically').toEqual(['docs/aaa.md', 'docs/zzz.md']);
    expect(second, 'and repeatably').toEqual(first);
    db.close();
  }, 30_000);

  it('★★★ a stale top answer DISCLOSES how much of the corpus is newer', async () => {
    // ⛔ ef-manager field-tested the ranking on echoes_of_the_fallen, whose CLAUDE.md line 3 says
    // verbatim "Read AGENTS.md first" — so the answer is written down, not judged:
    //
    //     rank 1  docs/contracts/worldbuffer-authority.md   2026-04-27
    //     AGENTS.md                                         NOT IN TOP 12 · 2026-08-19
    //
    // Inbound selects the most-CITED document; "read first" wants the one that ORIENTS you, and in
    // a contract-heavy repo those are different genres. Frozen contracts accrue citations while
    // never being edited, so inbound rank and staleness correlate POSITIVELY.
    //
    // ⇒ I have no graded replacement, so the remedy is DISCLOSURE rather than a silent re-sort on a
    // signal I cannot defend. The reader applies the correction the ranking cannot.
    const db = await graph();
    db.node('old', 'Document', 'contract.md');
    db.node('c1', 'File', 'src/a.js');
    db.link('old', 'c1');
    for (let i = 0; i < 4; i += 1) {                 // four citers, so `contract.md` ranks first
      db.node(`n${i}`, 'Document', `newer${i}.md`);
      db.link(`n${i}`, 'old');
      db.link(`n${i}`, 'c1');
    }
    const docRecency = new Map([['contract.md', '2026-01-01']]);
    for (let i = 0; i < 4; i += 1) docRecency.set(`newer${i}.md`, '2026-08-01');

    const docs = readFirst(db, 6, { docRecency }).filter((r) => r.kind === 'doc');
    expect(docs[0].file, 'the most-cited document still leads — the evidence is real').toBe('contract.md');
    expect(docs[0].why, 'and it names the population it counted')
      .toMatch(/4 linked candidate\(s\) are newer/);
    db.close();
  }, 30_000);
});
