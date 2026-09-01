// CODE SYMBOL SITE IDENTITY — one id per extracted OCCURRENCE.
//
// ⛔ WHY THIS IS NOT A FIFTH `stableId`. Four helpers named `stableId` already exist in the ingest
// tree (extractors/generic.js, sweep.js, frameworks/laravel.js, frameworks/_plugin_utils.js), all
// sha1 over `parts.join('::')`. A change that is supposed to be scoped to code symbols and nothing
// else is exactly the change those four copies let you get wrong silently. This builder is
// DOMAIN-NAMED: File, Module and framework ids keep their existing owners and must stay
// byte-identical.
//
// ⛔ WHAT THIS DELIBERATELY DOES NOT DO. It asserts nothing about whether two sites are the same
// symbol. A declaration and its definition are two occurrences and get two ids; two overloads get
// two ids. Merging them is a SEMANTIC claim requiring a stated equivalence authority, and that is
// a later step. An id that implied equivalence would be the previous overreach in a new key.
//
// ⚠ SITE KIND IS NOT AN INPUT HERE, ON PURPOSE. Declaration-vs-definition is an extractor
// CLASSIFICATION, not the occurrence's address. Hashing it would mean that improving the
// classification on unchanged bytes remints the site, so a semantic correction reaches every
// consumer as delete + add. Kind travels as a sibling field on the row instead.
//
// Design and acceptance: docs/M1a-A-site-identity-design.md
import { createHash } from 'node:crypto';

// Bump to force every code-symbol site id to change. The freshness orchestrator already treats an
// EXTRACTOR_VERSION drift as a full-rebuild trigger, so old and new identities never coexist in
// one attested generation.
export const SITE_ID_SCHEMA_VERSION = 'site-v1';

export const SITE_KINDS = Object.freeze(['declaration', 'definition', 'declaration_definition', 'unknown']);

/**
 * Normalise a repo-relative path for identity purposes.
 *
 * ⚠ CASE IS PRESERVED. Lowercasing would merge two files that differ only in case on a
 * case-sensitive checkout — a silent loss of exactly the kind this module exists to stop. Only
 * separators are normalised, so a Windows-style path cannot mint a second id for one tracked file.
 * A case-insensitive filesystem can still alias two spellings of one path; that is a checkout
 * property we do not paper over here, and it is stated rather than silently decided.
 */
export function normalizeSitePath(filePath) {
  return String(filePath ?? '').split('\\').join('/').replace(/^\.\//, '');
}

/**
 * Mint the id for one extracted occurrence.
 *
 * @param {object}  site
 * @param {string}  site.language
 * @param {string}  site.filePath          repo-relative
 * @param {number}  site.startByte         exact source offset, NOT a line
 * @param {number}  site.endByte           end of the DECLARATOR, not of the body — see below
 * @param {number} [site.emitterSlot=0]    only for an extractor emitting several symbols from ONE
 *   exact span. Must be local to that span — never a traversal or global ordinal, or identity
 *   would depend on visit order.
 *
 * ⚠ BYTE OFFSETS, NOT LINE/COLUMN. Two declarations on one line share a line number, so a
 * line-derived id recreates the collision this replaces, one layer down.
 *
 * ⚠ THE SPAN IS THE DECLARATOR, NOT THE WHOLE NODE — see `siteSpanOf`. Uniqueness needs only the
 * occurrence's position, and ending the span at the body keeps a property this repo already
 * protects: editing a function's BODY does not change its id.
 */
export function codeSymbolSiteId({ language, filePath, startByte, endByte, emitterSlot = 0 }) {
  if (!Number.isInteger(startByte) || !Number.isInteger(endByte)) {
    throw new TypeError('codeSymbolSiteId requires integer startByte/endByte — a line-derived id '
      + 'would collide for two declarations on one line, which is the defect this replaces');
  }
  return createHash('sha1')
    .update([SITE_ID_SCHEMA_VERSION, language ?? '', normalizeSitePath(filePath), startByte, endByte, emitterSlot].join('::'))
    .digest('hex');
}

/**
 * The identifying span of an occurrence: its declarator, ending where the body begins.
 *
 * ⚠ Deliberately NOT the whole node. Hashing the full span would remint a symbol's id on every
 * body edit, which `tests/unit/ingest/fingerprint-stability.test.js` has protected against since
 * long before this module existed — a body-only edit moves `dependency_fp` and nothing else.
 * Stability is not *required* for correctness here (a changed file's rows are deleted and rebuilt
 * wholesale), but discarding a property the repo already holds, as a side effect of an unrelated
 * repair, would be a silent regression rather than a decision.
 *
 * ⚠ WHAT IT STILL DOES NOT SURVIVE: an edit EARLIER IN THE FILE shifts every later offset, so ids
 * below the edit move. That is inherent to positional identity and is stated, not hidden.
 */
export function siteSpanOf(node) {
  const startByte = node?.startIndex ?? 0;
  let endByte = node?.endIndex ?? 0;
  try {
    const body = typeof node?.childForFieldName === 'function' ? node.childForFieldName('body') : null;
    if (body && Number.isInteger(body.startIndex) && body.startIndex > startByte) endByte = body.startIndex;
  } catch { /* fall back to the full span — a wider span is still unique */ }
  return { startByte, endByte };
}

/**
 * What the extractor currently believes this occurrence is.
 *
 * ⚠ `unknown` IS A VALID ANSWER and is not a failure. What is forbidden is ABSENCE being read as
 * "definition" — the caller must be able to tell "we looked and could not say" from "we never
 * looked". Only a body-bearing node is called a definition; everything else that parsed is a
 * declaration; anything we cannot inspect is unknown.
 */
export function siteKindOf(node) {
  if (!node) return 'unknown';
  try {
    if (typeof node.childForFieldName !== 'function') return 'unknown';
    return node.childForFieldName('body') ? 'definition' : 'declaration';
  } catch {
    return 'unknown';
  }
}
