import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishEvidence } from '../../../scripts/ab-graph-effect.mjs';

// ⛔ EVIDENCE USED TO BE WRITTEN INTO MAIN WHILE THE RUN WAS STILL GOING.
//
// The harness wrote the receipt and difference files straight into docs/evidence as the arms
// produced them, so a kill mid-run left the repository holding a HALF-REPLACED authoritative
// receipt. That is not hypothetical: a reviewer observed exactly that state — three modified
// evidence files from a rerun that had overwritten the accepted receipt before publication.
//
// Everything now stages outside the repository, and publication is a separate step that REFUSES
// rather than overwrites when the destination does not hold the bytes the last accepted receipt
// recorded. Silently overwriting would erase the only evidence that something was wrong.

const sha = (t) => createHash('sha256').update(t).digest('hex');

describe('publishEvidence — refuses what it cannot account for', () => {
  let stagingDir;
  let publishDir;

  beforeEach(() => {
    stagingDir = mkdtempSync(join(tmpdir(), 'apg-pub-stage-'));
    publishDir = mkdtempSync(join(tmpdir(), 'apg-pub-dest-'));
  });
  afterEach(() => {
    for (const d of [stagingDir, publishDir]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  const stage = (name, body) => writeFileSync(join(stagingDir, name), body);
  const place = (name, body) => writeFileSync(join(publishDir, name), body);
  const receiptFor = (entries) => ({ published: entries.map(([name, body]) => ({ name, sha256: sha(body) })) });

  it('⭐ publishes into an empty destination', () => {
    stage('edges-only-in-A.txt', 'a\nb\n');
    const r = publishEvidence({ stagingDir, publishDir, priorReceipt: null });
    expect(r.ok).toBe(true);
    expect(readdirSync(publishDir)).toEqual(['edges-only-in-A.txt']);
    expect(r.published[0].sha256).toBe(sha('a\nb\n'));
  });

  it('⭐ replaces artifacts whose current bytes match the last accepted receipt', () => {
    // The ordinary case: the destination is exactly what the previous run left, so a new run may
    // supersede it — and records what it replaced.
    place('edges-only-in-A.txt', 'old\n');
    stage('edges-only-in-A.txt', 'new\n');
    const r = publishEvidence({
      stagingDir, publishDir, priorReceipt: receiptFor([['edges-only-in-A.txt', 'old\n']]),
    });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(publishDir, 'edges-only-in-A.txt'), 'utf8')).toBe('new\n');
    expect(r.replaced).toEqual([{ name: 'edges-only-in-A.txt', priorSha256: sha('old\n') }]);
  });

  it('⛔⛔ REFUSES when a destination artifact was modified behind its back', () => {
    // The load-bearing case. A half-finished rerun, a manual edit, a restored backup — any of them
    // leaves bytes the accepted receipt cannot account for, and overwriting destroys the only
    // signal that anything happened.
    place('edges-only-in-B.txt', 'tampered\n');
    stage('edges-only-in-B.txt', 'fresh\n');
    const r = publishEvidence({
      stagingDir, publishDir, priorReceipt: receiptFor([['edges-only-in-B.txt', 'original\n']]),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('does not hold the bytes');
    // ⭐ AND NOTHING WAS WRITTEN. A refusal that had already half-published would be worse than none.
    expect(readFileSync(join(publishDir, 'edges-only-in-B.txt'), 'utf8')).toBe('tampered\n');
  });

  it('⛔⛔ REFUSES when a previously accepted artifact has gone MISSING', () => {
    // ⛔ THE DIRECTION NOBODY CHECKS. The first version iterated the DESTINATION and asked whether
    // each file was expected — so a deleted artifact produced no row to inspect and passed silently.
    // Review executed exactly this: a prior receipt naming two files, a destination holding one, and
    // publication proceeded while the code claimed the destination "must still hold exactly those
    // bytes". A subset check cannot see an absence.
    place('kept.txt', 'kept\n');
    stage('new.txt', 'new\n');
    const r = publishEvidence({
      stagingDir,
      publishDir,
      priorReceipt: receiptFor([['kept.txt', 'kept\n'], ['missing.txt', 'gone\n']]),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('MISSING');
  });

  it('⭐ CONTROL: exact set equality still publishes', () => {
    // Without this the assertion above is satisfied by refusing every destination that has any
    // history at all.
    place('kept.txt', 'kept\n');
    stage('kept.txt', 'fresher\n');
    const r = publishEvidence({
      stagingDir, publishDir, priorReceipt: receiptFor([['kept.txt', 'kept\n']]),
    });
    expect(r.ok).toBe(true);
  });

  it('⚠ the published hash matches the destination bytes — but this test CANNOT prove readback', () => {
    // The code reads each published file back from the DESTINATION rather than hashing what it sent,
    // because writeFileSync returning is transport, not confirmation: a truncated write, a full disk
    // or a filter driver all return normally.
    //
    // ⛔ AND THE MUTANT SURVIVES, WHICH I AM RECORDING RATHER THAN HIDING. Swapping the readback for
    // `readFileSync(stagingDir, ...)` leaves this test GREEN, because in a healthy filesystem the
    // staged and destination bytes are identical — the two readings only diverge in the failure this
    // change exists to catch. Distinguishing them needs fault injection at the write, which is not
    // built here. So the readback is a reasoned code change, NOT a tested one, and the assertion
    // below is a shape check rather than evidence.
    stage('edges-only-in-A.txt', 'x\ny\n');
    const r = publishEvidence({ stagingDir, publishDir, priorReceipt: null });
    expect(r.ok).toBe(true);
    const onDisk = readFileSync(join(publishDir, 'edges-only-in-A.txt'), 'utf8');
    expect(r.published[0].sha256).toBe(sha(onDisk));
  });

  it('⛔ REFUSES an unexpected file the accepted receipt never listed', () => {
    // Debris from a killed run looks exactly like this, and it must not be quietly absorbed.
    //
    // ⚠ THE EXPECTED FILE IS PLACED TOO, and that is the point of the fixture. Without it the newer
    // MISSING check fires first and this test passes for the wrong reason — it would be asserting a
    // refusal, just not the one it names. Isolating a branch means satisfying every earlier one.
    place('edges-only-in-A.txt', 'old\n');
    place('stray-from-a-killed-run.txt', 'debris\n');
    stage('edges-only-in-A.txt', 'fresh\n');
    const r = publishEvidence({
      stagingDir, publishDir, priorReceipt: receiptFor([['edges-only-in-A.txt', 'old\n']]),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('does not list it');
  });

  it('⛔ a prior receipt with no published list does not license overwriting', () => {
    // Older receipts predate the `published` field. Absent evidence of what SHOULD be there is not
    // permission to replace whatever is — the same fail-closed direction as everywhere else here.
    place('edges-only-in-A.txt', 'something\n');
    stage('edges-only-in-A.txt', 'fresh\n');
    const r = publishEvidence({ stagingDir, publishDir, priorReceipt: {} });
    expect(r.ok).toBe(false);
  });

  it('⭐ CONTROL: graph scratch directories are not published', () => {
    // Without this, the arm graph directories would be copied into the repository as evidence.
    mkdirSync(join(stagingDir, 'graph-A-arm'), { recursive: true });
    stage('edges-only-in-A.txt', 'a\n');
    const r = publishEvidence({ stagingDir, publishDir, priorReceipt: null });
    expect(r.ok).toBe(true);
    expect(readdirSync(publishDir)).toEqual(['edges-only-in-A.txt']);
  });
});
