// PER-ARM ISOLATION: a hostile mutation never touches the checkout the team is working in.
//
// ⛔ THE OPEN ITEM THIS CLOSES, in self-review's own words: *"mutations run in THIS checkout, so a
// hard kill between mutate and restore leaves mutant bytes on disk."* The `finally` restore covers
// thrown errors; it does not cover SIGKILL, power loss, or a closed terminal. Thirty legacy arms
// remain, so that is thirty windows — and the damage is QUIET, because a mutant is a plausible edit
// to a real file, not a syntax error. A kill at the wrong moment leaves a repo that builds, passes
// most things, and is wrong in one place nobody chose.
//
// ⇒ Each arm gets its own detached worktree at the exact commit. A kill now leaves mutant bytes in
// a throwaway directory, and the main checkout is never written to at all.
//
// ⛔⛔ ORPHANS ARE NEVER SWEPT. My first design proposed automatic cleanup and the referee overruled
// it, for two reasons I had not weighed:
//   1. an orphan CONTAINS MUTANT BYTES — it IS the evidence that a run was interrupted, and where;
//   2. a "stale" worktree may be a peer's ACTIVE one, and a name pattern cannot tell them apart.
// ⇒ Discovery REFUSES the next run and reports. Cleanup is explicitly nominated, by run id.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (b) => createHash('sha256').update(b).digest('hex');

/** The ONLY directory nominated cleanup may ever delete inside. */
export const ISOLATION_ROOT = '.self-review-worktrees';

/** Durable manifests, deliberately OUTSIDE the disposable worktrees they describe. */
export const MANIFEST_ROOT = '.self-review-arms';

/**
 * How long a heartbeat may go unrefreshed before its run stops counting as active.
 *
 * ⚠ This is the ONE tunable that trades two errors against each other, so it is named rather than
 * inlined: too short calls a live peer dead, too long makes every orphan block for that duration.
 */
export const HEARTBEAT_STALE_MS = 90_000;

/**
 * LIVENESS: 'HELD' | 'FREE' | 'UNKNOWN'.
 *
 * ⛔ WHAT THIS DOES NOT PROVE, stated because the whole cleanup guard rests on it: a heartbeat is a
 * timestamp a process promised to refresh. A SUSPENDED process is alive and stops writing, so a
 * long enough freeze reads as FREE. This is a bounded-staleness signal, NOT proof of death.
 *
 * ⛔⛔ PID LIVENESS IS DELIBERATELY NOT USED. Pids recycle. A recycled pid reports "alive" for a
 * process that is not the one in the manifest, which would make an orphan look like a peer and,
 * worse, let an unrelated program's existence authorise keeping mutant bytes. The pid is recorded
 * as disclosure only, and nothing branches on it.
 *
 * ⇒ UNKNOWN whenever the file is missing or unparseable, and every caller treats UNKNOWN as active.
 * Not knowing whether someone is working in a directory is not permission to delete it.
 */
export function heartbeatState(beatPath, now = Date.now(), staleMs = HEARTBEAT_STALE_MS) {
  let raw;
  try { raw = readFileSync(beatPath, 'utf8'); } catch { return 'UNKNOWN'; }
  const at = Date.parse(String(raw).trim());
  if (!Number.isFinite(at)) return 'UNKNOWN';
  return now - at <= staleMs ? 'HELD' : 'FREE';
}

/** Refresh this run's heartbeat. Called on a timer by the live arm. */
export function beat(beatPath, at = new Date()) {
  mkdirSync(dirname(beatPath), { recursive: true });
  writeFileSync(beatPath, `${at.toISOString()}\n`);
}

/**
 * Is `candidate` strictly inside the isolation root?
 *
 * ⛔ REALPATH CONTAINMENT, not string prefixing — this function authorises DELETION. A symlink or a
 * `..` segment can make a path look contained while resolving somewhere else entirely, and
 * `startsWith` on the textual path would wave both through. `relative()` on REAL paths cannot.
 */
export function containedInRoot(repo, candidate) {
  let root; let real;
  try { root = realpathSync(join(repo, ISOLATION_ROOT)); } catch { return false; }
  try { real = realpathSync(candidate); } catch { return false; }
  const rel = relative(root, real);
  // '' means it IS the root (never deletable); '..' means outside; absolute means another volume.
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function armManifest({ runId, specId, target, commit, tree, worktree, pid }) {
  return {
    runId,
    specId,
    target,
    commit,
    tree,
    worktree,
    pid,                      // ⚠ disclosure only — nothing branches on it, see heartbeatState
    openedAt: new Date().toISOString(),
    state: 'OPEN',
  };
}

export const manifestPathFor = (repo, runId) => join(repo, MANIFEST_ROOT, `${runId}.json`);
export const heartbeatPathFor = (repo, runId) => join(repo, MANIFEST_ROOT, `${runId}.beat`);

export function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(path, bytes);
  return sha(bytes);
}

/**
 * Every arm manifest that is still OPEN — i.e. a run that never concluded.
 *
 * ⚠ An OPEN manifest whose heartbeat is fresh is a PEER, not an orphan. Both are returned, marked,
 * because deleting a peer's worktree corrupts a concurrent experiment and a directory listing
 * cannot tell the two apart.
 */
export function findOpenArms(repo, now = Date.now()) {
  const dir = join(repo, MANIFEST_ROOT);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let m = null;
    try { m = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch {
      // ⛔ An unreadable manifest is an UNKNOWN interrupted run, never an absent one.
      out.push({ file: f, manifest: null, liveness: 'UNKNOWN' });
      continue;
    }
    if (m && m.state === 'CLOSED') continue;
    if (!m || m.state !== 'OPEN' || typeof m.runId !== 'string' || !m.runId) {
      // Readable JSON of the wrong shape is also unknown, not absent.
      out.push({ file: f, manifest: null, liveness: 'UNKNOWN' });
      continue;
    }
    out.push({ file: f, manifest: m, liveness: heartbeatState(heartbeatPathFor(repo, m.runId), now) });
  }
  return out;
}

/** UNKNOWN counts as active. Not knowing is not permission. */
const isActive = (a) => a.liveness !== 'FREE';

/**
 * May the next mutation run proceed?
 *
 * ⛔ ANY open arm blocks — orphan or peer. An orphan means mutant bytes are unaccounted for; a peer
 * means someone is mid-experiment. Neither is a state in which to start mutating.
 */
export function isolationPermission(openArms) {
  if (openArms.length === 0) return { allowed: true, reason: 'no open arms' };
  const peers = openArms.filter(isActive);
  const orphans = openArms.filter((a) => !isActive(a));
  const parts = [];
  if (peers.length) parts.push(`${peers.length} ACTIVE-or-UNKNOWN run(s)`);
  if (orphans.length) parts.push(`${orphans.length} ORPHAN(s) holding mutant bytes`);
  return {
    allowed: false,
    reason: `refusing to mutate: ${parts.join(', ')}. Orphans are never swept — an orphan IS the `
      + `evidence of an interrupted run. Nominate one explicitly: --cleanup-orphan <run-id>`,
    orphans: orphans.map((o) => o.manifest).filter(Boolean),
    peers: peers.map((p) => p.manifest).filter(Boolean),
    unreadable: openArms.filter((a) => !a.manifest).map((a) => a.file),
  };
}

/**
 * Plan the cleanup of exactly ONE nominated orphan. Every condition must hold.
 *
 * ⚠ This is the only function in the apparatus whose being wrong DESTROYS evidence rather than
 * producing a wrong verdict, so each refusal names which condition failed.
 */
export function cleanupPlan(repo, runId, openArms) {
  const unreadable = openArms.filter((a) => !a.manifest);
  if (unreadable.length) {
    return {
      allowed: false,
      reason: `${unreadable.length} unreadable manifest(s) present (${unreadable.map((u) => u.file).join(', ')}) `
        + `— the population is not known, so refusing to delete anything inside it`,
    };
  }
  const match = openArms.filter((a) => a.manifest.runId === runId);
  if (match.length === 0) return { allowed: false, reason: `no OPEN arm with run id ${runId}` };
  if (match.length > 1) return { allowed: false, reason: `${match.length} arms share run id ${runId} — ambiguous` };
  const a = match[0];
  if (isActive(a)) {
    const how = a.liveness === 'UNKNOWN' ? 'UNKNOWN (treated as active)' : 'ACTIVE';
    return { allowed: false, reason: `run ${runId} is ${how} — its heartbeat is not stale` };
  }
  if (!a.manifest.worktree || !containedInRoot(repo, a.manifest.worktree)) {
    return {
      allowed: false,
      reason: `${a.manifest.worktree} does not resolve strictly inside ${ISOLATION_ROOT} — refusing to delete`,
    };
  }
  return { allowed: true, manifest: a.manifest };
}

/**
 * Hash what the orphan still holds, BEFORE anything is removed.
 *
 * ⛔ FAILS CLOSED. A target that is missing, a directory, or unreadable yields a null hash and an
 * explicit `preserved: false` — never a throw, and never a hash of the wrong bytes. This runs
 * immediately before a delete, so throwing here would destroy the evidence it exists to keep.
 */
export function preserveOrphanEvidence(manifest) {
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

export { sha as hashBytes };
