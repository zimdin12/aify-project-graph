// ⛔ THE FAILURE THIS SLICE EXISTS TO REMOVE: self-review mutates files in THE CHECKOUT THE TEAM IS
// WORKING IN. The `finally` restore covers a thrown error. It does not cover SIGKILL, a power loss,
// or a closed terminal — and the residue is QUIET, because a mutant is a plausible edit to a real
// file, not a syntax error. Thirty legacy arms remain, so that is thirty windows.
//
// ⛔⛔ AND THE FIRST DESIGN SWEPT ORPHANS AUTOMATICALLY. The referee overruled it for two reasons I
// had not weighed: an orphan CONTAINS THE MUTANT BYTES, so sweeping destroys the only record of what
// was in flight; and a directory that looks stale may be a PEER'S ACTIVE ONE, which no name pattern
// can distinguish. Cleanup is nominated, never inferred.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ISOLATION_ROOT, MANIFEST_ROOT, HEARTBEAT_STALE_MS,
  heartbeatState, beat, containedInRoot, armManifest, writeManifest,
  manifestPathFor, heartbeatPathFor, findOpenArms, isolationPermission, cleanupPlan,
  preserveOrphanEvidence, hashBytes,
} from '../../../scripts/lib/arm-isolation.mjs';

const FIXTURE = fileURLToPath(new URL('../../fixtures/hostile-kill-arm.mjs', import.meta.url));
const TARGET = 'src/subject.js';
const ORIGINAL = 'export const answer = 41;\n';

let repo;
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'arm-iso-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 'T');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, TARGET), ORIGINAL);
  git('add', '-A');
  git('commit', '-qm', 'base');
});

afterEach(() => {
  // Remove registrations first so git does not leave metadata behind, then the directory.
  try { git('worktree', 'prune'); } catch { /* the repo may already be gone */ }
  rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
});

const openArm = (runId, over = {}) => {
  const wt = join(repo, ISOLATION_ROOT, `arm-${runId}`);
  mkdirSync(wt, { recursive: true });
  writeManifest(manifestPathFor(repo, runId), armManifest({
    runId, specId: 's', target: TARGET, commit: 'c', tree: 't', worktree: wt, pid: 1, ...over,
  }));
  return wt;
};

// ─────────────────────────────────────────────────────────────────────────────
// ⛔ THE LOAD-BEARING CONTROL. Everything else is arithmetic about manifests.
// ─────────────────────────────────────────────────────────────────────────────
describe('a hostile kill mid-mutation', () => {
  it('★★★⛔ leaves the MAIN checkout byte-identical, and an ATTRIBUTABLE orphan', async () => {
    const runId = 'kill-1';
    const child = spawn(process.execPath, [FIXTURE, repo, runId, TARGET, 'MUTANT_MARKER'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = [];
    child.stderr.on('data', (d) => stderr.push(String(d)));

    const worktree = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`fixture never signalled READY. stderr: ${stderr.join('')}`)), 60_000);
      child.stdout.on('data', (d) => {
        buf += String(d);
        const m = buf.match(/READY (.+)\n/);
        if (m) { clearTimeout(timer); resolve(m[1].trim()); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${stderr.join('')}`)); });
    });

    // ⛔ SIGKILL, not SIGTERM. A handled signal would let cleanup code run, which is precisely the
    // code that does not exist during a power loss. Killing softly would test the wrong world.
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));

    // 1. THE MAIN CHECKOUT IS UNTOUCHED — the property the whole slice buys.
    expect(readFileSync(join(repo, TARGET), 'utf8'),
      'the checkout the team works in must never hold mutant bytes').toBe(ORIGINAL);
    expect(git('status', '--porcelain', '--', TARGET), 'and git must agree it is clean').toBe('');

    // 2. THE MUTANT SURVIVES, in the throwaway directory — it is the evidence, not litter.
    expect(readFileSync(join(worktree, TARGET), 'utf8')).toMatch(/MUTANT_MARKER/);

    // 3. IT IS ATTRIBUTABLE: the outside manifest names the run, its target and its source commit.
    const open = findOpenArms(repo);
    expect(open.length).toBe(1);
    expect(open[0].manifest.runId).toBe(runId);
    expect(open[0].manifest.target).toBe(TARGET);

    // 4. WHILE THE HEARTBEAT IS FRESH IT READS AS A PEER, not as an orphan — a kill does not
    //    instantly become knowledge, and claiming otherwise is how a live peer gets deleted.
    expect(open[0].liveness).toBe('HELD');

    // 5. ONCE STALE IT IS AN ORPHAN, AND IT BLOCKS THE NEXT RUN.
    const later = findOpenArms(repo, Date.now() + HEARTBEAT_STALE_MS + 1000);
    expect(later[0].liveness).toBe('FREE');
    const permission = isolationPermission(later);
    expect(permission.allowed, 'mutant bytes are unaccounted for — refuse').toBe(false);
    expect(permission.reason).toMatch(/ORPHAN/);
    expect(permission.orphans.map((o) => o.runId)).toEqual([runId]);

    // 6. NOMINATED CLEANUP PRESERVES THE HASH BEFORE ANYTHING IS REMOVED.
    const plan = cleanupPlan(repo, runId, later);
    expect(plan.allowed).toBe(true);
    const preserved = preserveOrphanEvidence(plan.manifest);
    expect(preserved.preserved).toBe(true);
    expect(preserved.mutantSha256).toBe(hashBytes(readFileSync(join(worktree, TARGET))));
  }, 90_000);
});

describe('liveness is bounded staleness, and unknown is not permission', () => {
  it('★★★ POSITIVE CONTROL: a fresh beat reads HELD, a stale one FREE', () => {
    // Without both ends this is satisfied by a function returning one constant.
    const p = join(repo, MANIFEST_ROOT, 'x.beat');
    beat(p);
    expect(heartbeatState(p)).toBe('HELD');
    expect(heartbeatState(p, Date.now() + HEARTBEAT_STALE_MS + 1)).toBe('FREE');
  });

  it('★★★⛔ a MISSING or CORRUPT heartbeat is UNKNOWN, never FREE', () => {
    // ⛔ Absent evidence of life is not evidence of death. Returning FREE here would authorise
    // deleting the worktree of a run whose heartbeat file simply had not been written yet.
    expect(heartbeatState(join(repo, MANIFEST_ROOT, 'nope.beat'))).toBe('UNKNOWN');
    const bad = join(repo, MANIFEST_ROOT, 'bad.beat');
    mkdirSync(join(repo, MANIFEST_ROOT), { recursive: true });
    writeFileSync(bad, 'yesterday afternoon');
    expect(heartbeatState(bad)).toBe('UNKNOWN');
  });

  it('★★★⛔ an UNKNOWN arm blocks the next run AND refuses cleanup', () => {
    openArm('unknown-1');                       // manifest written, no heartbeat at all
    const arms = findOpenArms(repo);
    expect(arms[0].liveness).toBe('UNKNOWN');
    expect(isolationPermission(arms).allowed).toBe(false);
    expect(cleanupPlan(repo, 'unknown-1', arms).reason).toMatch(/UNKNOWN \(treated as active\)/);
  });
});

describe('cleanup deletes exactly what was nominated, or refuses', () => {
  it('★★★ POSITIVE CONTROL: a stale, contained, uniquely named orphan is cleanable', () => {
    openArm('ok-1');
    beat(heartbeatPathFor(repo, 'ok-1'), new Date(Date.now() - HEARTBEAT_STALE_MS - 5000));
    expect(cleanupPlan(repo, 'ok-1', findOpenArms(repo)).allowed).toBe(true);
  });

  it('★★★⛔ A SIBLING SENTINEL IS NEVER IN THE PLAN', () => {
    // ⛔ The referee's explicit requirement. Two orphans side by side; nominating one must not
    // widen to the other. A sweep by name pattern would take both, which is exactly the design
    // that was overruled.
    openArm('nominated');
    const sentinel = openArm('sentinel');
    const stale = new Date(Date.now() - HEARTBEAT_STALE_MS - 5000);
    beat(heartbeatPathFor(repo, 'nominated'), stale);
    beat(heartbeatPathFor(repo, 'sentinel'), stale);
    writeFileSync(join(sentinel, 'DO-NOT-TOUCH'), 'sentinel');

    const plan = cleanupPlan(repo, 'nominated', findOpenArms(repo));
    expect(plan.allowed).toBe(true);
    expect(plan.manifest.runId).toBe('nominated');
    expect(plan.manifest.worktree).not.toContain('sentinel');
    expect(existsSync(join(sentinel, 'DO-NOT-TOUCH')), 'the sibling is untouched by the plan').toBe(true);
  });

  it('★★★⛔ A PATH ESCAPING THE ROOT IS REFUSED, even with a valid manifest', () => {
    // ⛔ This is the one function whose being wrong DELETES. A manifest is tool-authored, but a
    // tool-authored file is still a file on disk that something else could write.
    openArm('escape-1', { worktree: repo });
    beat(heartbeatPathFor(repo, 'escape-1'), new Date(Date.now() - HEARTBEAT_STALE_MS - 5000));
    expect(cleanupPlan(repo, 'escape-1', findOpenArms(repo)).reason).toMatch(/does not resolve strictly inside/);
  });

  it('★★★⛔ the isolation ROOT ITSELF is never contained in itself', () => {
    mkdirSync(join(repo, ISOLATION_ROOT), { recursive: true });
    expect(containedInRoot(repo, join(repo, ISOLATION_ROOT)),
      'deleting the root would take every peer with it').toBe(false);
    expect(containedInRoot(repo, join(repo, ISOLATION_ROOT, 'arm-x')),
      'an ABSENT path is unresolvable, and unresolvable is refused').toBe(false);
    mkdirSync(join(repo, ISOLATION_ROOT, 'arm-x'), { recursive: true });
    expect(containedInRoot(repo, join(repo, ISOLATION_ROOT, 'arm-x')),
      'POSITIVE CONTROL: a real child IS contained, so the refusals above mean something').toBe(true);
  });

  it('★★★⛔ AN UNREADABLE MANIFEST FREEZES CLEANUP ENTIRELY', () => {
    // ⛔ Not merely "skip that one". If one manifest cannot be read, the POPULATION is unknown —
    // and a nominated delete inside an unknown population can be the wrong directory. The ledger
    // made exactly this mistake once already, reading `{}` as an empty history.
    openArm('good-1');
    beat(heartbeatPathFor(repo, 'good-1'), new Date(Date.now() - HEARTBEAT_STALE_MS - 5000));
    writeFileSync(join(repo, MANIFEST_ROOT, 'torn.json'), '{"runId": "trunc');
    const arms = findOpenArms(repo);
    expect(cleanupPlan(repo, 'good-1', arms).reason).toMatch(/population is not known/);
  });

  it('★★★⛔ VALID JSON OF THE WRONG SHAPE is unknown, not absent', () => {
    mkdirSync(join(repo, MANIFEST_ROOT), { recursive: true });
    writeFileSync(join(repo, MANIFEST_ROOT, 'empty.json'), '{}');
    const arms = findOpenArms(repo);
    expect(arms.length).toBe(1);
    expect(arms[0].manifest).toBe(null);
    expect(isolationPermission(arms).allowed).toBe(false);
  });

  it('★★★ a CLOSED arm is not open, and does not block anything', () => {
    // ⚠ The one state that must NOT block: a run that concluded normally. Without this the tool
    // refuses forever after its first successful run.
    openArm('done-1');
    const p = manifestPathFor(repo, 'done-1');
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), state: 'CLOSED' }));
    expect(findOpenArms(repo)).toEqual([]);
    expect(isolationPermission(findOpenArms(repo)).allowed).toBe(true);
  });
});

describe('evidence preservation fails closed', () => {
  it('★★★⛔ a missing or non-file target yields preserved:false, NEVER a throw', () => {
    // ⛔ My first draft called readFileSync on `join(worktree, target ?? '')`, which is the
    // DIRECTORY when target is empty — so it threw EISDIR at the exact moment it existed to
    // preserve evidence, immediately before a delete.
    const wt = openArm('pres-1');
    expect(preserveOrphanEvidence({ runId: 'a', worktree: wt, target: '' }))
      .toMatchObject({ preserved: false, mutantSha256: null, note: 'manifest names no target' });
    expect(preserveOrphanEvidence({ runId: 'a', worktree: wt, target: 'src' }).preserved).toBe(false);
    expect(preserveOrphanEvidence({ runId: 'a', worktree: wt, target: 'gone.js' }).note).toMatch(/unreadable/);
  });

  it('★★★ POSITIVE CONTROL: a real file IS hashed', () => {
    const wt = openArm('pres-2');
    writeFileSync(join(wt, 'f.js'), 'mutant');
    const r = preserveOrphanEvidence({ runId: 'a', worktree: wt, target: 'f.js' });
    expect(r.preserved).toBe(true);
    expect(r.mutantSha256).toBe(hashBytes(Buffer.from('mutant')));
  });
});
