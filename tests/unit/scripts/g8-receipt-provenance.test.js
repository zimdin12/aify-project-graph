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
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO } from '../../helpers/self-review-specs.js';
import { validateV3Spec } from '../../../scripts/lib/spec-schema.mjs';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const SR = join(REPO, 'tests', 'self-review');
const RECEIPT = join(SR, 'receipts', 'G8');
const BIN_PATH = 'tests/self-review/receipts/G8/g8-run.spec.bin';
const JSON_PATH = 'tests/self-review/receipts/G8/g8-run.spec.json';

/** The preimage as GIT holds it — the bytes any other machine receives. */
const committedPreimage = () =>
  execFileSync('git', ['show', `HEAD:${BIN_PATH}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 20 });

/** The hash frozen in the run manifest, before the preimage was committed. */
const FROZEN_SHA = 'f810cb5014d001267dc24a5d6da13a88a7eef74cb99ab720ba965df0d8bcab3b';

const read = (p) => readFileSync(p, 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');

describe('the G8 receipt preimage is the exact input the run consumed', () => {
  it('★★★ the COMMITTED GIT OBJECT hashes to the value frozen in the manifest', () => {
    // ⛔⛔ THE WORKING TREE IS NOT THE EVIDENCE. My first attempt hashed the file on disk and
    // passed — while the committed blob was a DIFFERENT 630-byte LF normalisation
    // (805c18f2…) of the 642-byte CRLF bytes the run consumed (f810cb50…). `git status` stayed
    // clean because the clean filter treats the two forms as equivalent, so every check in my
    // checkout agreed with me and a fresh clone would have failed them.
    //
    // ⇒ **Git object identity is not the original byte content when a clean filter is in play.**
    // The payload is committed under a `-text` attribute and adjudicated through `git show`, which
    // is what any other machine will receive.
    const committed = execFileSync('git', ['show', `HEAD:${BIN_PATH}`], {
      cwd: REPO, encoding: 'buffer', maxBuffer: 1 << 20,
    });
    expect(committed.length, 'the exact byte length the run consumed').toBe(642);
    expect(sha(committed), 'the immutable object IS the preimage').toBe(FROZEN_SHA);
  });

  it('★★★ the -text attribute is actually in force for that path', () => {
    // A `.gitattributes` rule that does not match the path is decoration. Asked of git rather than
    // read out of the file, because what matters is the attribute git RESOLVES.
    const attr = execFileSync('git', ['check-attr', 'text', '--', BIN_PATH], { cwd: REPO, encoding: 'utf8' });
    expect(attr, 'text must be explicitly unset, or git will normalise on checkout').toMatch(/text: unset/);
  });

  it('★★★ CONTROL: the normalised .json copy does NOT hash to the frozen value', () => {
    // ⛔ THE NEAR-EQUIVALENT, PINNED AS THE THING WE REJECT. Keeping the readable copy is useful;
    // letting it stand in for the preimage is the defect. This asserts they are different objects
    // so nobody can later delete the .bin and point provenance at the .json.
    const normalised = execFileSync('git', ['show', `HEAD:${JSON_PATH}`], {
      cwd: REPO, encoding: 'buffer', maxBuffer: 1 << 20,
    });
    expect(sha(normalised), 'the text-filtered copy is a different object').not.toBe(FROZEN_SHA);
    expect(normalised.length, 'shorter by exactly the CR bytes').toBe(630);
  });

  it('★★★ the manifest names that same hash — the receipt is self-consistent', () => {
    const manifest = read(join(RECEIPT, 'manifest.json'));
    expect(manifest, 'the run recorded the spec it consumed').toContain(FROZEN_SHA);
  });

  it('★★★ the mutation bytes were DERIVED from the declared spec, not retyped', () => {
    // Hand-transcribing the mutation would let a typo become the experiment. These four fields must
    // be byte-equal to the declaration; if anyone edits G8, this reddens and the receipt's
    // provenance is visibly broken rather than silently stale.
    const [preimage] = JSON.parse(committedPreimage());
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
    const [preimage] = JSON.parse(committedPreimage());
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
    const bytes = committedPreimage();
    // `not.toBe` on a hash is not a matcher-absence assertion — a changed byte provably changes
    // the digest, and the positive half is asserted above.
    expect(sha(`${bytes} `), 'one appended byte is a different object').not.toBe(FROZEN_SHA);
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

  it('★★★ the TRACKED D1 spec also loads — promoted before any experiment', () => {
    // ⛔ PROMOTED TO runnable-unwitnessed ON SCHEMA ALONE, never on a result. G8's carrier gap was
    // an externally-constructed one-arm spec whose preimage was not committed; D1 is extracted and
    // tracked BEFORE its run, so the experiment consumes the declared file directly.
    const spec = JSON.parse(read(join(SR, 'dashboard-ownership-D1.spec.json')));
    expect(validateV3Spec(spec).problems).toEqual([]);
    expect(spec[0].expectFailures, 'the failing-case population is preregistered').toBe(1);
    expect(spec[0].withdrawnTitle, 'the corrected title records what it replaced').toMatch(/WITHDRAWN/);
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
