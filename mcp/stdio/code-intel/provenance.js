// WHICH ENGINE ACTUALLY ANSWERED? THE FIELD THAT SAYS SO WAS A HARDCODED STRING.
//
// ⛔ FOUND LIVE BY ef-manager, 2026-09-05. A JavaScript definition came back with
// `provenance: "clangd@live"` while `graph_health` in the same session reported
// `provider: "ts-langserver"`. Five string literals said clangd regardless of which server ran,
// including `code_intel_hierarchy.js:77  const LSP_PROVENANCE = 'clangd@live'` — a constant named
// for the general concept while holding one provider's value.
//
// `provenance` is the field an agent reads to decide how much a returned location is worth. Naming
// the wrong engine there is a false statement in a trust surface, which is the class this repo has
// spent the week removing.
//
// ⭐ THE PROVIDER NAME IS DERIVED, NOT LISTED. `BACKENDS` already decides which server spawns for a
// language and already supplies the name `graph_health` reports. Reading it here means a backend
// added later cannot be missed, and there is no second copy to drift.
//
// ⚠ THIS CHANGED THE C++ VALUE, DELIBERATELY: `clangd@live` becomes `cpp-clangd@live`, because
// `cpp-clangd` is the provider's actual registered name. Three test files pinned the old string.
// Keeping C++ on a legacy literal would have meant special-casing one language, which rebuilds the
// hand-maintained list this module exists to remove.
//
// ⚠ BLAST RADIUS, CHECKED RATHER THAN ASSUMED, because routing a new value into old branches went
// wrong twice yesterday:
//   · `provenanceRank` keys on LSP_VERIFIED / EXTRACTED / INFERRED / AMBIGUOUS — live strings were
//     never in that table, so edge ranking is untouched.
//   · `verifiedEdgeLanguage` reads the EXTRACTOR tag (`cpp-clangd#hash`), not this field.
//   · `formatProvenanceTag` treats any string containing '@' as CODE_INTEL, so any provider name
//     still tags correctly.
import { getBackend, normalizeLanguage } from './backends.js';

/**
 * Provenance tag for a location resolved by a LIVE language-server session.
 *
 * ⛔ AN UNREGISTERED LANGUAGE DOES NOT INHERIT A NEIGHBOUR'S ENGINE. The defect being fixed was one
 * specific engine standing in for the general case, so the fail-closed answer names no engine at
 * all rather than borrowing the most common one.
 *
 * @param {string} language
 * @returns {string} e.g. 'ts-langserver@live', 'cpp-clangd@live', 'unknown-provider@live'
 */
export function backendNameFor(language) {
  return getBackend(normalizeLanguage(language))?.providerName ?? 'unknown-provider';
}

export function liveProvenanceFor(language) {
  return `${backendNameFor(language)}@live`;
}
