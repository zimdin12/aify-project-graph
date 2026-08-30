// THE ONE-WAY RAMP FROM THE LEGACY UNRESOLVED SIDECAR INTO THE PUBLICATION TABLE.
//
// ⛔ WHY A BRIDGE AT ALL, RATHER THAN A CLEAN BREAK. Every graph that exists today has
// `dirty-edges.full.json` and no `unresolved_refs` table. Without a bridge the first rebuild after
// the upgrade reads the table (absent), falls back to `manifest.dirtyEdges` — a 500-row SAMPLE —
// and silently stops retrying every other unresolved ref. On this repository that is 500 of 35,906.
// The unresolved count would drop 98% and read as convergence, and the remedy ("run a full
// rebuild") is one nobody knows they need.
//
// ⛔ AND WHY NOT `readDirtyEdgesSidecar`. That reader returns `[]` for a CORRUPT file and reserves
// `null` for ENOENT alone, so an unreadable legacy authority becomes the claim "this graph has no
// unresolved refs" — a statement about the repository, made from a failed read. Reviewer executed
// exactly that failure. A migration reader must be able to say `invalid`, separately from `absent`
// and separately from `valid([])`, or it cannot refuse.
//
// ⭐ THE BRIDGE IS SELF-RETIRING. The first rebuild that commits creates the table, and tier 1 wins
// forever after — including when the table is EMPTY, which is an authoritative answer and not a
// reason to consult a file again. There is no second writer and no ongoing contract: this is a ramp,
// not a format we keep. The legacy file is deliberately left on disk unread rather than deleted; a
// post-commit delete is exactly the class of separate promotion event this whole unit removes.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const LEGACY_FILE = 'dirty-edges.full.json';

/**
 * Read the legacy sidecar as a TYPED state.
 *
 * @returns {{state:'absent'}
 *          |{state:'valid', rows:object[], count:number}
 *          |{state:'invalid', reason:string}}
 */
export async function readLegacyUnresolvedSidecar(graphDir) {
  const path = join(graphDir, LEGACY_FILE);
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'absent' };
    // ⛔ UNREADABLE IS NOT EMPTY AND IT IS NOT ABSENT. A permissions error or a truncated read is a
    // failure of the instrument, and an instrument that cannot report its own failure launders it
    // into an answer about the data.
    return { state: 'invalid', reason: `unreadable: ${error?.code ?? String(error)}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: 'invalid', reason: 'corrupt JSON' };
  }

  if (!Array.isArray(parsed?.dirtyEdges)) {
    return { state: 'invalid', reason: 'envelope has no dirtyEdges array' };
  }

  // ⭐ THE ENVELOPE CARRIES ITS OWN COUNT, SO CHECK IT. A file truncated mid-write parses as valid
  // JSON far more often than intuition suggests, and the rows that survive look perfectly well
  // formed. The count is the only thing in the file that knows how many there should have been.
  const declared = parsed.count;
  if (typeof declared === 'number' && declared !== parsed.dirtyEdges.length) {
    return {
      state: 'invalid',
      reason: `envelope count ${declared} !== ${parsed.dirtyEdges.length} rows present`,
    };
  }

  return { state: 'valid', rows: parsed.dirtyEdges, count: parsed.dirtyEdges.length };
}

/**
 * The manifest's own dirtyEdges, usable as a migration source ONLY when it is provably the whole
 * population rather than the 500-row sample.
 *
 * ⛔ `dirtyEdgeCount` IS THE UNCAPPED TRUTH AND `dirtyEdges` IS THE CAPPED SAMPLE. They are equal
 * only when the population fits under the cap. A missing count is UNKNOWN, and unknown fails closed
 * under its own wording — it must never be reported as, or silently treated as, "complete".
 */
export function readManifestAsMigrationSource(manifest) {
  const rows = manifest?.dirtyEdges;
  if (!Array.isArray(rows)) return { state: 'absent' };

  const declared = manifest?.dirtyEdgeCount;
  if (typeof declared !== 'number') {
    return { state: 'invalid', reason: 'dirtyEdgeCount absent — completeness unknown' };
  }
  if (declared !== rows.length) {
    return {
      state: 'invalid',
      reason: `manifest holds a ${rows.length}-row sample of ${declared} — truncated`,
    };
  }
  return { state: 'valid', rows, count: rows.length };
}

/**
 * Pick the carry-forward source for a rebuild, as a typed decision with a named tier.
 *
 * The chain, and what each tier means:
 *   1. `table`           — the publication table exists. Authoritative, INCLUDING when empty.
 *   2. `legacy-sidecar`  — no table, a valid legacy file. Migrate its exact multiset.
 *   3. `manifest-sample` — no table, no sidecar, and a manifest sample PROVEN complete.
 *   4. `force-full`      — anything unreadable, corrupt, count-mismatched or truncated.
 *
 * ⛔ TIER 4 IS A REFUSAL, NOT A DEGRADATION. The tempting alternative is to carry forward whatever
 * could be read and continue. That converts an unreadable authority into a smaller-but-confident
 * one, which is the precise failure this replaces: the loss is invisible and looks like progress.
 * Rebuilding from source is expensive and always correct.
 */
export function chooseCarryForwardSource({ tableRefs, legacy, manifestSource }) {
  if (tableRefs !== null) return { tier: 'table', rows: tableRefs };

  if (legacy.state === 'valid') return { tier: 'legacy-sidecar', rows: legacy.rows };
  if (legacy.state === 'invalid') {
    return { tier: 'force-full', rows: null, reason: `legacy sidecar ${legacy.reason}` };
  }

  if (manifestSource.state === 'valid') return { tier: 'manifest-sample', rows: manifestSource.rows };
  if (manifestSource.state === 'invalid') {
    return { tier: 'force-full', rows: null, reason: `manifest ${manifestSource.reason}` };
  }

  // Nothing anywhere — a graph with no unresolved history at all. That is genuinely empty, not
  // unknown: there is no artifact claiming otherwise, so there is nothing to refuse over.
  return { tier: 'none', rows: [] };
}
