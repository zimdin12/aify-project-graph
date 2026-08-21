// ⛔ THE ONLY CODE IN THE APPARATUS THAT DESTROYS EVIDENCE RATHER THAN PRODUCING A VERDICT.
//
// Everything in arm-isolation.mjs answers "what is the state of the world". This answers "may I
// delete", and the two are separated because being wrong here is not a bad report — it is a peer's
// work gone, or the only record of an interrupted run gone.
//
// ⛔⛔ THE RULING THAT SHAPED THIS FILE: **selection is not custody authority.** My v1 let an
// operator nominating a run id do two jobs at once — identify WHICH object, and certify that it is
// ABANDONED. Only the first is something a nomination can prove. A suspended, paused or
// debugger-stopped process is alive, owns custody, and emits no heartbeat, so staleness and
// abandonment are indistinguishable from inside this machine.
//
// ⇒ ORPHAN_CANDIDATE never becomes deletable by waiting. It becomes deletable only when something
// OUTSIDE the filesystem — a human or agent that actually looked at the process/session — says so,
// in an artifact bound to the exact bytes it was written about.
import { readFileSync, existsSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import {
  ARM_STATE, MAY_DELETE, BLOCKS_NEW_RUN, REMOVAL_ORDER,
  classifyArm, manifestHash, heartbeatPathFor, readBeat, containedInRoot,
} from './arm-isolation.mjs';

// Re-exported so cleanup callers read the order from ONE definition. A second copy is a second
// thing to forget to update, and this one decides what gets deleted in which order.
export { REMOVAL_ORDER };

/** Everything a confirmation must name. Derived, so a new field cannot be forgotten by a caller. */
export const CONFIRMATION_FIELDS = [
  'runId',            // exactly which run
  'manifestHash',     // the manifest BYTES it was written about
  'worktreeRealpath', // the resolved directory, not the textual one
  'observedBeat',     // {present, runToken, seq, at} | {present:false} at observation time
  'approver',         // who looked
  'approvalMessageId', // where they said so
  'observedProcess',  // ⛔ what they actually checked OUTSIDE this machine's filesystem
];

export function parseConfirmation(raw) {
  let c;
  try { c = JSON.parse(raw); } catch { return { invalid: 'confirmation must be JSON' }; }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { invalid: 'confirmation must be an object' };
  for (const f of CONFIRMATION_FIELDS) {
    if (c[f] === undefined || c[f] === null || c[f] === '') return { invalid: `confirmation names no ${f}` };
  }
  if (typeof c.observedProcess !== 'string' || c.observedProcess.trim().length < 12) {
    // ⛔ FREE TEXT IS NOT AUTHORITY, but an EMPTY field is not even a claim. This is the one field
    // that carries the outside observation, so a confirmation that does not say what was looked at
    // is a rubber stamp with a schema.
    return { invalid: 'observedProcess must state what was actually checked outside this filesystem' };
  }
  if (typeof c.observedBeat !== 'object') return { invalid: 'observedBeat must be an object' };
  return c;
}

const beatShape = (b) => (b.ok
  ? { present: true, runToken: b.runToken, seq: b.seq, at: b.at }
  : { present: false, reason: b.reason });

/** Snapshot exactly what a confirmation must later still agree with. */
export function observeArm(repo, arm) {
  const beat = readBeat(heartbeatPathFor(repo, arm.manifest.runId));
  return {
    runId: arm.manifest.runId,
    manifestHash: manifestHash(arm.path),
    worktreeRealpath: (() => { try { return realpathSync(arm.manifest.worktree); } catch { return null; } })(),
    observedBeat: beatShape(beat),
  };
}

const sameBeat = (a, b) => {
  if (!a || !b) return false;
  if (a.present !== b.present) return false;
  if (!a.present) return true;
  return a.runToken === b.runToken && a.seq === b.seq && a.at === b.at;
};

/**
 * May this exact arm be deleted, right now?
 *
 * ⛔ RE-SAMPLED AT THE MOMENT OF THE DECISION. A confirmation describes the world when someone
 * looked; between then and now the run may have resumed, the manifest may have been rewritten, or
 * the worktree may have moved. The second read is what makes the first one evidence.
 */
export function cleanupAuthority(repo, runId, arms, confirmation, now = Date.now()) {
  const refuse = (reason) => ({ allowed: false, state: ARM_STATE.ORPHAN_CANDIDATE, reason });

  // ⛔ AN UNKNOWN ANYWHERE FREEZES THE WHOLE POPULATION. If one manifest cannot be read, the
  // population is not known, and a nominated delete inside an unknown population can be the wrong
  // directory. The attempt ledger already made this mistake once, reading `{}` as empty history.
  const unknown = arms.filter((a) => a.state === ARM_STATE.UNKNOWN);
  if (unknown.length) {
    return refuse(`${unknown.length} arm(s) are UNKNOWN (${unknown.map((u) => u.file).join(', ')}) `
      + `— the population is not known, so nothing inside it may be deleted`);
  }

  const match = arms.filter((a) => a.manifest?.runId === runId);
  if (match.length === 0) return refuse(`no open arm with run id ${runId}`);
  if (match.length > 1) return refuse(`${match.length} arms share run id ${runId} — ambiguous`);
  const arm = match[0];

  if (arm.state === ARM_STATE.PEER_ACTIVE) {
    return refuse(`run ${runId} is PEER_ACTIVE — its token-authenticated heartbeat is fresh`);
  }
  if (arm.state === ARM_STATE.NOT_MATERIALIZED) {
    // Deleting nothing and reporting success is how a "cleanup" gets trusted for work it never did.
    return refuse(`run ${runId} is NOT_MATERIALIZED — there is no worktree to remove; close the manifest instead`);
  }
  if (arm.state !== ARM_STATE.ORPHAN_CANDIDATE) return refuse(`run ${runId} is ${arm.state}`);

  const c = parseConfirmation(confirmation ?? '');
  if (c.invalid) {
    return refuse(`ORPHAN_CANDIDATE is not deletable without an independent confirmation: ${c.invalid}. `
      + `Staleness proves absence of a signal, not absence of an owner — a suspended process looks identical.`);
  }

  // ⛔ THE CONFIRMATION MUST BE ABOUT *THIS* ARM. A confirmation for one run must not delete a
  // sibling, and a confirmation for manifest bytes A must not delete a rewritten manifest B.
  if (c.runId !== runId) return refuse(`confirmation names run ${c.runId}, not ${runId}`);

  const now2 = observeArm(repo, arm);
  if (!now2.manifestHash) return refuse('manifest could not be hashed at decision time');
  if (c.manifestHash !== now2.manifestHash) {
    return refuse(`the manifest CHANGED since it was confirmed (${String(c.manifestHash).slice(0, 12)} `
      + `-> ${now2.manifestHash.slice(0, 12)}) — the confirmation is about bytes that no longer exist`);
  }
  if (!now2.worktreeRealpath || c.worktreeRealpath !== now2.worktreeRealpath) {
    return refuse(`the worktree path resolved differently than when confirmed `
      + `(${c.worktreeRealpath} -> ${now2.worktreeRealpath})`);
  }
  if (!containedInRoot(repo, arm.manifest.worktree)) {
    return refuse(`${arm.manifest.worktree} does not resolve strictly inside the isolation root`);
  }

  // ⛔ HEARTBEAT MOVEMENT IN EITHER DIRECTION REFUSES.
  //   forwards  — the run RESUMED. A suspended process waking up is the exact case this exists for.
  //   backwards — a rollback or a replay. Something is writing beats that are not a live sequence,
  //               and that is a contradiction, never a licence.
  const before = c.observedBeat;
  const after = now2.observedBeat;
  if (!sameBeat(before, after)) {
    const moved = before?.present && after?.present && after.seq !== before.seq
      ? (after.seq > before.seq ? 'the run RESUMED (sequence advanced)' : 'the sequence went BACKWARDS (rollback or replay)')
      : 'the heartbeat appeared or disappeared';
    return refuse(`heartbeat state changed since confirmation: ${moved}`);
  }
  // Re-classify against the live clock, so a beat that is identical but has aged INTO freshness
  // (a clock adjustment) cannot slip through on byte-equality alone.
  const live = classifyArm(repo, arm.manifest, now);
  if (live.state !== ARM_STATE.ORPHAN_CANDIDATE) {
    return refuse(`arm re-classified as ${live.state} at decision time: ${live.detail}`);
  }

  // ELIGIBILITY IS NOT COMPLETION. This says the arm MAY be deleted. It still holds mutant bytes, a
  // registered worktree and a manifest, so it goes on blocking new runs until a VALIDATED closure
  // records that every removal step actually succeeded.
  return {
    allowed: true,
    state: ARM_STATE.ORPHAN_CONFIRMED,
    mayDelete: MAY_DELETE.has(ARM_STATE.ORPHAN_CONFIRMED),
    stillBlocksNewRuns: BLOCKS_NEW_RUN.has(ARM_STATE.ORPHAN_CONFIRMED),
    arm,
    confirmation: c,
    reason: `ORPHAN_CONFIRMED by ${c.approver} (${c.approvalMessageId}); observation: ${c.observedProcess}`
      + ' -- eligible for deletion, and still blocking new runs until closure validates',
  };
}



export function preservationDurable(path, expected) {
  if (!existsSync(path)) return { ok: false, reason: 'preservation artifact was not written' };
  let onDisk;
  try { onDisk = JSON.parse(readFileSync(path, 'utf8')); } catch { return { ok: false, reason: 'preservation artifact is unreadable' }; }
  if (onDisk.mutantSha256 !== expected.mutantSha256) return { ok: false, reason: 'preservation artifact does not match what was hashed' };
  if (onDisk.runId !== expected.runId) return { ok: false, reason: 'preservation artifact names a different run' };
  return { ok: true };
}
