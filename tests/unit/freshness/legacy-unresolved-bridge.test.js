// THE MIGRATION READER MUST BE ABLE TO REFUSE.
//
// ⛔ THE DEFECT IT REPLACES. `readDirtyEdgesSidecar` returns `[]` for a corrupt file and reserves
// `null` for ENOENT alone. So a legacy graph whose sidecar was unreadable answered "this graph has
// no unresolved refs" — a claim about the repository manufactured from a failed read. Reviewer
// executed it: the manifest read `status: ok` at a new commit while the full ref set was
// unavailable, and the next incremental run silently dropped every unresolved ref.
//
// ⭐ A PROBE THAT CANNOT RETURN ABSENT CANNOT RETURN PRESENT. Every refusal below is paired with a
// positive control in the same describe proving the accept path is still reachable — a gate whose
// closed state is permanent is off, not fail-closed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readLegacyUnresolvedSidecar, readManifestAsMigrationSource, chooseCarryForwardSource,
} from '../../../mcp/stdio/freshness/legacy-unresolved-bridge.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const CARRIER = join(process.cwd(),
  'docs/evidence/unresolved-refs-migration/dirty-edges.full.frozen.json');

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apg-bridge-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const writeSidecar = (payload) => {
  writeFileSync(join(dir, 'dirty-edges.full.json'),
    typeof payload === 'string' ? payload : JSON.stringify(payload));
};

describe('the legacy sidecar reads as a typed state, never as an answer about the data', () => {
  it('POSITIVE CONTROL: a well-formed sidecar reads valid, with its rows', async () => {
    writeSidecar({ count: 2, writtenAt: 'x', dirtyEdges: [{ target: 'a' }, { target: 'b' }] });
    const r = await readLegacyUnresolvedSidecar(dir);
    expect(r.state).toBe('valid');
    expect(r.rows.map((x) => x.target)).toEqual(['a', 'b']);
    expect(r.count).toBe(2);
  });

  it('an absent file is ABSENT — a distinct state from empty and from invalid', async () => {
    const r = await readLegacyUnresolvedSidecar(dir);
    expect(r.state).toBe('absent');
    expect(r.rows, 'absent carries no rows to mistake for an answer').toBeUndefined();
  });

  it('⛔ an UNREADABLE file is INVALID, not absent — a failed read is not a missing file', async () => {
    // Found by a surviving mutant: the code distinguished these two and nothing tested it, so
    // "unreadable -> absent" passed the whole suite. Absent means the graph never had a sidecar and
    // the next tier may legitimately answer; unreadable means the authority exists and we could not
    // read it, which must refuse. Collapsing them hands the next tier a question it cannot answer.
    //
    // A directory at the file's path is the portable way to force a non-ENOENT failure: chmod does
    // not reliably block reads on Windows, so a permissions test would silently pass for the wrong
    // reason on this machine.
    mkdirSync(join(dir, 'dirty-edges.full.json'));
    const r = await readLegacyUnresolvedSidecar(dir);
    expect(r.state, 'a read that FAILED must not be reported as a file that was not there')
      .toBe('invalid');
    expect(r.reason).toMatch(/unreadable/);
  });

  it('⛔ corrupt JSON is INVALID, never an empty list', async () => {
    writeSidecar('{"count": 3, "dirtyEdges": [{"target": "a"},');
    const r = await readLegacyUnresolvedSidecar(dir);
    expect(r.state).toBe('invalid');
    expect(r.reason).toMatch(/corrupt/i);
    expect(r.rows, 'the old reader returned [] here, which reads as "no unresolved refs"')
      .toBeUndefined();
  });

  it('⛔ a count/rows mismatch is INVALID — a truncated write parses as valid JSON', async () => {
    // The rows that survive a truncation look perfectly well formed. The declared count is the only
    // thing in the file that knows how many there should have been.
    writeSidecar({ count: 35906, writtenAt: 'x', dirtyEdges: [{ target: 'a' }] });
    const r = await readLegacyUnresolvedSidecar(dir);
    expect(r.state).toBe('invalid');
    expect(r.reason).toMatch(/35906 !== 1/);
  });

  it('an envelope with no dirtyEdges array is INVALID, not empty', async () => {
    writeSidecar({ count: 0, writtenAt: 'x' });
    const r = await readLegacyUnresolvedSidecar(dir);
    expect(r.state).toBe('invalid');
    expect(r.reason).toMatch(/no dirtyEdges array/);
  });

  it('a genuinely empty population reads VALID with zero rows, not absent', async () => {
    // ⭐ THE DISCRIMINATION THAT MATTERS. valid([]) is an authoritative "nothing unresolved";
    // absent and invalid are "I do not know". Collapsing them is how a failed read becomes a fact.
    writeSidecar({ count: 0, writtenAt: 'x', dirtyEdges: [] });
    const r = await readLegacyUnresolvedSidecar(dir);
    expect(r.state).toBe('valid');
    expect(r.rows).toEqual([]);
  });
});

describe('the REAL 35,906-row legacy carrier migrates with its exact multiset', () => {
  it('⭐ every row and every duplicate survives the read — no cap, no dedup', async () => {
    // The frozen carrier is the exact shape a legacy graph has on disk today. Reading it through
    // the bridge must yield the whole population, not the 500 the manifest would have offered.
    const bytes = readFileSync(CARRIER, 'utf8');
    writeFileSync(join(dir, 'dirty-edges.full.json'), bytes);

    const r = await readLegacyUnresolvedSidecar(dir);
    expect(r.state).toBe('valid');
    expect(r.count).toBe(35906);

    const original = JSON.parse(bytes).dirtyEdges;
    expect(r.rows.length).toBe(original.length);
    // Multiset, not set: 2,547 identity keys repeat with multiplicity up to 15, and a read that
    // collapsed them would lose 3,344 rows while looking successful.
    const tally = (rows) => {
      const m = new Map();
      for (const row of rows) {
        const k = JSON.stringify(row);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    const before = tally(original);
    const after = tally(r.rows);
    expect(after.size).toBe(before.size);
    const drift = [...before].filter(([k, n]) => after.get(k) !== n);
    expect(drift, 'every row must keep its exact multiplicity through the bridge').toEqual([]);
  });
});

describe('the manifest is a migration source only when PROVABLY complete', () => {
  it('POSITIVE CONTROL: count equal to rows is valid', () => {
    const r = readManifestAsMigrationSource({ dirtyEdges: [{ target: 'a' }], dirtyEdgeCount: 1 });
    expect(r.state).toBe('valid');
    expect(r.rows.length).toBe(1);
  });

  it('⛔ a 500-row sample of 35,906 is INVALID — the cap is the whole hazard', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ target: `t${i}` }));
    const r = readManifestAsMigrationSource({ dirtyEdges: rows, dirtyEdgeCount: 35906 });
    expect(r.state).toBe('invalid');
    expect(r.reason).toMatch(/500-row sample of 35906/);
  });

  it('⛔ a MISSING count is unknown, and unknown fails closed under its own wording', () => {
    // Not reported as "truncated": that is the known-bad case, and naming it here would tell a
    // reader something the evidence does not support.
    const r = readManifestAsMigrationSource({ dirtyEdges: [{ target: 'a' }] });
    expect(r.state).toBe('invalid');
    expect(r.reason).toMatch(/completeness unknown/);
    expectAbsentWithLiveMatcher(
      /truncated|sample of/,
      { forbidden: 'a 500-row sample of 35906 — truncated', allowed: 'dirtyEdgeCount absent — completeness unknown' },
      r.reason,
      'unknown must not borrow the wording of the known-bad case',
    );
  });

  it('an empty population with a zero count is valid, not unknown', () => {
    const r = readManifestAsMigrationSource({ dirtyEdges: [], dirtyEdgeCount: 0 });
    expect(r.state).toBe('valid');
    expect(r.rows).toEqual([]);
  });
});

describe('the tier chain refuses rather than degrades', () => {
  const absent = { state: 'absent' };
  const valid = (rows) => ({ state: 'valid', rows, count: rows.length });
  const invalid = (reason) => ({ state: 'invalid', reason });

  it('the table wins whenever it exists', () => {
    const r = chooseCarryForwardSource({
      tableRefs: [{ target: 'from-table' }],
      legacy: valid([{ target: 'from-file' }]),
      manifestSource: valid([{ target: 'from-manifest' }]),
    });
    expect(r.tier).toBe('table');
    expect(r.rows[0].target).toBe('from-table');
  });

  it('⭐ an EMPTY table still wins — authoritative empty is an answer', () => {
    // The bridge must self-retire. If an empty table sent us back to the file, the ramp would be
    // permanent and a stale legacy file could resurrect refs the graph has already resolved.
    const r = chooseCarryForwardSource({
      tableRefs: [],
      legacy: valid([{ target: 'stale' }]),
      manifestSource: valid([{ target: 'stale' }]),
    });
    expect(r.tier).toBe('table');
    expect(r.rows).toEqual([]);
  });

  it('no table + valid sidecar migrates the sidecar', () => {
    const r = chooseCarryForwardSource({
      tableRefs: null, legacy: valid([{ target: 'a' }]), manifestSource: absent,
    });
    expect(r.tier).toBe('legacy-sidecar');
  });

  it('⛔ no table + INVALID sidecar forces a full rebuild — it does not fall through', () => {
    // Falling through to the manifest here is the tempting bug: it converts an unreadable authority
    // into a smaller, confident one, and the loss looks like progress.
    const r = chooseCarryForwardSource({
      tableRefs: null,
      legacy: invalid('corrupt JSON'),
      manifestSource: valid([{ target: 'would-be-wrong' }]),
    });
    expect(r.tier).toBe('force-full');
    expect(r.rows).toBeNull();
    expect(r.reason).toMatch(/corrupt JSON/);
  });

  it('no table + no sidecar + complete manifest migrates the manifest', () => {
    const r = chooseCarryForwardSource({
      tableRefs: null, legacy: absent, manifestSource: valid([{ target: 'a' }]),
    });
    expect(r.tier).toBe('manifest-sample');
  });

  it('⛔ no table + no sidecar + truncated manifest forces a full rebuild', () => {
    const r = chooseCarryForwardSource({
      tableRefs: null, legacy: absent, manifestSource: invalid('truncated'),
    });
    expect(r.tier).toBe('force-full');
    expect(r.rows).toBeNull();
  });

  it('nothing anywhere is genuinely empty, not a refusal', () => {
    // POSITIVE CONTROL ON THE REFUSAL: if this returned force-full too, the gate would be closed
    // permanently and would prove nothing about the cases above.
    const r = chooseCarryForwardSource({
      tableRefs: null, legacy: absent, manifestSource: absent,
    });
    expect(r.tier).toBe('none');
    expect(r.rows).toEqual([]);
  });
});
