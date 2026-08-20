// ⛔ ONE DERIVATION OF "WHAT IS A DECLARED SPEC".
//
// The addressability gate and the migration ledger both walk `tests/self-review/`. When the ledger
// file landed in that directory, the addressability gate tried to iterate it as an array of specs
// and every one of its five assertions died — the gate caught it, which is the system working, but
// it exposed that TWO tests held their own opinion of what the directory contains.
//
// ⇒ Two copies of a membership rule disagree eventually, and the one that decides a denominator
// would be the one nobody noticed was wrong. The exclusion lives here, once.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const SPEC_DIR = join(REPO, 'tests', 'self-review');

/** Files in the spec directory that are NOT witness declarations. */
export const NON_SPEC_FILES = new Set(['migration-ledger.json']);

/**
 * Every declared witness spec, derived physically from disk.
 *
 * ⚠ Returns a Map keyed by spec name so a duplicate ID collapses rather than double-counting — the
 * uniqueness gate asserts against the raw list, not this.
 */
export function declaredSpecs() {
  const out = [];
  for (const file of readdirSync(SPEC_DIR)) {
    if (!file.endsWith('.json') || NON_SPEC_FILES.has(file)) continue;
    for (const entry of JSON.parse(readFileSync(join(SPEC_DIR, file), 'utf8'))) {
      out.push({ spec: file, ...entry });
    }
  }
  return out;
}
