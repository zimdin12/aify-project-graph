// ARM BLINDING — one declared rule, applied to BOTH arms, before anything reaches an agent.
//
// ⛔ THE LEAK I MISSED, AND IT WAS TOTAL. Excluding `server` from the mechanical contrast was fine
// for computing whether the mutant changes a route. It said nothing about what the AGENT sees — and
// the agent sees the real tool response. Measured on the actual mutant arm:
//
//   buildId          "<SHA>+1dirty"
//   loadedDirtyFiles ["mcp/stdio/storage/publication-schema.js"]
//   loadedDirtyNote  "⚠ This process loaded 1 UNCOMMITTED file(s) ... Do NOT diff its behaviour"
//
// That does not merely reveal WHICH arm the agent is in. It names the file that was modified, and
// that file is the publication schema — the mechanism under test. An agent reading it is told the
// answer and warned not to trust the arm it is in. No blind comparison survives that.
//
// ⭐ THE RULE, AND WHY IT IS SYMMETRIC. Prefer separate CLEAN builds: each arm its own commit in its
// own disposable worktree, so no process runs uncommitted code and no `+dirty` cue exists to leak.
// Where a field still cannot be equalised — a differing commit SHA is unavoidable when the arms ARE
// different commits — it is normalised to a constant HERE, identically for both arms. Normalising
// only the treatment arm would replace one cue with another.
//
// ⚠ THIS BLINDS DELIVERY, NOT SCORING. The raw, unblinded response is what gets archived as
// evidence. Blinding is applied on the path to the agent so the agent cannot infer its arm; a
// scorer or a human reading transcripts afterwards should see everything.

/** Fields that identify the build a response came from, and therefore the arm. */
export const ARM_IDENTIFYING_FIELDS = Object.freeze([
  'buildId', 'commit', 'loadedDirtyFiles', 'loadedDirtyNote', 'startedAt', 'treeDirtyNow',
  'staleSignals', 'staleProcess',
]);

const BLINDED = '<blinded-for-arm-comparison>';

/**
 * Replace every arm-identifying field with one constant, wherever it appears.
 *
 * ⚠ Recursive on purpose: `server` is nested inside graph_health's response today, and a future
 * verb may nest build metadata somewhere else. A rule that only knows one path is a rule that stops
 * working the moment the shape changes, silently and in the unblinding direction.
 */
export function blindArmCues(value) {
  if (Array.isArray(value)) return value.map(blindArmCues);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // ⛔ DELETED, NOT OVERWRITTEN — and my first version overwrote. Replacing the VALUE leaves the
      // KEY, and the key is the cue: the control arm has no `loadedDirtyFiles` at all, so a
      // treatment arm carrying `loadedDirtyFiles: "<blinded>"` still announces that it had dirty
      // files. My own detector caught it, because it searches the serialised payload for the field
      // NAME rather than for a value. Removing the key makes both arms the same shape.
      if (ARM_IDENTIFYING_FIELDS.includes(k)) continue;
      out[k] = blindArmCues(v);
    }
    return out;
  }
  if (typeof value === 'string') {
    // Text surfaces carry the same cues in prose — the dirty note is a sentence, not a field.
    return value
      .replace(/\b[0-9a-f]{7,40}\+\d+dirty\b/gi, BLINDED)
      .replace(/loaded \d+ UNCOMMITTED file\(s\)[^\n]*/gi, BLINDED);
  }
  return value;
}

/**
 * Does this agent-visible payload still carry a cue that identifies the arm?
 *
 * @returns {string[]} the cues found — EMPTY means blind. Callers must treat a non-empty result as
 *                     a hard stop, not a warning: an unblinded pilot is not a pilot.
 */
export function findArmCues(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  const cues = [];
  if (/\+\d+dirty/i.test(text)) cues.push('+Ndirty build id');
  if (/loadedDirtyFiles/i.test(text)) cues.push('loadedDirtyFiles');
  if (/loadedDirtyNote/i.test(text)) cues.push('loadedDirtyNote');
  if (/UNCOMMITTED file\(s\)/i.test(text)) cues.push('uncommitted-file note');
  return cues;
}
