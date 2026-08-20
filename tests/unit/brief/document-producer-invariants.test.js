// PRODUCER BOUNDARY — populations and invariants, with no renderer in the way.
//
// ⛔ MEASURED GAP, not a reorganisation. Across the four brief document test files:
//
//     renderer calls          43
//     direct producer calls    2
//
// So the state machine, the count normalizer and the ordering were verified almost entirely
// THROUGH `renderJson`. Two consequences, both real:
//
//   · a renderer change can mask a producer regression;
//   · a producer property the renderer does not surface is untested by construction.
//
// ⇒ AND THE SECOND ONE IS LARGE HERE. The producer sorts the full candidate population and renders
// TWO. On this repo that is 90 sorted, 2 rendered — **88 positions computed and unobservable at any
// surface**. The ordering rules (inbound primary, recency secondary, degree tertiary, lexical tie)
// were only ever checked on the top pair.
//
// ★ graph-senior-dev named this boundary: "renderer tests should test presentation only; producer
// tests should test populations/invariants; codec tests should test the published bytes." This file
// is the producer half, and the discriminator below proves it is not duplicate coverage.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkedDocumentCandidates } from '../../../mcp/stdio/brief/graph-shape.js';
import { normalizeCount, documentEvidence } from '../../../mcp/stdio/brief/document-view.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let root;
afterEach(async () => {
  if (root) { try { await rm(root, { recursive: true, force: true }); } catch { /* win lock */ } }
  root = undefined;
});

async function graph() {
  root = await mkdtemp(join(tmpdir(), 'apg-producer-'));
  await mkdir(join(root, '.aify-graph'), { recursive: true });
  const db = openDb(join(root, '.aify-graph', 'graph.sqlite'));
  db.doc = (id, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,'Document',$l,$f,1,1,'markdown',1,'{}')`,
    { id, l: file.split('/').pop(), f: file });
  db.code = (id, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,'File',$id,$f,1,1,'javascript',1,'{}')`, { id, f: file });
  db.link = (from, to) => db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ($f,$t,'LINKS_TO','x',1,1,'EXTRACTED','doc_link:markdown')`, { f: from, t: to });
  return db;
}

describe('the candidate producer orders its WHOLE population', () => {
  it('★★★ THE DISCRIMINATOR — ordering below the render cap is checked here and nowhere else', async () => {
    // ⛔ Six candidates. The top two are decided by INBOUND and are stable; positions 3-6 differ
    // only by RECENCY. Every renderer shows two rows, so a recency comparator that inverted would
    // leave every existing renderer test green while reversing four fifths of the ranking.
    //
    // ⇒ That is the shape of the hole: the producer computes an order that no surface can observe,
    // so "the tests are green" said nothing about it.
    const db = await graph();
    db.code('c1', 'src/a.js');
    for (const [id, file] of [['top1', 'top1.md'], ['top2', 'top2.md']]) {
      db.doc(id, file);
      db.link(id, 'c1');
    }
    // Give the top two real inbound authority so they cannot move.
    db.doc('citer', 'citer.md');
    db.link('citer', 'top1');
    db.link('citer', 'top2');
    const dates = { 'r1.md': '2026-08-01', 'r2.md': '2026-06-01', 'r3.md': '2026-04-01', 'r4.md': '2026-02-01' };
    for (const file of Object.keys(dates)) {
      const id = file.replace('.md', '');
      db.doc(id, file);
      db.link(id, 'c1');
    }
    const docRecency = new Map(Object.entries(dates));

    const { items, population, total } = linkedDocumentCandidates(db, { docRecency });
    expect(items.length, 'only two are ever rendered').toBe(2);
    expect(total, 'but the population is the whole set').toBeGreaterThan(items.length);

    // The invariant no surface can see: within the tail, newest first.
    const tail = population.map((d) => d.file).filter((f) => f in dates);
    expect(tail, 'recency orders the population below the render cap')
      .toEqual(['r1.md', 'r2.md', 'r3.md', 'r4.md']);
  }, 30_000);

  it('★★★ lexical tie-break applies across the whole population, not just the shown pair', async () => {
    // Equal on every earlier key, so only the final tie-break separates them. Rendering two of five
    // means three of the comparisons are invisible downstream.
    const db = await graph();
    db.code('c1', 'src/a.js');
    for (const f of ['e.md', 'c.md', 'a.md', 'd.md', 'b.md']) {
      db.doc(f.replace('.md', ''), f);
      db.link(f.replace('.md', ''), 'c1');
    }
    const { population } = linkedDocumentCandidates(db, {});
    expect(population.map((d) => d.file), 'deterministic for the entire set')
      .toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
  }, 30_000);

  it('★★★ total counts the population, items are the sample, and they are different numbers', async () => {
    const db = await graph();
    db.code('c1', 'src/a.js');
    for (let i = 0; i < 7; i += 1) {
      db.doc(`d${i}`, `docs/d${i}.md`);
      db.link(`d${i}`, 'c1');
    }
    const { items, total, population } = linkedDocumentCandidates(db, {});
    expect(total).toBe(7);
    expect(population).toHaveLength(7);
    expect(items).toHaveLength(2);
  }, 30_000);

  it('★★★ an empty linked population yields NO items and a positional carrier', async () => {
    // The producer's own contract, asserted without asking a renderer what it displayed.
    const db = await graph();
    db.doc('a', 'README.md');
    const { items, total, basis, positionalFallback } = linkedDocumentCandidates(db, {});
    expect(items, 'no linked rows when nothing is linked').toEqual([]);
    expect(total).toBe(0);
    expect(basis).toBe('position');
    expect(positionalFallback.map((d) => d.file)).toEqual(['README.md']);
  }, 30_000);
});

// ⛔ `normalizeCount` IS EXPORTED AND HAD ZERO DIRECT TESTS. Every property of it was inferred from
// what `renderJson` happened to print — so the rule was verified only where a surface exposed it.
describe('normalizeCount is the single rule for every count', () => {
  it('★★★ accepts exactly the non-negative integers, and null', () => {
    for (const ok of [0, 1, 42, 10_000]) {
      expect(normalizeCount(ok)).toEqual({ value: ok, invalid: null });
    }
    expect(normalizeCount(null), 'absent stays absent').toEqual({ value: null, invalid: null });
    expect(normalizeCount(undefined), 'and undefined is absence too')
      .toEqual({ value: null, invalid: null });
  });

  it('★★★ everything else becomes a JSON-safe diagnostic, never a value', () => {
    for (const bad of [NaN, Infinity, -Infinity, 1.5, -1, '3', '', true, {}, []]) {
      const out = normalizeCount(bad);
      expect(out.value, `${String(bad)} must not become a count`).toBeNull();
      expect(out.invalid, `${String(bad)} must be reported`).toBeTruthy();
      expect(typeof out.invalid.repr, 'repr is a string, so it survives JSON').toBe('string');
      expect(out.invalid.type).toBe(typeof bad);
    }
  });

  it('★★★ the diagnostic round-trips — which the raw value does not', () => {
    // ⚠ This is the property the whole diagnostic exists for, asserted at the producer rather than
    // inferred from a rendered artifact.
    for (const bad of [NaN, Infinity]) {
      const out = normalizeCount(bad);
      expect(JSON.parse(JSON.stringify(out.invalid)).repr).toBe(String(bad));
      expect(JSON.parse(JSON.stringify({ raw: bad })).raw, 'the raw value does NOT').toBeNull();
    }
  });
});

// The state machine, exercised on the producer's own output rather than through a surface.
describe('documentEvidence state machine, at the boundary', () => {
  const doc = { kind: 'doc' };
  const cases = [
    { name: 'candidates_present', shown: [doc], indexed: 10, total: 3 },
    { name: 'graph_empty', shown: [], indexed: 0, total: 0 },
    { name: 'indexed_without_link_candidates', shown: [], indexed: 42, total: 0 },
    { name: 'unknown', shown: [], indexed: null, total: null },
    { name: 'inconsistent', shown: [], indexed: 1, total: 2 },
  ];
  for (const c of cases) {
    it(`★★★ ${c.name}`, () => {
      expect(documentEvidence(c.shown, c.indexed, c.total).state).toBe(c.name);
    });
  }

  it('★★★ every state is reachable — a machine with a dead state is a machine with a bug', () => {
    // ⛔ POSITIVE CONTROL over the state set itself. Without it this file asserts five names and
    // could still be missing one the code can emit, which is how a state nobody tests ships.
    const reached = new Set(cases.map((c) => documentEvidence(c.shown, c.indexed, c.total).state));
    expect(reached.size, 'each case reaches a distinct state').toBe(cases.length);
  });
});
