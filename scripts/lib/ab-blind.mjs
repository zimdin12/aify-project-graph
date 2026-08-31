// ARM BLINDING — an EXACT allowlist, applied identically to both arms, before anything reaches an
// agent.
//
// ⛔ THE LEAK. Excluding `server` from the mechanical contrast fixed the SCORER's view and left the
// AGENT's view untouched. The agent sees the real tool response, and on the real mutant arm it read
// buildId "<SHA>+1dirty", loadedDirtyFiles ["mcp/stdio/storage/publication-schema.js"], and a note
// saying the process loaded uncommitted files and its behaviour should not be diffed. That names
// the modified file, and that file is the mechanism under test.
//
// ⛔ AND THEN I OVER-CORRECTED. My second version deleted every key whose NAME appeared in a list,
// recursively. Measured on a real graph_health response it removed SIX paths where only TWO are the
// identity carrier — including the top-level `commit`, which is the commit the graph was indexed
// from. That is task evidence, not arm metadata. A blinder that erases the answer changes the task
// instead of hiding the arm, and it would have done so silently.
//
// ⇒ So: an exact list of JSON PATHS and exact prose carriers. No key-name matching, no general
// regexes, and every call reports precisely what it removed so a caller can assert non-overreach.
//
// ⚠ TWO TIERS, TWO ESTIMANDS, per review:
//   NATIVE FIELD TIER   — clean separate commits/builds are MANDATORY. The dirty carriers are then
//                         absent naturally and this blinder must be a NO-OP beyond neutral build
//                         identity. If it removes anything else, the arms were not clean and the
//                         run is void.
//   MECHANISM TIER      — normalisation is permitted, and the result is a DIFFERENT estimand that
//                         must be reported separately, never pooled with the native tier.
import { createHash } from 'node:crypto';

/**
 * The ONLY paths this may remove. Exact, dotted, no wildcards.
 *
 * ⚠ `server.commit` is deliberately ABSENT. Two arms built from different commits legitimately
 * differ there, and erasing it would also erase a fact an agent may need. Equalising it is the
 * runner's job (clean builds), not the blinder's.
 */
export const IDENTITY_CARRIER_PATHS = Object.freeze([
  'server.buildId',
  'server.loadedDirtyFiles',
  'server.loadedDirtyNote',
]);

/**
 * Exact prose carriers, anchored to the sentence the server actually emits.
 *
 * ⚠ NARROW ON PURPOSE. A general /dirty/i would strike any task text mentioning a dirty worktree,
 * which is legitimate content in this domain. Each pattern here reproduces the emitted sentence and
 * varies only where the server varies it.
 *
 * ⚠ CONTINGENCY, NOT VERIFIED DEFENCE — measured, not assumed. Across the real captured responses
 * every prose cue sits at `server.buildId` or `server.loadedDirtyNote`, both removed by the path
 * allowlist above, so these patterns fire ZERO times on production bytes (proseHits: 0). Nothing
 * outside server-build.js propagates the note into a summary or verdict line today. They are
 * exercised only by a synthetic case. That makes them defence for a shape that does not currently
 * occur — worth keeping, not worth counting as tested.
 */
export const IDENTITY_PROSE = Object.freeze([
  /This process loaded \d+ UNCOMMITTED file\(s\)[^."]*\./g,
  /\b[0-9a-f]{7,40}\+\d+dirty\b/g,
]);

const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function deletePath(obj, path) {
  const parts = path.split('.');
  const last = parts.pop();
  const parent = parts.reduce((o, k) => (o == null ? o : o[k]), obj);
  if (parent && typeof parent === 'object' && last in parent) { delete parent[last]; return true; }
  return false;
}

/**
 * Blind one agent-visible payload.
 *
 * @returns {{blinded, removedPaths: string[], proseHits: number, hashBefore: string, hashAfter: string}}
 *          `removedPaths` is the audit trail: a caller asserts it is a subset of the preregistered
 *          carrier, which is what makes "we only removed the arm identity" checkable rather than
 *          claimed.
 */
export function blindArmCues(payload) {
  const hashBefore = sha(payload);
  const blinded = JSON.parse(JSON.stringify(payload ?? null));
  const removedPaths = [];
  for (const p of IDENTITY_CARRIER_PATHS) {
    if (deletePath(blinded, p)) removedPaths.push(p);
  }
  let proseHits = 0;
  const scrubProse = (v) => {
    if (Array.isArray(v)) return v.map(scrubProse);
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) v[k] = scrubProse(v[k]);
      return v;
    }
    if (typeof v === 'string') {
      let out = v;
      for (const re of IDENTITY_PROSE) {
        out = out.replace(re, () => { proseHits += 1; return ''; });
      }
      return out;
    }
    return v;
  };
  const result = typeof blinded === 'string' ? scrubProse(blinded) : scrubProse(blinded);
  return { blinded: result, removedPaths, proseHits, hashBefore, hashAfter: sha(result) };
}

/**
 * Cues still present in a payload. EMPTY means blind.
 *
 * ⚠ Searches the FINAL SERIALISED BYTES, because that is what the agent receives — a cue that
 * survives serialisation is a cue, wherever it sat in the object.
 */
export function findArmCues(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  const cues = [];
  if (/\+\d+dirty/.test(text)) cues.push('+Ndirty build id');
  if (/loadedDirtyFiles/.test(text)) cues.push('loadedDirtyFiles');
  if (/loadedDirtyNote/.test(text)) cues.push('loadedDirtyNote');
  if (/UNCOMMITTED file\(s\)/.test(text)) cues.push('uncommitted-file note');
  return cues;
}

/**
 * NATIVE TIER GATE. On clean separate builds the carriers are absent naturally, so blinding must
 * remove NOTHING but neutral build identity.
 *
 * @returns {{clean: boolean, removedPaths: string[], reason: string|null}}
 */
export function assertNativeTierClean(payload) {
  const { removedPaths, proseHits } = blindArmCues(payload);
  const dirtyCarriers = removedPaths.filter((p) => p !== 'server.buildId');
  const clean = dirtyCarriers.length === 0 && proseHits === 0;
  return {
    clean,
    removedPaths,
    reason: clean ? null
      : `native tier requires clean builds, but the payload carried ${[...dirtyCarriers, proseHits ? 'dirty prose' : null].filter(Boolean).join(', ')} — the arms were not built clean and this run is void`,
  };
}
