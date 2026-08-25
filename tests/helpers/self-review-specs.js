// ⛔ ONE DERIVATION OF "WHAT IS A DECLARED SPEC", AND IT CLASSIFIES RATHER THAN FILTERS.
//
// The addressability gate and the migration ledger both walk `tests/self-review/`. When the ledger
// file landed in that directory, the addressability gate tried to iterate it as an array of specs
// and all five of its assertions died. The gate caught it — but it exposed that TWO tests each held
// their own opinion of what the directory contains.
//
// ⛔ AND THE FIRST FIX WAS A FILTER, WHICH IS THE WEAKER THING. `if (NON_SPEC_FILES.has(file))
// continue;` makes the tests green, and it also makes every future mistake invisible: a spec file
// misnamed, a spec file that stops parsing, a spec whose entries lose their required fields — all
// would be silently skipped, and the denominator would quietly shrink while every gate stayed green.
// the reviewer: *"fails if a would-be spec is silently excluded — not merely filters until
// tests turn green."*
//
// ⇒ EVERY `.json` IN THE DIRECTORY IS CLASSIFIED, and an unclassifiable one THROWS:
//
//     *.spec.json          -> must parse as a non-empty array of well-formed declarations
//     named apparatus      -> skipped BY CONTRACT, by exact name, never by pattern
//     anything else        -> ERROR. A new file must be deliberately classified, not absorbed.
//
// A shrinking denominator is the failure mode this whole corpus exists to prevent; it must not be
// reachable through the code that counts it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const SPEC_DIR = join(REPO, 'tests', 'self-review');

/**
 * Files in the spec directory that are apparatus, not witness declarations.
 *
 * ⛔ EXACT NAMES, NOT A PATTERN. A pattern like `!file.endsWith('.spec.json')` would absorb a
 * misnamed spec — `route-authority.json` instead of `route-authority.spec.json` — and count it as
 * apparatus. Every entry here is a deliberate decision someone had to write down.
 */
export const APPARATUS_FILES = new Set(['migration-ledger.json']);

/** The fields a declaration must carry to be a spec at all, independent of v3's case/expect. */
const REQUIRED_FIELDS = ['name', 'file', 'from', 'to', 'tests'];

/** Throws unless `entries` is a non-empty array of well-formed declarations. */
function assertWellFormed(file, entries) {
  if (!Array.isArray(entries)) {
    throw new Error(`${file} is a *.spec.json but does not hold an array — a spec file that cannot `
      + 'be read as declarations would silently contribute ZERO to every count.');
  }
  if (entries.length === 0) {
    throw new Error(`${file} declares no witnesses. An empty spec file is indistinguishable from a `
      + 'deleted one in the totals, so it must be removed or populated deliberately.');
  }
  entries.forEach((entry, i) => {
    const missing = REQUIRED_FIELDS.filter((f) => entry?.[f] == null);
    if (missing.length) {
      throw new Error(`${file}[${i}] (${entry?.name ?? 'unnamed'}) is missing ${missing.join(', ')} `
        + '— an incomplete declaration cannot be addressed, ruled on, or counted.');
    }
  });
}

/**
 * Every declared witness spec, derived physically from disk.
 *
 * @throws if any `.json` in the directory is neither a well-formed spec nor named apparatus.
 */
export function declaredSpecs() {
  const out = [];
  for (const file of readdirSync(SPEC_DIR)) {
    if (!file.endsWith('.json')) continue;          // non-JSON is not this contract's business
    if (APPARATUS_FILES.has(file)) continue;        // classified, by name, deliberately

    if (!file.endsWith('.spec.json')) {
      throw new Error(`${file} is an unclassified .json in ${SPEC_DIR}. Name it *.spec.json if it `
        + 'declares witnesses, or add it to APPARATUS_FILES if it does not. Silently skipping it '
        + 'would shrink the denominator with nothing to notice.');
    }

    let entries;
    try {
      entries = JSON.parse(readFileSync(join(SPEC_DIR, file), 'utf8'));
    } catch (err) {
      throw new Error(`${file} does not parse: ${err.message}. A spec file that stops parsing must `
        + 'break the gate, not vanish from the population.');
    }
    assertWellFormed(file, entries);
    for (const entry of entries) out.push({ spec: file, ...entry });
  }
  return out;
}
