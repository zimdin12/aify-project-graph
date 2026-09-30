// ⛔⛔ A VERDICT MUST SAY WHICH OF ITS CAUSES IT IS, AND A DAMAGED BASELINE MUST NOT PRODUCE A VERDICT AT ALL.
//
// `restamp` used to cover several situations with nothing but prose to tell them apart, and the dashboard
// merged them into one `unconfirmed` mark — so "not baselined yet" (harmless) read the same as "the baseline
// cannot be compared" (someone should act). Measured 2026-10-01 through the real resolver, the version-mismatch
// branch alone merged three causes:
//
//   anchor KIND edited symbol -> module   restamp  "stamped apg-symbol-shape-1, this provider stamps apg-file-structural-1"
//   stored stamp missing its version       restamp  "stamped undefined ..."
//   (my own format bumped)                 restamp  — the genuine case, zero occurrences so far
//
// ⛔ AND A DAMAGED ROW COULD PRODUCE A FALSE `changed`. A stored stamp with a valid version but NO hash passes the
// version check and then compares `undefined` against a real hash. The dashboard's `stampFrom` refuses such a stamp
// on write, so it needs a damaged row — which is exactly when someone ought to be told, not shown a code change.
//
// The fields are ADDITIVE: `cause` beside a restamp's prose, `reasonCode` beside an unwatched reason. Neither enters
// the dashboard's observation identity (built from `detailFor(status, head, evidence, trust)` and the unwatched
// reason), so adding them re-applies nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveAnchor, restampCause, STAMP_VERSIONS, UNWATCHED_REASONS,
} from '../../../scripts/lib/anchor-resolver.mjs';

const COMPLETE = Object.freeze({ parseHadError: false, depthCapFired: false, depthCap: 80 });
let repoRoot;
beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-causes-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'proof.js'), 'export function alpha() { return 1; }\n');
});
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

const deps = {
  languageOf: (rel) => { if (rel.endsWith('.js')) return { name: 'javascript' }; throw new Error('none'); },
  isDocument: () => false,
  readSource: () => 'source',
  extract: () => ({
    nodes: [
      { type: 'File', label: 'proof.js' },
      { type: 'Function', label: 'alpha', structural_fp: 'S1', dependency_fp: 'D1' },
    ],
    coverage: COMPLETE,
  }),
  fileFingerprint: () => 'FILE-FP',
  docReferences: () => [],
};
const symbol = (stamp) => resolveAnchor({
  repoRoot, deps, item: { watchId: 'w', anchor: { path: 'src/proof.js', name: 'alpha', kind: 'symbol' }, stamp },
});
// The hash the resolver really produces for this anchor, taken from a first look rather than hard-coded.
const liveHash = () => symbol(null).row.stamp.hash;

describe('a damaged baseline is refused, never turned into a verdict', () => {
  it('★★★ a stored stamp with a version but NO HASH is `unwatched`, not a false `changed`', () => {
    const out = symbol({ stampVersion: STAMP_VERSIONS.symbol, commit: 'c1' });
    expect(out.kind, 'a baseline with no hash must not be compared as if it had one').toBe('unwatched');
    expect(out.row.reasonCode).toBe('unreadable_baseline');
  });

  it('★★★ a stored stamp with a hash but NO VERSION is `unwatched`, not a "format" restamp', () => {
    const out = symbol({ hash: liveHash(), commit: 'c1' });
    expect(out.kind).toBe('unwatched');
    expect(out.row.reasonCode).toBe('unreadable_baseline');
    expect(out.row.reason).toBe(UNWATCHED_REASONS.unreadable_baseline);
  });

  it('★★★ INSTRUMENT CONTROL — a WELL-FORMED matching stamp still gets its verdict', () => {
    // ⛔ Without this the two refusals prove nothing: a resolver that refused every stored stamp would pass them.
    const out = symbol({ hash: liveHash(), stampVersion: STAMP_VERSIONS.symbol, commit: 'c1' });
    expect(out.kind).toBe('result');
    expect(out.row.status).toBe('unchanged');
  });
});

describe('restamp says which cause it is', () => {
  it('★★★ no stored stamp is `first-baseline`', () => {
    const out = symbol(null);
    expect(out.row.status).toBe('restamp');
    expect(out.row.cause).toBe('first-baseline');
  });

  it('★★★ a stamp from ANOTHER of my current families is `anchor-changed` — the anchor, not the format, moved', () => {
    // The stored version is one this provider produces TODAY, just not for this anchor's kind: the document's
    // anchor was edited (say symbol -> module) under a watchId that survives document revisions.
    const out = symbol({ hash: 'h', stampVersion: STAMP_VERSIONS.code, commit: 'c1' });
    expect(out.row.status).toBe('restamp');
    expect(out.row.cause).toBe('anchor-changed');
  });

  it('★★★ a version this provider has never produced is `unknown-format`, not a guess', () => {
    const out = symbol({ hash: 'h', stampVersion: 'someone-else-shape-9', commit: 'c1' });
    expect(out.row.status).toBe('restamp');
    expect(out.row.cause).toBe('unknown-format');
  });

  it('★★★ a RETIRED version of the needed family is `format-version` — the classifier, with an injected registry', () => {
    // ⚠ Unreachable in production TODAY: no format has ever been bumped, so the retired registry is empty. The
    // classifier is tested with an injected one so the branch is proven before the day it is needed, and this
    // comment says so rather than implying it fires now.
    const retired = { symbol: ['apg-symbol-shape-0'], code: [], doc: [] };
    expect(restampCause('apg-symbol-shape-0', STAMP_VERSIONS.symbol, retired)).toBe('format-version');
    // ...and the same version is NOT a format bump when the registry does not list it.
    expect(restampCause('apg-symbol-shape-0', STAMP_VERSIONS.symbol, { symbol: [], code: [], doc: [] }))
      .toBe('unknown-format');
  });

  it('★★★ only a restamp carries `cause` — an answered anchor does not', () => {
    const out = symbol({ hash: liveHash(), stampVersion: STAMP_VERSIONS.symbol, commit: 'c1' });
    expect(out.row.status).toBe('unchanged');
    expect(out.row).not.toHaveProperty('cause');
  });
});

describe('an unwatched row keeps its typed reason', () => {
  it('★★★ every unwatched row carries `reasonCode` equal to its key — derived from the table, not listed', () => {
    // The key existed all along (`unwatched(watchId, reasonKey)`) and was dropped before the row left.
    const kinds = { unsupported_anchor_kind: { path: 'src/proof.js', name: 'x', kind: 'paragraph' },
      no_path: { path: '', name: 'x', kind: 'symbol' } };
    for (const [expected, anchor] of Object.entries(kinds)) {
      const out = resolveAnchor({ repoRoot, deps, item: { watchId: 'w', anchor, stamp: null } });
      expect(out.kind).toBe('unwatched');
      expect(out.row.reasonCode).toBe(expected);
      expect(out.row.reason, 'the prose still travels beside the code').toBe(UNWATCHED_REASONS[expected]);
    }
  });
});
