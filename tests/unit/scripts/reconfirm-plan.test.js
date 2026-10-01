// ⛔⛔ A RECONFIRM WRITES THE BASELINE EVERY LATER SWEEP IS MEASURED AGAINST, AND IT SETTLES MARKS.
//
// So two things must hold, and this file bounds both:
//
//   1. It must refuse where there is nothing to vouch for — a `gone` anchor, an `unwatched` one, a result with
//      no stamp, a missing commit. A baseline written for any of those is one no sweep can honestly compare
//      against, and it would settle a mark on the strength of nothing.
//   2. ⭐ A BASELINE IT SETS MUST BE ONE THE SWEEP RECOGNISES. Reconfirm and sweep resolve through the same
//      `resolveAnchor`; if they ever diverged — a different stampVersion, a different hash input — every sweep
//      after a reconfirm would read `restamp` or `changed` for a reason nobody could see, and the live proof
//      this exists for would fail at its step (e) looking like the SERVICE's bug. The round-trip arm is that.
//
// And it must never be a sweep: `parseReconfirmArgs` refuses to run without anchors named one by one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAnchor, STAMP_VERSIONS } from '../../../scripts/lib/anchor-resolver.mjs';
import { planReconfirm, parseReconfirmArgs, RECONFIRM_REFUSALS } from '../../../scripts/lib/reconfirm-plan.mjs';

const HEAD = 'a'.repeat(40);
const COMPLETE = Object.freeze({ parseHadError: false, depthCapFired: false, depthCap: 80 });

let repoRoot;
beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-reconfirm-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'proof.js'), 'export function alpha() { return 1; }\n');
});
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

// The resolver's real decision code, with the extractor faked to a controllable symbol shape.
function deps({ structural = 'S1', dependency = 'D1' } = {}) {
  return {
    languageOf: (rel) => { if (rel.endsWith('.js')) return { name: 'javascript' }; throw new Error('none'); },
    isDocument: () => false,
    readSource: () => 'source',
    extract: () => ({
      nodes: [
        { type: 'File', label: 'proof.js' },
        { type: 'Function', label: 'alpha', structural_fp: structural, dependency_fp: dependency },
      ],
      coverage: COMPLETE,
    }),
    fileFingerprint: () => `file-${structural}-${dependency}`,
    docReferences: () => [],
  };
}
const symbolItem = (stamp = null) => ({
  watchId: 'w-alpha', anchor: { path: 'src/proof.js', name: 'alpha', kind: 'symbol' }, stamp,
});

describe('planReconfirm refuses where there is nothing to vouch for', () => {
  it('★★★ a GONE anchor is refused — there is nothing to take a baseline of', () => {
    // ⛔ THE ROW CARRIES A STAMP-SHAPED FIELD ON PURPOSE, and the first version of this arm did not. Without it,
    // removing the `gone` check (mutation M13) still refused — as `no_stamp`, because a real `gone` row has no
    // stamp — so the arm went red for the REASON and proved nothing about a baseline being written. The
    // mutation was named "gone anchor gets a baseline" and its red did not show that. With a stamp present,
    // the `gone` check is the only thing between a malformed row and a baseline for a target that is not there,
    // which is the guard failing closed on its own inputs rather than on a promise made by the resolver.
    const resolved = { kind: 'result', row: { watchId: 'w', status: 'gone', evidence: 'x', stamp: { hash: 'h', stampVersion: 'v' } } };
    const plan = planReconfirm(resolved, { head: HEAD });
    expect(plan.ok).toBe(false);
    expect(plan.refusal).toBe('gone');
  });

  it('★★★ an UNWATCHED anchor is refused, whatever else the row holds', () => {
    // ⛔ The row is given a stamp-shaped field on purpose. A plan that looked for a stamp before checking the
    // kind would find one here and write a baseline for an anchor the resolver declined to answer.
    const resolved = { kind: 'unwatched', row: { watchId: 'w', reason: 'partial parse', stamp: { hash: 'h', stampVersion: 'v' } } };
    const plan = planReconfirm(resolved, { head: HEAD });
    expect(plan.ok).toBe(false);
    expect(plan.refusal).toBe('unwatched');
  });

  it('★★★ a result with no usable stamp, or no commit, is refused', () => {
    const noStamp = { kind: 'result', row: { watchId: 'w', status: 'restamp' } };
    expect(planReconfirm(noStamp, { head: HEAD }).refusal).toBe('no_stamp');
    const emptyHash = { kind: 'result', row: { watchId: 'w', status: 'restamp', stamp: { hash: '', stampVersion: 'v' } } };
    expect(planReconfirm(emptyHash, { head: HEAD }).refusal).toBe('no_stamp');
    // ⛔ The service's `stampFrom` refuses a stamp without a commit as `bad_stamp`; refusing here says why first.
    const good = { kind: 'result', row: { watchId: 'w', status: 'restamp', stamp: { hash: 'h', stampVersion: 'v' } } };
    expect(planReconfirm(good, { head: '' }).refusal).toBe('no_head');
    expect(planReconfirm(good, { head: undefined }).refusal).toBe('no_head');
  });

  it('★★★ INSTRUMENT CONTROL — a `changed` result IS reconfirmable, with the commit attached', () => {
    // ⛔ Without this the refusals above prove nothing: a plan that refused everything would pass them all.
    // And `changed` specifically, because reconfirming after a change is the whole point of step (f).
    const changed = { kind: 'result', row: { watchId: 'w', status: 'changed', stamp: { hash: 'h2', stampVersion: 'v' } } };
    expect(planReconfirm(changed, { head: HEAD })).toEqual({
      ok: true, watchId: 'w', stamp: { hash: 'h2', stampVersion: 'v', commit: HEAD },
    });
    // Every refusal names prose an operator can act on, derived from the table rather than listed here.
    for (const [key, text] of Object.entries(RECONFIRM_REFUSALS)) {
      expect(text.length, `${key} must say why`).toBeGreaterThan(30);
    }
  });
});

describe('⭐ a baseline set by reconfirm is one the sweep recognises', () => {
  it('★★★ ROUND TRIP: reconfirm the resolved stamp, and the next sweep of the same code says `unchanged`', () => {
    // First look: no baseline, so the sweep says `restamp` and carries the stamp it would compare against.
    const first = resolveAnchor({ repoRoot, item: symbolItem(null), deps: deps() });
    expect(first.row.status).toBe('restamp');
    const plan = planReconfirm(first, { head: HEAD });
    expect(plan.ok).toBe(true);

    // The service stores exactly what was sent and hands it back on the next watch-set read.
    const stored = { hash: plan.stamp.hash, stampVersion: plan.stamp.stampVersion, commit: plan.stamp.commit };
    const second = resolveAnchor({ repoRoot, item: symbolItem(stored), deps: deps() });
    // ⛔ THE ASSERTION THE LIVE PROOF'S STEP (e) DEPENDS ON. If reconfirm and sweep computed different stamps,
    // this would say `restamp` (version) or `changed` (hash) about code that did not move.
    expect(second.row.status, 'the sweep must recognise the baseline reconfirm just set').toBe('unchanged');
    expect(plan.stamp.stampVersion).toBe(STAMP_VERSIONS.symbol);
  });

  it('★★★ NEGATIVE CONTROL — the same baseline against MOVED code says `changed`', () => {
    // ⛔ Without this the round trip proves nothing: a sweep that always said `unchanged` would pass it. Here the
    // function starts referencing something new — step (d) of the proof — and the dependency shape moves.
    const first = resolveAnchor({ repoRoot, item: symbolItem(null), deps: deps({ dependency: 'D1' }) });
    const plan = planReconfirm(first, { head: HEAD });
    const stored = { ...plan.stamp };
    const after = resolveAnchor({ repoRoot, item: symbolItem(stored), deps: deps({ dependency: 'D2-now-calls-gamma' }) });
    expect(after.row.status).toBe('changed');
  });
});

describe('parseReconfirmArgs refuses to be a sweep', () => {
  it('★★★ NO anchor named is a refusal — there is deliberately no "all"', () => {
    expect(() => parseReconfirmArgs([])).toThrow(/deliberately no "all"/u);
    expect(() => parseReconfirmArgs(['--dry-run'])).toThrow(/deliberately no "all"/u);
  });

  it('★★★ a malformed argument is refused rather than guessed at', () => {
    expect(() => parseReconfirmArgs(['--watch'])).toThrow(/needs a watchId/u);
    expect(() => parseReconfirmArgs(['--watch', '--dry-run'])).toThrow(/needs a watchId/u);
    expect(() => parseReconfirmArgs(['--watch', 'w1', '--all'])).toThrow(/unknown argument/u);
  });

  it('★★★ each named anchor is collected, in order — the positive control for the refusals above', () => {
    expect(parseReconfirmArgs(['--watch', 'w-alpha'])).toEqual({ watchIds: ['w-alpha'], dryRun: false, allowDirty: false });
    expect(parseReconfirmArgs(['--watch', 'w-alpha', '--watch', 'w-beta', '--dry-run']))
      .toEqual({ watchIds: ['w-alpha', 'w-beta'], dryRun: true, allowDirty: false });
  });

  it('★★★ --allow-dirty is collected, and is OFF unless named', () => {
    // A baseline taken from uncommitted code persists under a commit that does not hold it, so the default
    // must be to refuse (`dirtyRefusal` in provider-runtime.mjs), and only an explicit flag may override it.
    expect(parseReconfirmArgs(['--watch', 'w-alpha', '--allow-dirty']).allowDirty).toBe(true);
    expect(parseReconfirmArgs(['--watch', 'w-alpha']).allowDirty).toBe(false);
  });
});
