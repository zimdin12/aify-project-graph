// ⛔ A HASH WITHOUT ITS PREIMAGE IS IDENTITY WITHOUT AUDITABLE CONTENT.
//
// The G8 manifest names the exact one-arm spec the run consumed, by sha256 — but that file lived in
// a session scratchpad OUTSIDE the repo, so the committed receipt recorded a hash whose content
// nobody else could read. graph-senior-dev: *"reconstruct and commit the exact spec, admissible
// only if its SHA-256 exactly equals the already-recorded f810cb…"*
//
// ⚠ The file was never deleted — it was never COMMITTED, which is a different failure and the one
// worth naming: evidence outside the repo is evidence only its author can check.
//
// This gate proves the committed preimage IS the bytes the run consumed, and that those bytes were
// derived from the two committed sources rather than hand-written.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { REPO } from '../../helpers/self-review-specs.js';
import { validateV3Spec } from '../../../scripts/lib/spec-schema.mjs';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const SR = join(REPO, 'tests', 'self-review');
const RECEIPT = join(SR, 'receipts', 'G8');

/** The hash frozen in the run manifest, before the preimage was committed. */
const FROZEN_SHA = 'f810cb5014d001267dc24a5d6da13a88a7eef74cb99ab720ba965df0d8bcab3b';

const read = (p) => readFileSync(p, 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');

describe('the G8 receipt preimage is the exact input the run consumed', () => {
  it('★★★ the committed spec hashes to the value frozen in the manifest', () => {
    // ⛔ THE ADMISSIBILITY TEST. Anything else — a near-equivalent, a re-serialisation, a file with
    // different whitespace — is a DIFFERENT experiment wearing the same name.
    const bytes = readFileSync(join(RECEIPT, 'g8-run.spec.json'));
    expect(sha(bytes)).toBe(FROZEN_SHA);
  });

  it('★★★ the manifest names that same hash — the receipt is self-consistent', () => {
    const manifest = read(join(RECEIPT, 'manifest.json'));
    expect(manifest, 'the run recorded the spec it consumed').toContain(FROZEN_SHA);
  });

  it('★★★ the mutation bytes were DERIVED from the declared spec, not retyped', () => {
    // Hand-transcribing the mutation would let a typo become the experiment. These four fields must
    // be byte-equal to the declaration; if anyone edits G8, this reddens and the receipt's
    // provenance is visibly broken rather than silently stale.
    const [preimage] = JSON.parse(read(join(RECEIPT, 'g8-run.spec.json')));
    const [declared] = JSON.parse(read(join(SR, 'route-authority-G8.spec.json')));
    for (const field of ['name', 'file', 'from', 'to']) {
      expect(preimage[field], `${field} must equal the declaration`).toEqual(declared[field]);
    }
    expect(preimage.tests).toEqual(declared.tests);
  });

  it('★★★ the predicate was DERIVED from the preregistration, not from mutant output', () => {
    // ⛔ THE RULE THE WHOLE PROTOCOL EXISTS FOR. My earlier W1 probe read its predicate out of the
    // failure it was meant to predict. Binding these to the committed preregistration makes that
    // impossible to repeat without the test going red.
    const [preimage] = JSON.parse(read(join(RECEIPT, 'g8-run.spec.json')));
    const prereg = JSON.parse(read(join(SR, 'preregistrations', 'G8.json')));
    expect(preimage.case).toBe(prereg.case);
    expect(preimage.expect).toBe(prereg.expect);
    expect(prereg.specId).toBe(preimage.name);
  });

  it('★★★ the mutation is the CONSTANT forgery, not the known-surviving derived variant', () => {
    // The referee forbade strengthening it. A path-deriving lookalike is known to survive and
    // belongs as a negative result, not a predicted red.
    const [preimage] = JSON.parse(read(join(RECEIPT, 'g8-run.spec.json')));
    // ⛔ CONTROLLED ABSENCE. The canaries prove the matcher fires on a derived variant and does
    // NOT fire on the constant one, so its silence about `preimage.to` means something.
    expectAbsentWithLiveMatcher(
      /projectRoot|repoRoot/,
      { forbidden: 'const p = normalize(req.projectRoot)', allowed: "collectionId: 'ci-' + stamp" },
      preimage.to,
      'no request-derived repository identity in the constant forgery',
    );
    expect(preimage.to, 'it does mint a formatted id').toMatch(/collectionId/);
  });

  it('★★★ CONTROL: the hash check can FAIL — a changed byte changes the hash', () => {
    // Without this, "the hashes match" is satisfied by a comparison that always agrees.
    const bytes = read(join(RECEIPT, 'g8-run.spec.json'));
    // `not.toBe` on a hash is not a matcher-absence assertion — a changed byte provably changes
    // the digest, and the positive half is asserted above.
    expect(sha(`${bytes} `), 'one appended space is a different file').not.toBe(FROZEN_SHA);
  });
});

describe('the tracked G8 spec is loadable by the normal invocation', () => {
  it('★★★ route-authority-G8.spec.json loads under the v3 contract', () => {
    // ⛔ THE 0/35 DEFECT, PREVENTED. G8 must not be labelled runnable while its declared file
    // cannot be loaded by any supported invocation. This executes the loadability contract the
    // apparatus itself uses — no external construction step.
    const spec = JSON.parse(read(join(SR, 'route-authority-G8.spec.json')));
    const result = validateV3Spec(spec);
    expect(result.problems).toEqual([]);
    expect(result.loadable).toBe(true);
  });

  it('★★★ the legacy seven-arm file is still NOT loadable, and that is recorded honestly', () => {
    // ⚠ POSITIVE CONTROL for the validator: if it called everything loadable, the assertion above
    // would be worthless. The legacy file genuinely cannot load, which is why its arms remain
    // legacy_unruled rather than being quietly counted.
    const legacy = JSON.parse(read(join(SR, 'route-authority.spec.json')));
    expect(legacy.length, 'exactly one declaration moved out').toBe(7);
    expect(validateV3Spec(legacy).loadable, 'still pre-v3').toBe(false);
  });

  it('★★★ extraction preserved the population — 35 declarations, no more, no fewer', () => {
    // A physical move must not create or lose a witness. This is the number every other count
    // depends on.
    const { declaredSpecs } = SPECS;
    expect(declaredSpecs().length).toBe(35);
  });
});

import * as SPECS from '../../helpers/self-review-specs.js';
