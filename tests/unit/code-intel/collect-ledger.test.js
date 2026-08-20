// "RUN AGAIN TO CONTINUE" MUST BE TRUE.
//
// The budget-exhausted envelope told users to re-run to continue/complete, and the
// per-file loop was `for (let i = 0; i < files.length; i++)` — starting at 0 every
// time with nothing recorded. A second run was a WARM REDO, not a resume: it
// re-walked the same files and regenerated their records, so a 185-file repo grew
// a LARGER import on each "resume" instead of converging (Sand Castle 2026-07-30:
// attempt 1 covered 15/185; attempt 2 ran ~30 min and was killed by a host idle
// timeout).
//
// An instruction telling a user to do something the code does not do is the same
// defect class this pass removed from the query verbs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readLedger, writeLedger, pendingFiles, clearLedger, ledgerPath,
} from '../../../mcp/stdio/code-intel/collect-ledger.js';

// ⚠ EVERY CALL HERE PASSES AN EXPLICIT "EVIDENCE PRESENT" WITNESS, and that is the point rather
// than a formality. `readLedger` now also invalidates when the GRAPH no longer holds the verified
// edges the ledger claims to have produced — a ledger orphaned by `graph_index(force=true)` made
// `graph_collect_code_intel` a permanent no-op that reported success (ef-manager, sand_castle,
// 2026-08-20). It FAILS CLOSED, so a call with no witness resets, which is correct behaviour and
// broke two tests in this file.
//
// The right repair is to state the precondition these tests were always assuming — a healthy
// graph — not to relax the guard so the old calls keep working. Orphaning itself is covered by
// `collect-ledger-orphaned.test.js`, which is where a missing or zero witness belongs.
//
// ⇒ AND IT HAPPENED AGAIN, TO THIS CONSTANT, ON 2026-08-20. The witness now observes BOTH
// artifacts a collection produces, because the first incident destroyed EDGES and kept records
// while the second destroyed RECORDS and kept edges — a one-of-two witness is defeated by
// whichever accident spares its chosen artifact. This constant carried only `verifiedEdges`, so
// it became a half-witness, failed closed, and broke the same two tests a second time.
//
// ★ The repair is the same one the paragraph above already argued for, and the temptation is the
// same: `ledgerEvidenceSurvives` could have been made to accept a witness missing `intelRecords`
// and every call here would have kept working. That is precisely how a guard written for one
// accident sails through the next, so the precondition is restated instead.
const EVIDENCE_PRESENT = { verifiedEdges: 1, intelRecords: 1 };

describe('collect ledger', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-ledger-')); });
  afterEach(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

  it('round-trips the collected set under a compile-DB hash', () => {
    const led = readLedger(root, 'hash-a', EVIDENCE_PRESENT);
    expect([...led.collected]).toEqual([]);
    led.collected.add('src/b.cpp');
    led.collected.add('src/a.cpp');
    expect(writeLedger(root, led, '2026-07-30T00:00:00Z')).toBe(true);

    const again = readLedger(root, 'hash-a', EVIDENCE_PRESENT);
    expect([...again.collected].sort()).toEqual(['src/a.cpp', 'src/b.cpp']);
  });

  it('RESETS when the compile DB changed', () => {
    // A different toolchain state means the previous run's coverage says nothing
    // about this one. A stale entry here would mask an uncollected file — a
    // silent coverage hole, which is worse than redoing work.
    const led = readLedger(root, 'hash-a', EVIDENCE_PRESENT);
    led.collected.add('src/a.cpp');
    writeLedger(root, led, null);

    expect([...readLedger(root, 'hash-b', EVIDENCE_PRESENT).collected]).toEqual([]);
  });

  it('pendingFiles splits remaining from already-collected, preserving order', () => {
    const led = readLedger(root, 'h', EVIDENCE_PRESENT);
    led.collected.add('src/b.cpp');
    const { remaining, alreadyCollected } = pendingFiles(
      ['src/a.cpp', 'src/b.cpp', 'src/c.cpp'], led,
    );
    expect(remaining).toEqual(['src/a.cpp', 'src/c.cpp']);
    expect(alreadyCollected).toEqual(['src/b.cpp']);
  });

  it('a resume loop converges instead of repeating', () => {
    // Three "runs" of budget 2 files each over a 5-file repo. The old behaviour
    // returned the SAME first two files forever; convergence is the whole point.
    const all = ['a', 'b', 'c', 'd', 'e'].map((n) => `src/${n}.cpp`);
    const seen = [];
    for (let run = 0; run < 3; run += 1) {
      const led = readLedger(root, 'h', EVIDENCE_PRESENT);
      const { remaining } = pendingFiles(all, led);
      const batch = remaining.slice(0, 2);
      seen.push(batch);
      for (const f of batch) led.collected.add(f);
      writeLedger(root, led, null);
    }
    expect(seen).toEqual([
      ['src/a.cpp', 'src/b.cpp'],
      ['src/c.cpp', 'src/d.cpp'],
      ['src/e.cpp'],
    ]);
    expect(pendingFiles(all, readLedger(root, 'h', EVIDENCE_PRESENT)).remaining).toEqual([]);
  });

  it('survives a corrupt or absent ledger without throwing', () => {
    // Best-effort by design: a bad ledger must degrade to "redo the work", never
    // fail a collection that otherwise succeeded.
    fs.mkdirSync(path.dirname(ledgerPath(root)), { recursive: true });
    fs.writeFileSync(ledgerPath(root), '{not json');
    expect([...readLedger(root, 'h', EVIDENCE_PRESENT).collected]).toEqual([]);

    clearLedger(root);
    expect([...readLedger(root, 'h', EVIDENCE_PRESENT).collected]).toEqual([]);
  });

  it('ignores a ledger written by a different version', () => {
    fs.mkdirSync(path.dirname(ledgerPath(root)), { recursive: true });
    fs.writeFileSync(ledgerPath(root), JSON.stringify({
      version: 999, dbHash: 'h', collected: ['src/stale.cpp'],
    }));
    expect([...readLedger(root, 'h', EVIDENCE_PRESENT).collected]).toEqual([]);
  });
});
