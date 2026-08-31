// ⛔ A NARROWER READ THAT CLASSIFIES DIFFERENTLY IS NOT AN OPTIMISATION, IT IS A WRONG ANSWER.
//
// graph_health classifies every unresolved ref to explain its trust denominator. That read used to
// happen on a handle opened AFTER the pinned capture closed, so one response could carry an
// authority verdict from generation N beside its denominator explanation from N+1. Folding the read
// into the capture fixes the coherence, but full hydration costs 142ms of pinned snapshot and spends
// most of it on fields no classifier reads — parsing import_map_json, building ids and confidences
// for a count.
//
// `readTrustClassificationInputs` projects only what the predicates consume. Two things make that
// safe, and neither is a code review:
//
//   1. the declared field set is checked MECHANICALLY against what the predicates actually touch;
//   2. the projection is checked to classify IDENTICALLY to the full-row read, row for row.
//
// ⚠ THE FAILURE THIS GUARDS AGAINST IS SILENT. Predicates read `ref.refusedReason`; the column is
// `refused_reason`. A projection that forgets the alias hands every predicate `undefined` — no
// throw, no warning, rows simply move to a different bucket and the denominator changes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import {
  replaceUnresolvedRefs, readUnresolvedRefs, readTrustClassificationInputs,
} from '../../../mcp/stdio/storage/unresolved-refs.js';
import {
  classifyUnresolvedRef, CLASSIFIER_INPUT_FIELDS,
} from '../../../mcp/stdio/freshness/unresolved-categorization.js';
import { explainTrustExclusions } from '../../../mcp/stdio/freshness/unresolved-metrics.js';

const CARRIER = join(process.cwd(), 'docs', 'evidence', 'unresolved-refs-migration',
  'dirty-edges.full.frozen.json');
const SHAPES = join(process.cwd(), 'tests', 'fixtures', 'unresolved-refs', 'adversarial-shapes.json');

const loadCarrier = () => JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges;
// ⚠ THE FIXTURE IS A CATALOGUE, NOT A REF LIST. Each entry is {name, producer, why, ref} — the
// documentation of WHY the shape exists travels with it. My first version passed the entries
// straight to replaceUnresolvedRefs and the producer-field census correctly refused them:
// "unaccounted field(s): name, producer, why, ref". The guard caught a test that was about to
// write catalogue metadata into the graph.
const loadShapes = () => {
  const raw = JSON.parse(readFileSync(SHAPES, 'utf8'));
  const entries = Array.isArray(raw) ? raw : (raw.shapes ?? raw.refs ?? []);
  return entries.map((e) => e.ref ?? e);
};

let dir; let dbPath;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-trustproj-'));
  dbPath = join(dir, 'graph.sqlite');
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** Record every property the predicates touch while classifying these refs. */
function fieldsTouchedBy(refs) {
  const touched = new Set();
  for (const r of refs) {
    classifyUnresolvedRef(new Proxy(r, {
      get(t, k) { if (typeof k === 'string') touched.add(k); return t[k]; },
    }));
  }
  return touched;
}

describe('the trust projection reads exactly what the classifiers consume', () => {
  it('⛔ the DECLARED field set matches what the predicates actually touch', () => {
    // ⛔ THE DECLARATION IS NOT TRUSTED. CLASSIFIER_INPUT_FIELDS sits beside the registry, which is
    // the right owner, but a list a human maintains drifts the moment someone adds a predicate that
    // reads a new field — and the consequence is not a crash, it is `undefined` reaching a
    // comparison. This drives every predicate over the real population and compares.
    const refs = [...loadCarrier(), ...loadShapes()];
    expect(refs.length, 'the carrier must actually have loaded').toBeGreaterThan(35000);
    const touched = fieldsTouchedBy(refs);
    const declared = new Set(CLASSIFIER_INPUT_FIELDS);

    const readButNotDeclared = [...touched].filter((f) => !declared.has(f)).sort();
    expect(readButNotDeclared,
      'a predicate reads a field the projection does not select — it would see undefined').toEqual([]);

    // The other direction is a real defect too, just a cheaper one: selecting a column nobody reads
    // is dead weight in a pinned read, and it means the declaration has stopped describing reality.
    const declaredButNotRead = [...declared].filter((f) => !touched.has(f)).sort();
    expect(declaredButNotRead, 'the declaration lists a field no predicate reads').toEqual([]);
  });

  it('POSITIVE CONTROL: the recorder notices a field a predicate really does read', () => {
    // ⛔ Both assertions above are emptiness checks. If the Proxy were bypassed — a predicate that
    // destructures before the spy, a classifier list that never runs — every one of them passes
    // while proving nothing. This shows the instrument catches a field that IS read.
    const touched = fieldsTouchedBy([{ relation: 'CALLS', target: 'x', extractor: 'ts' }]);
    expect(touched.has('relation'), 'the recorder saw no field at all').toBe(true);
  });

  it('⛔ the narrow projection classifies EVERY carrier row the same as the full read', () => {
    const carrier = loadCarrier();
    const db = openDb(dbPath);
    try {
      replaceUnresolvedRefs(db, carrier);
      const full = readUnresolvedRefs(db);
      const narrow = readTrustClassificationInputs(db);

      expect(narrow.length, 'the projection must not drop or dedup rows').toBe(full.length);
      expect(full.length, 'the whole carrier must have been written').toBe(carrier.length);

      // Row for row, not bucket totals: two classifications can produce identical totals while
      // disagreeing about which rows went where.
      const disagreements = [];
      for (let i = 0; i < full.length; i++) {
        const a = classifyUnresolvedRef(full[i]);
        const b = classifyUnresolvedRef(narrow[i]);
        if (a !== b) disagreements.push({ i, full: a, narrow: b });
        if (disagreements.length >= 5) break;
      }
      expect(disagreements, 'the projection changed how rows classify').toEqual([]);
    } finally { db.close(); }
  });

  it('⛔ and the DENOMINATOR it feeds is identical, which is what a reader acts on', () => {
    const carrier = loadCarrier();
    const db = openDb(dbPath);
    try {
      replaceUnresolvedRefs(db, carrier);
      const fromFull = explainTrustExclusions(readUnresolvedRefs(db));
      const fromNarrow = explainTrustExclusions(readTrustClassificationInputs(db));
      expect(fromNarrow.total_unresolved).toBe(fromFull.total_unresolved);
      expect(fromNarrow.trust_relevant).toBe(fromFull.trust_relevant);
      expect(fromNarrow.excluded).toEqual(fromFull.excluded);
    } finally { db.close(); }
  });

  it('⛔ the adversarial shapes classify identically too — including typed absence', () => {
    // The carrier is one repository's population: from_target, to_id and language appear in ZERO of
    // its 35,906 rows, and a projection could mishandle them without the carrier noticing. These
    // shapes exist precisely to carry what the live data does not.
    const shapes = loadShapes();
    expect(shapes.length, 'the adversarial fixture must have loaded').toBeGreaterThan(0);
    const db = openDb(dbPath);
    try {
      replaceUnresolvedRefs(db, shapes);
      const full = readUnresolvedRefs(db);
      const narrow = readTrustClassificationInputs(db);
      expect(narrow.length).toBe(shapes.length);
      expect(narrow.map(classifyUnresolvedRef)).toEqual(full.map(classifyUnresolvedRef));
    } finally { db.close(); }
  });

  it('⛔ a MISSING alias would be caught — the parity check can fail', () => {
    // ⚠ THE MUTATION THIS FILE EXISTS FOR, RUN AS A TEST. Dropping `refused_reason AS refusedReason`
    // is the single most likely way to write this projection wrong, and it produces no error. Here
    // the un-aliased shape is built by hand and must disagree with the full read — if it did not,
    // every parity assertion above would be passing for free.
    const db = openDb(dbPath);
    try {
      replaceUnresolvedRefs(db, loadCarrier());
      const full = readUnresolvedRefs(db);
      const unaliased = db.all('SELECT extractor, refused_reason, relation, target FROM unresolved_refs');
      const differ = full.some((r, i) => classifyUnresolvedRef(r) !== classifyUnresolvedRef(unaliased[i]));
      expect(differ, 'an un-aliased projection classified the same, so the alias proves nothing')
        .toBe(true);
    } finally { db.close(); }
  });

  it('legacy stays null and empty stays empty — a read failure is neither', () => {
    // ⛔ ZERO AND ABSENT ARE DIFFERENT ANSWERS, and the projection must keep them apart exactly as
    // the full reader does.
    const db = openDb(dbPath);
    try {
      // ⚠ openDb does NOT create the publication tables — writing an empty population is what
      // establishes the table. My first version asserted [] against a database that had never had
      // the table, so it was really asserting the LEGACY answer and calling it empty. The two
      // states this test exists to separate were confused by the test itself.
      replaceUnresolvedRefs(db, []);
      expect(readTrustClassificationInputs(db), 'a table with no rows is empty, not absent')
        .toEqual([]);
      db.exec('DROP TABLE unresolved_refs');
      expect(readTrustClassificationInputs(db), 'no table is a legacy graph').toBeNull();
    } finally { db.close(); }
  });

  it('the carrier is the frozen one, not a live path', () => {
    // Cheap, and it has mattered: a parity claim over "35,906 rows" is worthless if the file under
    // it is whatever the working graph happens to hold today.
    expect(existsSync(CARRIER)).toBe(true);
    expect(CARRIER).toMatch(/frozen/);
    expect(CARRIER).not.toMatch(/\.aify-graph/);
  });
});
