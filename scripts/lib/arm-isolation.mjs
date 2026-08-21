// PER-ARM ISOLATION: a hostile mutation never touches the checkout the team is working in.
//
// ⛔ THE OPEN ITEM THIS CLOSES, in self-review's own words: *"mutations run in THIS checkout, so a
// hard kill between mutate and restore leaves mutant bytes on disk."* The `finally` restore covers
// thrown errors; it does not cover SIGKILL, power loss, or a closed terminal. Thirty legacy arms
// remain, so that is thirty windows — and the damage is QUIET, because a mutant is a plausible edit
// to a real file, not a syntax error.
//
// ⇒ Each arm gets its own detached worktree at the exact commit. A kill leaves mutant bytes in a
// throwaway directory, and the main checkout is never written to at all.
//
// ⛔⛔ STALE IS NOT ABANDONED, AND THIS IS THE WHOLE POINT OF THE FILE. My v1 classified a stale
// heartbeat as FREE and let that authorise deletion. The referee refused it: a SUSPENDED, paused or
// debugger-stopped process is ALIVE, owns custody, and emits no heartbeat. After the staleness
// window my classifier would have handed its worktree to a delete.
//
// ⇒ "Selection is not custody authority." An operator nominating a run id proves WHICH object they
// meant. It proves nothing about whether that object is abandoned. Those are two different claims
// and I had one act as the other.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const sha = (b) => createHash('sha256').update(b).digest('hex');

/** The ONLY directory a cleanup may ever delete inside. */
export const ISOLATION_ROOT = '.self-review-worktrees';

/** Durable manifests, deliberately OUTSIDE the disposable worktrees they describe. */
export const MANIFEST_ROOT = '.self-review-arms';

/**
 * How long a heartbeat may go unrefreshed before the run stops counting as demonstrably present.
 *
 * ⚠ Expiry now moves a run from PEER_ACTIVE to ORPHAN_CANDIDATE. It NEVER reaches a deletable
 * state on its own, so this constant no longer trades safety against latency — it only decides how
 * soon a human is asked to look.
 */
export const HEARTBEAT_STALE_MS = 90_000;

/**
 * ⛔ THE FOUR STATES. Only ORPHAN_CONFIRMED is deletable, and nothing in this file can produce it —
 * confirmation requires an outside observation and lives in arm-cleanup.mjs.
 */
export const ARM_STATE = {
  PEER_ACTIVE: 'PEER_ACTIVE',                 // fresh, token-authenticated heartbeat
  ORPHAN_CANDIDATE: 'ORPHAN_CANDIDATE',       // stale/missing beat; ABANDONMENT UNPROVED
  ORPHAN_CONFIRMED: 'ORPHAN_CONFIRMED',       // an independent observation says no live owner
  UNKNOWN: 'UNKNOWN',                         // unreadable, malformed, or self-contradictory
  NOT_MATERIALIZED: 'NOT_MATERIALIZED',       // manifest exists, worktree never created
};

/** Every state that must block a new mutation run. Derived, so a new state cannot be forgotten. */
export const BLOCKS_NEW_RUN = new Set(
  Object.values(ARM_STATE).filter((s) => s !== ARM_STATE.ORPHAN_CONFIRMED),
);

// ─────────────────────────────────────────────────────────────────────────────
// Heartbeats: token-bound, atomically replaced, monotonic.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⛔ A BARE TIMESTAMP IS NOT POSSESSION. My v1 wrote an ISO string, so ANY process — or a stray
 * copy, or a replayed file — could refresh it, or move it BACKWARDS. A heartbeat has to prove the
 * writer holds the token the manifest minted, or it proves nothing about who is in that directory.
 *
 * ⚠ AND EVEN THEN it proves recent possession of a token, never liveness now. That is why a fresh
 * beat yields PEER_ACTIVE and a stale one yields only a CANDIDATE.
 */
export function writeBeat(beatPath, { runToken, seq, at = new Date() }) {
  mkdirSync(dirname(beatPath), { recursive: true });
  const body = `${JSON.stringify({ runToken, seq, at: at.toISOString() })}\n`;
  // Atomic replace: a reader never observes a half-written beat, which would otherwise be
  // indistinguishable from a corrupt one and freeze the whole population.
  const tmp = `${beatPath}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, beatPath);
  return body;
}

export function readBeat(beatPath) {
  let raw;
  try { raw = readFileSync(beatPath, 'utf8'); } catch { return { ok: false, reason: 'absent' }; }
  let o;
  try { o = JSON.parse(raw); } catch { return { ok: false, reason: 'unparseable' }; }
  if (!o || typeof o.runToken !== 'string' || !o.runToken) return { ok: false, reason: 'no run token' };
  if (!Number.isInteger(o.seq) || o.seq < 0) return { ok: false, reason: 'no monotonic sequence' };
  const at = Date.parse(o.at);
  if (!Number.isFinite(at)) return { ok: false, reason: 'unparseable timestamp' };
  return { ok: true, runToken: o.runToken, seq: o.seq, at };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manifests
// ─────────────────────────────────────────────────────────────────────────────

export function armManifest({ runId, runToken, specId, target, commit, tree, worktree, pid }) {
  return {
    runId,
    // ⛔ The token is minted WITH the manifest and required by every beat. Without it a heartbeat
    // is a file anyone can write, and "someone is working here" becomes unfalsifiable.
    runToken,
    specId,
    target,
    commit,
    tree,
    worktree,
    pid,                      // ⚠ disclosure only. Pids recycle; nothing branches on it.
    openedAt: new Date().toISOString(),
    state: 'OPEN',
  };
}

export const manifestPathFor = (repo, runId) => join(repo, MANIFEST_ROOT, `${runId}.json`);
export const heartbeatPathFor = (repo, runId) => join(repo, MANIFEST_ROOT, `${runId}.beat`);

/** The manifest hash is what a confirmation binds to, so it is computed from the BYTES on disk. */
export function manifestHash(path) {
  try { return sha(readFileSync(path)); } catch { return null; }
}

export function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(path, bytes);
  return sha(bytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Containment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⛔ REALPATH CONTAINMENT, not string prefixing — this decides what a delete may touch. A symlink
 * or a `..` segment makes a path LOOK contained while resolving elsewhere, and `startsWith` waves
 * both through. The root is never contained in itself: deleting it would take every peer with it.
 */
export function containedInRoot(repo, candidate) {
  let root; let real;
  try { root = realpathSync(join(repo, ISOLATION_ROOT)); } catch { return false; }
  try { real = realpathSync(candidate); } catch { return false; }
  const rel = relative(root, real);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify ONE arm. Never returns ORPHAN_CONFIRMED — this function cannot see outside the
 * filesystem, and confirmation is by definition an outside observation.
 */
export function classifyArm(repo, manifest, now = Date.now()) {
  if (!manifest || typeof manifest.runId !== 'string' || !manifest.runId || typeof manifest.runToken !== 'string') {
    return { state: ARM_STATE.UNKNOWN, detail: 'manifest is malformed or names no run token' };
  }
  const beat = readBeat(heartbeatPathFor(repo, manifest.runId));

  // ⛔ A beat carrying the WRONG token is not a stale beat — it is a CONTRADICTION. Something other
  // than this run is writing this run's heartbeat, and the honest answer is that we do not know
  // what is happening in that directory.
  if (beat.ok && beat.runToken !== manifest.runToken) {
    return { state: ARM_STATE.UNKNOWN, detail: 'heartbeat carries a token this manifest did not mint' };
  }
  if (!beat.ok && beat.reason !== 'absent') {
    return { state: ARM_STATE.UNKNOWN, detail: `heartbeat is ${beat.reason}` };
  }

  if (!manifest.worktree || !existsSync(manifest.worktree)) {
    // ⚠ Its own type. The outside manifest is written BEFORE `git worktree add`, so this is the
    // expected shape of a kill inside that gap. Calling it an orphan would invite deleting a
    // directory that does not exist and reporting success.
    return { state: ARM_STATE.NOT_MATERIALIZED, detail: 'manifest exists; worktree was never created', beat };
  }
  if (!beat.ok) {
    return { state: ARM_STATE.ORPHAN_CANDIDATE, detail: 'no heartbeat has been written', beat };
  }
  if (now - beat.at <= HEARTBEAT_STALE_MS) {
    return { state: ARM_STATE.PEER_ACTIVE, detail: 'token-authenticated heartbeat is fresh', beat };
  }
  return {
    state: ARM_STATE.ORPHAN_CANDIDATE,
    // The wording is the ruling. A stale beat is the ABSENCE of a signal, and a suspended process
    // produces exactly that while holding custody.
    detail: 'heartbeat is stale — ABANDONMENT UNPROVED; a suspended process looks identical',
    beat,
  };
}

/** Every arm the manifest directory knows about, with its state. */
export function findArms(repo, now = Date.now()) {
  const dir = join(repo, MANIFEST_ROOT);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const path = join(dir, f);
    let m = null;
    try { m = JSON.parse(readFileSync(path, 'utf8')); } catch {
      out.push({ file: f, path, manifest: null, manifestHash: manifestHash(path), state: ARM_STATE.UNKNOWN, detail: 'manifest is unreadable' });
      continue;
    }
    if (m && m.state === 'CLOSED') continue;
    const c = classifyArm(repo, m, now);
    out.push({ file: f, path, manifest: m, manifestHash: manifestHash(path), ...c });
  }
  return out;
}

/**
 * May a new mutation run start?
 *
 * ⛔ Derived from BLOCKS_NEW_RUN rather than listed, so adding a state cannot silently create a
 * path that skips this gate.
 */
export function isolationPermission(arms) {
  const blocking = arms.filter((a) => BLOCKS_NEW_RUN.has(a.state));
  if (blocking.length === 0) return { allowed: true, reason: 'no arm is holding unaccounted bytes' };
  const byState = {};
  for (const a of blocking) byState[a.state] = (byState[a.state] ?? 0) + 1;
  return {
    allowed: false,
    blocking,
    reason: `refusing to mutate: ${Object.entries(byState).map(([s, n]) => `${n} ${s}`).join(', ')}. `
      + `Nothing here is swept automatically — an interrupted arm holds the only record of what was `
      + `in flight. Resolve each explicitly.`,
  };
}

/**
 * Hash what an arm still holds, BEFORE anything is removed.
 *
 * ⛔ FAILS CLOSED. Missing, a directory, or unreadable yields a null hash and `preserved: false` —
 * never a throw and never a hash of the wrong bytes. My first draft called readFileSync on the
 * WORKTREE DIRECTORY when the manifest named no target, throwing EISDIR at the exact moment it
 * existed to preserve evidence, immediately before a delete.
 */
export function preserveArmEvidence(manifest) {
  const rel = typeof manifest.target === 'string' ? manifest.target : '';
  const abs = rel ? join(manifest.worktree, rel) : null;
  let mutantSha256 = null;
  let note = null;
  if (!abs) note = 'manifest names no target';
  else {
    try {
      if (!statSync(abs).isFile()) note = 'target is not a regular file';
      else mutantSha256 = sha(readFileSync(abs));
    } catch (e) { note = `target unreadable: ${e.code ?? e.message}`; }
  }
  return {
    runId: manifest.runId,
    specId: manifest.specId ?? null,
    commit: manifest.commit ?? null,
    target: rel || null,
    worktree: manifest.worktree,
    preserved: mutantSha256 !== null,
    mutantSha256,
    note,
    preservedAt: new Date().toISOString(),
  };
}
