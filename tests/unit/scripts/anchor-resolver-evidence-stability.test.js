// ⛔⛔ `changed` EVIDENCE MUST MOVE WHEN THE FINDING MOVES, AND ONLY THEN.
//
// The dashboard asked whether the evidence for an unchanged finding is identical from one commit to the next,
// because a mark that remembers its condition re-opens when the text moves. Measured 2026-10-01 through the
// real extractor and this resolver, two templates failed, in opposite directions:
//
//   `changed`      two DIFFERENT changes against one baseline   evidence IDENTICAL, candidate hash different
//                  (it named the stored baseline, never what is there now — so acknowledging the first change
//                  would have silently hidden the second: a false quiet)
//   `gone` symbol  an UNRELATED function added to the file      evidence DIFFERENT, finding unchanged
//                  (it embedded the symbol count and the first eight labels — safe, but re-opens on noise)
//
// The dashboard now builds its condition from the candidate stamp rather than the text. The `changed` text is
// fixed here as well, because a false quiet is wrong for a person reading it too. The `gone` text is KEPT as it
// is: its count is the population beside the verdict (asserted in anchor-resolver.test.js), the noise is in the
// safe direction, and the dashboard keys a gone finding on status + anchor + baseline, never on the text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAnchor, STAMP_VERSIONS } from '../../../scripts/lib/anchor-resolver.mjs';

const COMPLETE = Object.freeze({ parseHadError: false, depthCapFired: false, depthCap: 80 });
let repoRoot;
beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-stability-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'proof.js'), 'export function alpha() { return 1; }\n');
});
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

/** `alpha`'s dependency fingerprint, plus any unrelated symbols the file also holds. */
const depsWith = ({ alphaDeps = 'D1', others = [] } = {}) => ({
  languageOf: (rel) => { if (rel.endsWith('.js')) return { name: 'javascript' }; throw new Error('none'); },
  isDocument: () => false,
  readSource: () => 'source',
  extract: () => ({
    nodes: [
      { type: 'File', label: 'proof.js' },
      { type: 'Function', label: 'alpha', structural_fp: 'S1', dependency_fp: alphaDeps },
      ...others.map((label) => ({ type: 'Function', label, structural_fp: `S-${label}`, dependency_fp: `D-${label}` })),
    ],
    coverage: COMPLETE,
  }),
  fileFingerprint: () => 'FILE-FP',
  docReferences: () => [],
});
const resolve = (name, stamp, deps) => resolveAnchor({
  repoRoot, deps, item: { watchId: 'w', anchor: { path: 'src/proof.js', name, kind: 'symbol' }, stamp },
});
const BASELINE = Object.freeze({ hash: 'BASELINE-HASH', stampVersion: STAMP_VERSIONS.symbol, commit: 'c1' });

describe('`changed` evidence names what is there now', () => {
  it('★★★ two DIFFERENT changes against one baseline read DIFFERENTLY', () => {
    const first = resolve('alpha', BASELINE, depsWith({ alphaDeps: 'calls helper' }));
    const second = resolve('alpha', BASELINE, depsWith({ alphaDeps: 'calls other' }));
    // The instrument first: both really are `changed`, with different candidates. Without this, a pair of
    // `unchanged` rows (identical text, by design) would make the assertion below meaningless.
    expect([first.row.status, second.row.status]).toEqual(['changed', 'changed']);
    expect(first.row.stamp.hash).not.toBe(second.row.stamp.hash);
    expect(first.row.evidence, 'a false quiet: acknowledging the first change would hide the second')
      .not.toBe(second.row.evidence);
    expect(first.row.evidence).toContain(first.row.stamp.hash);
  });

  it('★★★ CONTROL — the SAME change reads IDENTICALLY, even when unrelated symbols come and go', () => {
    // The other direction: a fix that put anything free-moving into the text would pass the test above and fail
    // this one, re-opening an acknowledged change on every commit.
    const lone = resolve('alpha', BASELINE, depsWith({ alphaDeps: 'calls helper' }));
    const crowded = resolve('alpha', BASELINE, depsWith({ alphaDeps: 'calls helper', others: ['zeta', 'eta'] }));
    expect([lone.row.status, crowded.row.status]).toEqual(['changed', 'changed']);
    expect(crowded.row.evidence).toBe(lone.row.evidence);
  });
});

