// ⛔ FIXTURES FOR A CONTRACT WHOSE PRODUCER NO LONGER EXISTS.
//
// The commit-to-commit structural comparison is WITHDRAWN: a stored digest cannot be attributed to
// the source its named commit contained, because the indexer parses the working tree and carries
// unchanged rows forward. What survives is a REFUSAL, the stored rows, and the table — and all
// three still have to be testable.
//
// ⭐ WHY BYTES AND NOT A CALL TO THE BUILDER. Regenerating fixtures through a writer that moves
// alongside its reader only proves the pair still agree with EACH OTHER; both could drift together
// and the test would stay green. These are the bytes the retired writer actually produced, frozen
// at the commit named in the fixture's own provenance, so what is under test is whether the code
// that SURVIVES can still read the format that was stored.
//
// ⚠ THE ONE FIELD CONSUMERS MAY CHANGE IS `commit`, and the fixture says so itself. The store keys
// rows on it, so a test needing fifty rows needs fifty commits; it is an address, not part of the
// shape being pinned. Every other field is exactly as written.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('../fixtures/structural-digest/retained-digests.json', import.meta.url)),
  'utf8',
));

const TEMPLATES = Object.keys(FIXTURE).filter((k) => !k.startsWith('_'));

/**
 * A retained digest, addressed to `commit`.
 *
 * @param {'withdrawnBefore'|'withdrawnAfter'|'renderLoad'|'renderLoadPlus'} name
 * @param {string} commit  40-char sha this row should be stored under
 * @returns {object} a deep copy — callers may not mutate the shared fixture
 */
export function retainedDigest(name, commit) {
  const template = FIXTURE[name];
  // ⛔ FAIL CLOSED ON A NAME NOBODY FROZE. Returning undefined here would surface as a confusing
  // failure deep inside the store, and a typo'd template name would look like a storage defect.
  if (!template) {
    throw new Error(`retainedDigest: no frozen template '${name}' — have: ${TEMPLATES.join(', ')}`);
  }
  if (!commit) throw new Error('retainedDigest: a commit is required — the store keys rows on it');
  return { ...structuredClone(template), commit };
}

/** The digest version these bytes were written at, for tests that pin compatibility. */
export const RETAINED_DIGEST_VERSION = FIXTURE._provenance.digestVersion;
