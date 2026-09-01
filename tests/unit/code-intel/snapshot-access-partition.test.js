// Every snapshot access is accounted for, exactly once.
//
// ⛔ WHY THIS EXISTS. A finding in this arc reported "2 reads + 2049 cache hits" beside "2001
// admitted location records" as though those shared a denominator. They do not: 2 + 2049 = 2051
// accesses, and 2001 is a different population (records surviving the per-symbol cap). The
// arithmetic was right and the noun was wrong — the fourth time in one session.
//
// ⚠ AND MY FIRST PROPOSED CONTROL WAS WRONG TOO. I claimed every access is a read, a hit, or a
// budget refusal. A first access can end in a CACHED TYPED FAILURE, which is none of those, so the
// trichotomy would simply have failed to sum.
//
// The partition below is therefore:
//     snapshotAccesses = hits + misses
//     misses           = capturedDocuments + cachedFailureEntries + countBudgetRefusals
// with cachedFailureEntries subtyped for diagnosis but NEVER re-added to the parent equality —
// double-counting a subtype makes a broken partition still appear to balance.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocumentSnapshot } from '../../../mcp/stdio/code-intel/document-snapshot.js';

let dir;
let realFile;
let secondFile;
let missing;
let bigFile;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-partition-'));
  realFile = join(dir, 'one.cpp');
  secondFile = join(dir, 'two.cpp');
  bigFile = join(dir, 'big.cpp');
  missing = join(dir, 'nope.cpp');
  writeFileSync(realFile, 'void alpha() {}\n', 'utf8');
  writeFileSync(secondFile, 'void beta() {}\n', 'utf8');
  writeFileSync(bigFile, 'x'.repeat(4096), 'utf8');
  mkdirSync(join(dir, 'adir'), { recursive: true });
});
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows handle */ } });

const assertPartition = (stats) => {
  expect(stats.hits + stats.misses, 'hits + misses must equal accesses').toBe(stats.snapshotAccesses);
  const p = stats.missPartition;
  expect(
    p.capturedDocuments + p.cachedFailureEntries + p.countBudgetRefusals,
    'miss partition must sum to misses',
  ).toBe(stats.misses);
  // The subtypes explain cachedFailureEntries; they are not extra terms.
  const sub = stats.cachedFailureSubtypes;
  expect(sub.readStatusFailures + sub.bytesBudgetRefusals).toBe(p.cachedFailureEntries);
};

describe('snapshot access partition', () => {
  it('POSITIVE CONTROL: a run with only hits and captures partitions exactly', () => {
    const snap = createDocumentSnapshot();
    snap.read(realFile);
    snap.read(realFile);
    snap.read(realFile);
    const s = snap.stats();
    expect(s.snapshotAccesses).toBe(3);
    expect(s.hits).toBe(2);
    expect(s.missPartition.capturedDocuments).toBe(1);
    assertPartition(s);
  });

  it('⛔ EVERY reachable leaf is exercised, so the equality cannot pass vacuously', () => {
    // With three of four terms at zero the sum balances trivially and proves nothing. This
    // population contains a capture, a repeat hit, a read failure, a directory, a bytes-budget
    // refusal and a count-budget refusal.
    const snap = createDocumentSnapshot({ maxDocuments: 4, maxRetainedBytes: 64 });
    snap.read(realFile);        // captured (16 bytes)
    snap.read(realFile);        // hit
    snap.read(missing);         // cached read failure
    snap.read(join(dir, 'adir')); // cached directory failure
    snap.read(bigFile);         // bytes-budget refusal (4096 > 64 remaining) — cached, consumes a key
    snap.read(secondFile);      // count ceiling now reached (4 slots used) -> count refusal

    const s = snap.stats();
    assertPartition(s);
    expect(s.missPartition.capturedDocuments, 'one document captured').toBe(1);
    expect(s.cachedFailureSubtypes.readStatusFailures, 'missing file + directory').toBe(2);
    expect(s.cachedFailureSubtypes.bytesBudgetRefusals, 'oversized file').toBe(1);
    expect(s.missPartition.countBudgetRefusals, 'past the document ceiling').toBe(1);
    expect(s.hits).toBe(1);

    // Every leaf non-zero: the equality above is not satisfied by absence.
    for (const [name, value] of [
      ['capturedDocuments', s.missPartition.capturedDocuments],
      ['cachedFailureEntries', s.missPartition.cachedFailureEntries],
      ['countBudgetRefusals', s.missPartition.countBudgetRefusals],
      ['hits', s.hits],
    ]) expect(value, `${name} must be exercised, not zero`).toBeGreaterThan(0);
  });

  it('a repeated FAILURE is served from cache and does not re-enter the filesystem', () => {
    const snap = createDocumentSnapshot();
    snap.read(missing);
    const afterFirst = snap.stats().readsAttempted;
    snap.read(missing);
    snap.read(missing);
    const s = snap.stats();
    expect(s.readsAttempted, 'a cached failure must not be re-read').toBe(afterFirst);
    expect(s.hits).toBe(2);
    assertPartition(s);
  });

  it('a count-budget refusal consumes NO key and touches no filesystem', () => {
    const snap = createDocumentSnapshot({ maxDocuments: 1 });
    snap.read(realFile);                 // fills the only slot
    const before = snap.stats();
    snap.read(secondFile);
    snap.read(join(dir, 'also-absent.cpp'));
    const after = snap.stats();
    expect(after.cachedDocuments, 'refusals past the ceiling must not grow the map').toBe(before.cachedDocuments);
    expect(after.readsAttempted, 'no read attempted past the ceiling').toBe(before.readsAttempted);
    expect(after.statsAttempted, 'no stat attempted past the ceiling').toBe(before.statsAttempted);
    expect(after.missPartition.countBudgetRefusals).toBe(2);
    assertPartition(after);
  });

  it('ANTI-ALIAS: two canonical paths differing only by case are two keys and two reads', () => {
    // Runs on EVERY host: the realpath authority and the I/O are injected, so this does not depend
    // on the filesystem happening to be case-sensitive — which is precisely the host where a
    // lowercasing key would alias two distinct files and validate one against the other's bytes.
    const bytes = { 'C:/p/File.cpp': 'void upper() {}', 'C:/p/file.cpp': 'void lower() {}' };
    const snap = createDocumentSnapshot({
      realpath: (p) => p,
      readFile: (p) => bytes[p],
      statSize: (p) => Buffer.byteLength(bytes[p] ?? ''),
    });
    const a = snap.read('C:/p/File.cpp');
    const b = snap.read('C:/p/file.cpp');
    expect(a.text).toBe('void upper() {}');
    expect(b.text).toBe('void lower() {}');
    const s = snap.stats();
    expect(s.cachedDocuments, 'distinct files must not alias to one key').toBe(2);
    expect(s.readsAttempted).toBe(2);
    expect(s.hits).toBe(0);
    assertPartition(s);
  });

  it('CONVERSE: two spellings the realpath authority collapses share one key and one read', () => {
    const canonical = 'C:/p/real.cpp';
    const snap = createDocumentSnapshot({
      realpath: () => canonical,
      readFile: () => 'void same() {}',
      statSize: () => 15,
    });
    snap.read('C:/p/REAL~1.cpp');
    snap.read('C:/p/real.cpp');
    const s = snap.stats();
    expect(s.cachedDocuments, 'aliases must share one key').toBe(1);
    expect(s.readsAttempted, 'aliases must share one read').toBe(1);
    expect(s.hits).toBe(1);
    assertPartition(s);
  });
});
