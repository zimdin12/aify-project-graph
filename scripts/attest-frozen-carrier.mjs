#!/usr/bin/env node
// REGENERATE AND VERIFY THE FROZEN-CARRIER ATTESTATION — the numbers the migration parity test
// rests on.
//
// ⛔ THIS LIVES IN THE REPOSITORY BECAUSE THE NUMBERS MUST BE REPRODUCIBLE WITHOUT ME.
// The first attestation was produced by an untracked scratch script, so `2,547 keys repeat` and
// `32,562 distinct` were committed as bare figures whose DEFINITION of distinct existed nowhere a
// reader could reach. Reviewer caught it: a count of distinct anything is meaningless without the
// key, and a number nobody else can regenerate is a claim rather than evidence.
//
// The identity key is imported from the one owner in storage/unresolved-refs.js, which the parity
// test also imports. Neither can drift from the other, and the definition travels with the numbers.
//
//   node scripts/attest-frozen-carrier.mjs           rewrite the canonical attestation
//   node scripts/attest-frozen-carrier.mjs --check   verify without rewriting; nonzero on drift
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// TWO DOMAINS, AND ONLY ONE OF THEM MAY BE RECOMPUTED.
//
//   capture         — who produced the frozen bytes and when. HISTORY. Pinned as a literal below.
//   carrierDerived  — everything recomputable from the frozen bytes plus the shared key owner.
//
// The first version of this generator read the LIVE .aify-graph/manifest.json and wrote it as
// producedBy, so every regeneration reassigned the immutable carrier to whatever graph happened to
// be indexed at that moment — overwriting the true producer (1050fb5, 19:09:41Z) with the commit
// being worked on. A false lineage claim, and it also made --check drift by construction after any
// HEAD movement, defeating the verification entirely.
//
// ⚠ THE CEILING ON --check, STATED RATHER THAN IMPLIED.
// `capture` cannot be verified by recomputation: there is no live source for history, and comparing
// the file's capture against a copy read from that same file is vacuous — it passes by
// construction. So capture is pinned as a LITERAL here and compared against the file. That catches
// a hand-edit of either one, because the two live in different files and a diff shows it. It does
// NOT catch someone editing both together; nothing can, and the way to audit that is
//
//   git show 91c108a:docs/evidence/unresolved-refs-migration/carrier-attestation.json
//
// which is an independent substrate (the object store), not a second read of the working tree.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  IDENTITY_KEY_FIELDS, IDENTITY_KEY_SEPARATOR, identityKey,
} from '../mcp/stdio/storage/unresolved-refs.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(REPO, 'docs/evidence/unresolved-refs-migration');
const CARRIER = join(DIR, 'dirty-edges.full.frozen.json');
const OUT = join(DIR, 'carrier-attestation.json');

// ⛔ PINNED HISTORY. Every value here was read from the attestation committed in 91c108a and is
// carried forward verbatim. Nothing in this block is recomputed, and no future run may improve it.
//
// ⚠ `instrumentTree` IS DELIBERATELY THIN — a bare `dirtyPaths: 1` count with no path names. That
// disclosure is weaker than what this generator emits for its own runs now. It is preserved as it
// was because upgrading a capture record retroactively is inventing history rather than recording
// it: nobody knows today which path was dirty then, and a plausible reconstruction is a lie with
// good manners.
const CAPTURE = {
  frozenAt: '2026-08-30T19:25:09.689Z',
  producedBy: {
    manifestCommit: '1050fb55b7bff20e3f00c3f6f5ac9d8636d1a343',
    manifestIndexedAt: '2026-08-30T19:09:41.089Z',
    manifestStatus: 'ok',
  },
  instrumentTree: {
    head: '1050fb55b7bff20e3f00c3f6f5ac9d8636d1a343',
    dirtyPaths: 1,
  },
  ceiling: 'Carrier byte identity is attested. A clean instrument tree at capture time is NOT.',
  // A second party's count of the same population at a different index state. Kept beside the
  // capture rather than beside the derived numbers because it is history, not arithmetic: it can
  // never be recomputed from the frozen bytes, and it is the reason they were frozen at all.
  reviewerCensus: {
    rowCount: 35885,
    note: 'graph-senior-dev measured 35,885 on an earlier index state, against 35,906 here. That '
      + 'disagreement is exactly why the carrier had to be frozen rather than read live.',
  },
};

const PURPOSE = 'Immutable legacy carrier for the unresolved-refs SQLite migration parity test.';
const REGENERATE_WITH =
  'node scripts/attest-frozen-carrier.mjs  (--check to verify without rewriting)';

// ── carrierDerived: recomputed from the frozen bytes on every run ────────────────────────────────
const raw = readFileSync(CARRIER);
const envelope = JSON.parse(raw.toString('utf8'));
const rows = envelope.dirtyEdges;
if (!Array.isArray(rows)) throw new Error('carrier envelope changed shape: no dirtyEdges array');

const fieldPopulation = {};
for (const r of rows) for (const k of Object.keys(r)) fieldPopulation[k] = (fieldPopulation[k] ?? 0) + 1;

const mult = new Map();
for (const r of rows) {
  const k = identityKey(r);
  mult.set(k, (mult.get(k) ?? 0) + 1);
}
const repeats = [...mult.values()].filter((n) => n > 1);

const carrierDerived = {
  carrier: {
    path: 'docs/evidence/unresolved-refs-migration/dirty-edges.full.frozen.json',
    bytes: statSync(CARRIER).size,
    sha256: createHash('sha256').update(raw).digest('hex'),
    rowCount: rows.length,
    envelopeShape: { keys: Object.keys(envelope), rowsUnder: 'dirtyEdges' },
    envelopeCountField: envelope.count ?? null,
    envelopeWrittenAt: envelope.writtenAt ?? null,
  },
  fieldPopulation,
  // ⭐ THE DEFINITION TRAVELS WITH THE NUMBERS. Field ORDER is part of it: a different order is a
  // different canonical encoding and therefore a different distinct-count.
  identityKey: {
    owner: 'mcp/stdio/storage/unresolved-refs.js',
    fields: [...IDENTITY_KEY_FIELDS],
    separator: `U+${IDENTITY_KEY_SEPARATOR.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`,
    encoding: 'fields joined in the order above; a null or missing field contributes an empty string',
  },
  duplicateMultiplicity: {
    distinctIdentityKeys: mult.size,
    identityKeysAppearingMoreThanOnce: repeats.length,
    maxMultiplicity: repeats.length ? Math.max(...repeats) : 1,
    rowsLostToDeduplication: rows.length - mult.size,
    note: 'The table uses a surrogate row id and must preserve this multiset exactly. Deduplicating '
      + 'by the CANONICAL identityKey above — a UNIQUE on a materialised non-null key column, or an '
      + 'upsert keyed by that identity — would discard rowsLostToDeduplication rows and report '
      + 'success. NOT a plain UNIQUE over the nullable identity columns: identityKey maps '
      + 'missing/null to an empty string and SQLite does not, so NULLs compare distinct there. '
      + 'from_target and to_id are absent from every row, so that constraint would discard nothing. '
      + 'The loss is real under the key this file defines; naming the wrong mechanism would send a '
      + 'reader to defend against a constraint that was never the hazard.',
  },
};

// ⛔ THE CANONICAL OBJECT IS EXACTLY THESE FOUR KEYS.
// Nothing about the run that produced or verified this file is persisted here. A field that every
// regeneration rewrites but no comparison reads is mutable noise beside frozen facts, and it makes
// `git diff` on an immutable evidence file dirty for no reason. The verification run discloses
// itself on STDOUT instead — see the receipt below.
const attestation = { purpose: PURPOSE, regenerateWith: REGENERATE_WITH, capture: CAPTURE, carrierDerived };

// ── comparison ───────────────────────────────────────────────────────────────────────────────────
// ⭐ COMPARE THE WHOLE OBJECT, NOT A FIELD LIST. The previous --check named five fields and printed
// "attestation reproduces from the frozen carrier: OK" — so a committed-false rowsLostToDeduplication,
// fieldPopulation, maxMultiplicity, byte length or envelope shape passed as verified. A gate that
// cannot fail for most of what it covers is not a gate. Walking the object means a field ADDED to
// the generator is covered the day it is added, with nobody remembering to extend a list.
function diffPaths(expected, actual, path = '') {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(expected) || !isObj(actual)) return [path || '(root)'];
  const out = [];
  for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    out.push(...diffPaths(expected[k], actual[k], path ? `${path}.${k}` : k));
  }
  return out;
}

if (process.argv.includes('--check')) {
  // `--file <path>` checks a CANDIDATE attestation instead of the committed one. Two callers need
  // it: a reviewer verifying a proposed file without touching the tree, and the mutation tests,
  // which must challenge the REAL gate end to end. Testing the comparison helper alone would have
  // missed the actual defect here — the helper was fine, the wiring compared five fields.
  const fileArg = process.argv.indexOf('--file');
  const target = fileArg !== -1 && process.argv[fileArg + 1] ? process.argv[fileArg + 1] : OUT;
  const committedRaw = readFileSync(target);
  const committed = JSON.parse(committedRaw.toString('utf8'));
  const drift = diffPaths(attestation, committed);

  // The verification run discloses ITSELF here and nowhere else. It binds this run to the exact
  // bytes it read, so a receipt pasted into a review names what was actually checked.
  const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  const receipt = {
    verifiedAt: new Date().toISOString(),
    head: execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyPathCount: dirty.length,
    // Strip the 2-char status plus its separator by PATTERN, not a fixed offset — and NOT through a
    // helper that trims, because a porcelain line begins with a space for a worktree-only change
    // (" M path") and trimming the whole output ate that space on the first line only.
    dirtyPaths: dirty.map((l) => l.replace(/^.{2}\s+/, '')),
    carrierSha256: carrierDerived.carrier.sha256,
    attestationFile: target === OUT ? "docs/evidence/unresolved-refs-migration/carrier-attestation.json" : target,
    attestationSha256: createHash("sha256").update(committedRaw).digest("hex"),
    capturePinnedIn: 'scripts/attest-frozen-carrier.mjs (literal CAPTURE)',
    captureAuditWith: 'git show 91c108a:docs/evidence/unresolved-refs-migration/carrier-attestation.json',
    coverage: drift.length ? 'DRIFT' : 'every key of the canonical object compared, not a subset',
  };
  console.log(JSON.stringify(receipt, null, 2));

  if (drift.length) {
    console.error(`ATTESTATION DRIFT (${drift.length}): ${drift.join(', ')}`);
    process.exit(1);
  }
  console.log('attestation reproduces from the frozen carrier: OK');
  process.exit(0);
}

writeFileSync(OUT, `${JSON.stringify(attestation, null, 2)}\n`);
console.log(JSON.stringify({
  rows: carrierDerived.carrier.rowCount,
  distinctKeys: carrierDerived.duplicateMultiplicity.distinctIdentityKeys,
  repeats: carrierDerived.duplicateMultiplicity.identityKeysAppearingMoreThanOnce,
  rowsLostToDeduplication: carrierDerived.duplicateMultiplicity.rowsLostToDeduplication,
  identityFields: carrierDerived.identityKey.fields.length,
}, null, 2));
