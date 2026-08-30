// JSON -> TABLE -> RESOLVER-INPUT PARITY, AGAINST A CARRIER FROZEN BEFORE THE TABLE EXISTED.
//
// ⛔ WHY THE CARRIER IS FROZEN. `.aify-graph/dirty-edges.full.json` is mutable: the reviewer's census
// read 35,885 rows and mine read 35,906, because the graph reindexed between them. A fixture sourced
// from a live path measures whatever the file says when the test runs, which is not a fixture. The
// copy under docs/evidence/ is byte-pinned by sha256 in carrier-attestation.json.
//
// Two layers, because they prove different things:
//   1. the FULL real carrier proves the migration preserves what this repository actually emits;
//   2. the small adversarial fixture proves the resolver SEAMS this repository never exercises —
//      from_target, to_id and language appear in ZERO of the 35,906 live rows, and population zero
//      is not contract absence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import {
  replaceUnresolvedRefs, readUnresolvedRefs, projectRef, hydrateRef,
  UNRESOLVED_REF_COLUMNS, DERIVED_OR_DROPPED, identityKey, IDENTITY_KEY_FIELDS,
} from '../../../mcp/stdio/storage/unresolved-refs.js';

const EVIDENCE = join(process.cwd(), 'docs/evidence/unresolved-refs-migration');
const CARRIER = join(EVIDENCE, 'dirty-edges.full.frozen.json');
const ATTESTATION = join(EVIDENCE, 'carrier-attestation.json');
const FIXTURE = join(process.cwd(), 'tests/fixtures/unresolved-refs/adversarial-shapes.json');

let dir; let db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-refs-'));
  db = openDb(join(dir, 'graph.sqlite'));
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('the frozen carrier is the carrier that was attested', () => {
  it('⛔ byte identity — a changed carrier invalidates every number below it', () => {
    // Without this the parity test silently re-baselines onto whatever the file becomes.
    const attested = JSON.parse(readFileSync(ATTESTATION, 'utf8'));
    const actual = createHash('sha256').update(readFileSync(CARRIER)).digest('hex');
    expect(actual, 'the frozen carrier no longer matches its attestation').toBe(attested.carrierDerived.carrier.sha256);
    expect(JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges.length)
      .toBe(attested.carrierDerived.carrier.rowCount);
  });
});

describe('every producer field is accounted for, none silently discarded', () => {
  it('⛔ a field that is neither a column nor an explicit drop THROWS', () => {
    // Catches the quiet death of a new producer seam. A field must be a decision.
    expect(() => projectRef({
      relation: 'CALLS', source_file: 'a.js', target: 'x', somethingNew: 1,
    })).toThrow(/unaccounted field\(s\): somethingNew/);
  });

  it('POSITIVE CONTROL: a fully-populated ref projects without throwing', () => {
    // Without this the assertion above is satisfied by a function that rejects everything.
    expect(() => projectRef({
      from_id: 'a', from_target: 'b', to_id: 'c', target: 'd', relation: 'CALLS',
      source_file: 'a.js', source_line: 1, confidence: 0.9, provenance: 'EXTRACTED',
      extractor: 'javascript', language: 'javascript', refusedReason: 'r',
      importMap: { x: { source: 'y' } }, from_label: 'dropped-on-purpose',
    })).not.toThrow();
  });

  it('every key in the live carrier is a column, a rename, or a documented drop', () => {
    // The census the review asked for, run over the real population rather than a sample.
    const rows = JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges;
    const emitted = new Set();
    for (const r of rows) for (const k of Object.keys(r)) emitted.add(k);
    const renamed = new Set(['refusedReason', 'importMap']);
    const unaccounted = [...emitted].filter(
      (k) => !UNRESOLVED_REF_COLUMNS.includes(k) && !renamed.has(k) && !(k in DERIVED_OR_DROPPED),
    );
    expect(unaccounted, 'a producer field would vanish in the migration').toEqual([]);
    expect(emitted.has('from_label'), 'and from_label IS present, so the drop is real work').toBe(true);
  });
});

describe('the full frozen carrier survives the round trip', () => {
  it('⭐ all 35,906 rows, with exact duplicate multiplicity and no dedup', () => {
    const attested = JSON.parse(readFileSync(ATTESTATION, 'utf8'));
    const original = JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges;

    replaceUnresolvedRefs(db, original);
    const back = readUnresolvedRefs(db);

    expect(back.length, 'row count must survive exactly — canonical-key dedup would drop 3,344')
      .toBe(original.length);
    expect(back.length).toBe(attested.carrierDerived.carrier.rowCount);

    // ⛔ MULTISET, NOT SET. 2,547 identity keys repeat with multiplicity up to 15. Comparing sets
    // would pass on a migration that deduplicated, which is exactly the accidental migration the
    // surrogate row id exists to prevent.
    // ⛔ THE KEY COMES FROM THE ONE OWNER, not from a copy defined here. The duplicate
    // figures are load-bearing evidence, and a count of DISTINCT anything is meaningless
    // without the definition of distinct. Defining it locally also smuggled a literal control
    // byte into this file, which the repository's own scanner correctly rejected.
    const key = identityKey;
    const tally = (rows) => {
      const m = new Map();
      for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
      return m;
    };
    const before = tally(original);
    const after = tally(back);
    expect(after.size).toBe(before.size);
    expect(after.size).toBe(attested.carrierDerived.duplicateMultiplicity.distinctIdentityKeys);
    const drift = [...before].filter(([k, n]) => after.get(k) !== n);
    expect(drift, 'every identity key must keep its exact multiplicity').toEqual([]);
  });

  it('⭐ resolver-input parity: values, not just counts', () => {
    // A count can survive while every field is nulled. This compares the hydrated refs field by
    // field against the original, minus the one field deliberately dropped.
    const original = JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges;
    replaceUnresolvedRefs(db, original);
    const back = readUnresolvedRefs(db);

    const canonical = (r) => {
      const { from_label: _dropped, ...rest } = r;
      // Producer omits keys; the table stores NULL. Compare on PRESENT keys only, which is what
      // resolveRefs sees either way.
      return JSON.stringify(Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b)),
      ));
    };
    let mismatch = null;
    for (let i = 0; i < original.length && !mismatch; i += 1) {
      if (canonical(original[i]) !== canonical(back[i])) {
        mismatch = { i, before: canonical(original[i]), after: canonical(back[i]) };
      }
    }
    expect(mismatch, 'a ref changed shape crossing the table').toBeNull();
  });

  it('⛔ typed ABSENCE survives — provenance is missing on 2 rows, not null-defaulted', () => {
    const original = JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges;
    const withoutProvenance = original.filter((r) => !('provenance' in r));
    expect(withoutProvenance.length, 'the carrier still contains the typed-absence case').toBe(2);

    replaceUnresolvedRefs(db, withoutProvenance);
    for (const r of readUnresolvedRefs(db)) {
      expect('provenance' in r, 'a default provenance would manufacture unearned confidence')
        .toBe(false);
    }
  });
});

describe('the adversarial fixture covers the seams the live carrier never exercises', () => {
  const shapes = () => JSON.parse(readFileSync(FIXTURE, 'utf8')).shapes.map((s) => s.ref);

  it('⭐ from_target, to_id and language round-trip — zero live rows carry them', () => {
    const refs = shapes();
    replaceUnresolvedRefs(db, refs);
    const back = readUnresolvedRefs(db);
    expect(back.length).toBe(refs.length);

    expect(back.some((r) => r.from_target === 'MainWindow::onReady'),
      'symbolic source with no from_id').toBe(true);
    expect(back.some((r) => r.to_id === 'ff00ee11dd22cc33bb44aa5566778899aabbccdd'),
      'pre-resolved destination').toBe(true);
    expect(back.some((r) => r.language === 'cpp'), 'language rides the ref').toBe(true);
  });

  it('importMap survives as evidence, not as a display extra', () => {
    replaceUnresolvedRefs(db, shapes());
    const withMap = readUnresolvedRefs(db).find((r) => r.importMap);
    expect(withMap, 'the fixture carries one').toBeTruthy();
    expect(withMap.importMap.fs.source).toBe('node:fs');
  });

  it('the fixture duplicate is preserved, proving no dedup on the small path either', () => {
    const refs = shapes();
    const back = (replaceUnresolvedRefs(db, refs), readUnresolvedRefs(db));
    const readFileSyncRefs = back.filter((r) => r.target === 'readFileSync');
    expect(readFileSyncRefs.length, 'the exact duplicate pair must both survive').toBe(2);
  });
});

describe('a legacy graph is distinguishable from an empty one', () => {
  it('⛔ missing table reads as null, never as "no unresolved refs"', () => {
    // An empty array here would be a claim about the repository. The cosmetic fast path and the
    // trust denominator both key off this, and both must DISABLE rather than guess.
    const raw = openDb(join(dir, 'legacy.sqlite'));
    raw.exec('DROP TABLE IF EXISTS unresolved_refs');
    expect(readUnresolvedRefs(raw)).toBeNull();
    raw.close();
  });

  it('POSITIVE CONTROL: a present-but-empty table reads as []', () => {
    // The two states must not collapse — this is the pair the null above exists to separate.
    replaceUnresolvedRefs(db, []);
    expect(readUnresolvedRefs(db)).toEqual([]);
  });
});

describe('hydrate is the exact inverse of project', () => {
  it('round-trips every column without inventing or losing one', () => {
    const ref = {
      from_id: 'a', from_target: 'b', to_id: 'c', target: 'd', relation: 'CALLS',
      source_file: 'x.cpp', source_line: 7, confidence: 0.42, provenance: 'INFERRED',
      extractor: 'qt', language: 'cpp', refusedReason: 'why',
      importMap: { k: { source: 's' } },
    };
    expect(hydrateRef(projectRef(ref))).toEqual(ref);
  });
});

// ⛔ THE NUMBERS MUST BE REPRODUCIBLE WITHOUT THE PERSON WHO WROTE THEM.
// The first attestation was generated by an untracked scratch script, so "2,547 keys repeat" and
// "32,562 distinct" were committed as bare figures whose definition of DISTINCT existed nowhere a
// reader could reach. Reviewer caught it. The generator now lives in scripts/ and imports the same
// identity key this test does, so the definition travels with the numbers.
describe('the attestation is reproducible from the frozen carrier alone', () => {
  const attested = () => JSON.parse(readFileSync(ATTESTATION, 'utf8'));

  it('records the identity-key DEFINITION, not just the counts it produced', () => {
    // A count of distinct anything is meaningless without the key. Field ORDER is part of the
    // definition — a different order is a different canonical encoding and a different count.
    const d = attested().carrierDerived;
    expect(d.identityKey.fields, 'the committed definition must match the one owner')
      .toEqual([...IDENTITY_KEY_FIELDS]);
    expect(d.identityKey.owner).toBe('mcp/stdio/storage/unresolved-refs.js');
    expect(d.identityKey.separator).toBe('U+0001');
  });

  it('the distinct-key count recomputes from the carrier using that definition', () => {
    // Recomputed here with the SAME owner the generator used, so a drift in either shows up.
    const rows = JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges;
    const distinct = new Set(rows.map(identityKey)).size;
    const d = attested().carrierDerived;
    expect(distinct).toBe(d.duplicateMultiplicity.distinctIdentityKeys);
    expect(rows.length - distinct, 'what deduplication BY THE CANONICAL KEY would have discarded')
      .toBe(d.duplicateMultiplicity.rowsLostToDeduplication);
  });

  it('⚠ states its provenance CEILING rather than implying a clean tree', () => {
    // The carrier's byte identity is attested; a clean instrument tree at capture time is NOT.
    // The ceiling belongs to the CAPTURE — the verifying run discloses its own tree on stdout.
    expect(attested().capture.ceiling).toMatch(/clean instrument tree/i);
  });
});

// ⛔ CAPTURE PROVENANCE IS HISTORY, AND HISTORY IS NOT RECOMPUTED.
//
// The first generator read the LIVE .aify-graph/manifest.json and wrote it as producedBy, so every
// regeneration reassigned the immutable carrier to whatever graph happened to be indexed at that
// moment — it overwrote the true producer (1050fb5, 19:09:41Z) with the commit being worked on
// (0fa494e, 19:45:46Z). A false lineage claim in an evidence file, and one nobody re-checks later.
// It also made --check drift by construction after any HEAD movement, so the verification built to
// make the numbers trustworthy was the thing that made them untrustworthy.
describe('the attestation separates what was captured from what is being verified', () => {
  const attested = () => JSON.parse(readFileSync(ATTESTATION, 'utf8'));

  it('names the manifest that PRODUCED the frozen bytes, not the one indexed now', () => {
    // The carrier was frozen while 1050fb5 was HEAD. Later commits must not claim authorship of it.
    const a = attested();
    expect(a.capture.producedBy.manifestCommit).toMatch(/^1050fb55/);
    expect(a.capture.producedBy.manifestIndexedAt).toBe('2026-08-30T19:09:41.089Z');
    expect(a.capture.frozenAt).toBe('2026-08-30T19:25:09.689Z');
  });

  it('⛔ no live-manifest fields leak into the top level', () => {
    // The shape itself is the guard: a producedBy outside `capture` is the old, rewritable one.
    const a = attested();
    expect(a.producedBy, 'producedBy belongs to capture, and only to capture').toBeUndefined();
    expect(a.instrumentTree, 'the capture instrument disclosure lives under capture too').toBeUndefined();
  });

  it('⛔ the canonical file records NOTHING about the run that wrote it', () => {
    // Reviewer's refinement, and he was right: a field every regeneration rewrites but no
    // comparison reads is mutable noise beside frozen facts. It also makes `git diff` on an
    // immutable evidence file dirty for no reason, which trains a reader to ignore that diff.
    // The verifying run discloses itself on stdout instead — see the receipt tests below.
    const a = attested();
    expect(Object.keys(a).sort(), 'exactly four keys, all of them frozen or derived')
      .toEqual(['capture', 'carrierDerived', 'purpose', 'regenerateWith']);
    expectAbsentWithLiveMatcher(
      /"(verificationRun|verifiedAt|dirtyPathCount)"/,
      { forbidden: '{"verificationRun": {}}', allowed: '{"capture": {"frozenAt": "x"}}' },
      readFileSync(ATTESTATION, 'utf8'),
      'a per-run field was persisted into the canonical attestation',
    );
  });

  it('⚠ preserves the capture disclosure VERBATIM, thin as it is', () => {
    // The original recorded `dirtyPaths: 1` — a bare count naming neither path nor bytes, which is
    // weaker than what the generator emits today. Improving it retroactively would be inventing
    // history rather than recording it, so it is copied forward exactly as captured.
    const a = attested();
    expect(a.capture.instrumentTree.dirtyPaths).toBe(1);
    expect(a.capture.ceiling).toMatch(/clean instrument tree/i);
  });
});

// ⭐ THE GATE IS TESTED BY BEING MADE TO FAIL, NINE WAYS.
//
// The previous --check compared five hand-picked fields and printed "attestation reproduces from
// the frozen carrier: OK". A committed-false rowsLostToDeduplication, fieldPopulation, byte length,
// envelope shape or maxMultiplicity passed as verified. That is not a weak gate, it is an absent
// one wearing a green badge — and I wrote it, then described it to a reviewer as verification of
// the file. He found it. These tests exist so the next narrowing of the comparison cannot pass.
//
// Every mutation is checked for having ACTUALLY APPLIED before the gate runs: a no-op edit leaves
// the file identical and would be scored as a killed mutant by a gate never challenged.
describe('--check fails on drift anywhere in the canonical object', () => {
  const SCRIPT = 'scripts/attest-frozen-carrier.mjs';
  const original = () => readFileSync(ATTESTATION, 'utf8');

  const runCheck = (file) => {
    const args = [SCRIPT, '--check', ...(file ? ['--file', file] : [])];
    try {
      return { exit: 0, out: execFileSync('node', args, { cwd: process.cwd(), encoding: 'utf8' }) };
    } catch (e) {
      return { exit: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  // ⛔ A GATE WHOSE CLOSED STATE IS PERMANENT IS NOT FAIL-CLOSED, IT IS OFF.
  // Every denial below is worthless without this: proof the allow path is still reachable.
  it('POSITIVE CONTROL: the committed attestation passes', () => {
    const { exit, out } = runCheck();
    expect(exit, 'the gate must accept the true file, or its denials prove nothing').toBe(0);
    expect(out).toMatch(/reproduces from the frozen carrier: OK/);
  });

  const MUTANTS = [
    ['rowsLostToDeduplication', (o) => { o.carrierDerived.duplicateMultiplicity.rowsLostToDeduplication = 0; }],
    ['fieldPopulation.provenance', (o) => { o.carrierDerived.fieldPopulation.provenance = 35906; }],
    ['maxMultiplicity', (o) => { o.carrierDerived.duplicateMultiplicity.maxMultiplicity = 1; }],
    ['carrier.bytes', (o) => { o.carrierDerived.carrier.bytes = 1; }],
    ['carrier.envelopeWrittenAt', (o) => { o.carrierDerived.carrier.envelopeWrittenAt = '1999-01-01T00:00:00.000Z'; }],
    ['capture lineage rewritten to a later commit', (o) => { o.capture.producedBy.manifestCommit = 'f'.repeat(40); }],
    ['capture thin disclosure retroactively "improved"', (o) => { o.capture.instrumentTree.dirtyPaths = ['mcp/stdio/storage/db.js']; }],
    ['a key removed entirely', (o) => { delete o.carrierDerived.duplicateMultiplicity.maxMultiplicity; }],
    ['a key added', (o) => { o.carrierDerived.carrier.extraClaim = 'verified'; }],
  ];

  it.each(MUTANTS)('kills the mutant: %s', (label, mutate) => {
    const before = original();
    const obj = JSON.parse(before);
    mutate(obj);
    const mutated = `${JSON.stringify(obj, null, 2)}\n`;
    expect(mutated, `MUTATION DID NOT APPLY (${label}) — a void result, not a pass`).not.toBe(before);

    const candidate = join(dir, 'mutated-attestation.json');
    writeFileSync(candidate, mutated);
    const { exit, out } = runCheck(candidate);
    expect(exit, `${label} passed --check`).not.toBe(0);
    expect(out).toMatch(/ATTESTATION DRIFT/);
  });

  it('the drift message NAMES the path that differs', () => {
    // A gate that says only "something changed" sends a reader to diff 35,906 rows by hand.
    const obj = JSON.parse(original());
    obj.carrierDerived.duplicateMultiplicity.rowsLostToDeduplication = 0;
    const candidate = join(dir, 'named-drift.json');
    writeFileSync(candidate, `${JSON.stringify(obj, null, 2)}\n`);
    const { out } = runCheck(candidate);
    expect(out).toMatch(/carrierDerived\.duplicateMultiplicity\.rowsLostToDeduplication/);
  });

  it('the verification receipt binds the run to the exact bytes it read', () => {
    // The receipt is the disclosure the canonical file no longer carries: which tree verified,
    // which carrier, which attestation file. Without the hashes it names a run over nothing.
    const { out } = runCheck();
    const receipt = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    const carrierBytes = readFileSync(CARRIER);
    expect(receipt.carrierSha256).toBe(createHash('sha256').update(carrierBytes).digest('hex'));
    expect(receipt.attestationSha256)
      .toBe(createHash('sha256').update(readFileSync(ATTESTATION)).digest('hex'));
    expect(receipt.head, 'the verifying tree, disclosed and not compared').toMatch(/^[0-9a-f]{40}$/);
  });

  it('⛔ every recorded dirty path is a real path — a truncated one is wrong evidence', () => {
    // Caught for real: a git helper trimmed its whole output, which ate the leading space of the
    // FIRST porcelain line only, recording "M docs/..." for "docs/...". One row corrupted, the
    // rest correct, which is the hardest kind to notice. The receipt inherited that code.
    const { out } = runCheck();
    const receipt = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    expect(receipt.dirtyPaths.length).toBe(receipt.dirtyPathCount);
    const bogus = receipt.dirtyPaths.filter((p) => /^[ MADRCU?]{1,2}\s/.test(p));
    expect(bogus, 'a status prefix leaked into a recorded path').toEqual([]);
  });
});
