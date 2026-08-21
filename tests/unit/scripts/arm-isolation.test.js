// ⛔ THE FAILURE THIS SLICE EXISTS TO REMOVE: self-review mutates files in THE CHECKOUT THE TEAM IS
// WORKING IN. The `finally` restore covers a thrown error. It does not cover SIGKILL, a power loss,
// or a closed terminal — and the residue is QUIET, because a mutant is a plausible edit to a real
// file, not a syntax error. Thirty legacy arms remain: thirty windows.
//
// ⛔⛔ AND MY FIRST TWO DESIGNS BOTH GRANTED DELETION TOO EASILY.
//   v1 swept orphans automatically. Overruled: an orphan CONTAINS the mutant bytes, so sweeping
//      destroys the only record of what was in flight, and a directory that looks stale may be a
//      peer's ACTIVE one.
//   v2 treated a stale heartbeat as FREE and let an operator's nomination authorise the delete.
//      Overruled again, and this is the sharper of the two: **SELECTION IS NOT CUSTODY AUTHORITY.**
//      A suspended, paused or debugger-stopped process is ALIVE, owns custody, and emits no
//      heartbeat. Nominating a run id proves WHICH object was meant, never that it is abandoned.
//
// ⇒ Staleness now yields ORPHAN_CANDIDATE, which no amount of waiting turns into a delete.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  ARM_STATE, ISOLATION_ROOT, MANIFEST_ROOT, HEARTBEAT_STALE_MS, BLOCKS_NEW_RUN,
  armManifest, writeManifest, manifestPathFor, heartbeatPathFor, writeBeat, readBeat,
  classifyArm, findArms, isolationPermission, containedInRoot, preserveArmEvidence, sha,
} from '../../../scripts/lib/arm-isolation.mjs';
import { cleanupAuthority, parseConfirmation, observeArm, REMOVAL_ORDER } from '../../../scripts/lib/arm-cleanup.mjs';

const FIXTURE = fileURLToPath(new URL('../../fixtures/hostile-kill-arm.mjs', import.meta.url));
const TARGET = 'src/subject.js';
const ORIGINAL = 'export const answer = 41;\n';
const STALE_AT = () => Date.now() + HEARTBEAT_STALE_MS + 5_000;

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
  try { git('worktree', 'prune'); } catch { /* the repo may already be gone */ }
  rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
});

/** Open an arm on disk without a live process, for the pure-classification cases. */
const openArm = (runId, { beat = null, materialize = true, ...over } = {}) => {
  const wt = join(repo, ISOLATION_ROOT, `arm-${runId}`);
  if (materialize) mkdirSync(wt, { recursive: true });
  const runToken = over.runToken ?? randomUUID();
  writeManifest(manifestPathFor(repo, runId), armManifest({
    runId, runToken, specId: 's', target: TARGET, commit: 'c', tree: 't', worktree: wt, pid: 1, ...over,
  }));
  if (beat) writeBeat(heartbeatPathFor(repo, runId), { runToken, ...beat });
  return { worktree: wt, runToken };
};

/** A confirmation that is valid for the arm as it stands right now. */
const confirmFor = (arm, over = {}) => JSON.stringify({
  ...observeArm(repo, arm),
  approver: 'graph-senior-dev',
  approvalMessageId: 'msg-123',
  observedProcess: 'checked the managed session list; pid 4210 is gone and no wrapper owns this run',
  ...over,
});

const spawnArm = async (runId, mode) => {
  const child = spawn(process.execPath, [FIXTURE, repo, runId, TARGET, 'MUTANT_MARKER', mode], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const err = [];
  child.stderr.on('data', (d) => err.push(String(d)));
  const worktree = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error(`no READY. stderr: ${err.join('')}`)), 60_000);
    child.stdout.on('data', (d) => {
      buf += String(d);
      const m = buf.match(/READY (.+)\n/);
      if (m) { clearTimeout(t); resolve(m[1].trim()); }
    });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error(`exited ${c}: ${err.join('')}`)); });
  });
  return { child, worktree };
};

// ─────────────────────────────────────────────────────────────────────────────
// ⛔ THE TWO LOAD-BEARING CONTROLS. Everything else is arithmetic about manifests.
// ─────────────────────────────────────────────────────────────────────────────
describe('a hostile kill mid-mutation', () => {
  it('★★★⛔ leaves the MAIN checkout byte-identical, and an ATTRIBUTABLE orphan candidate', async () => {
    const { child, worktree } = await spawnArm('kill-1', 'kill');
    // SIGKILL, not SIGTERM. A handled signal would run cleanup code that does not exist during a
    // power loss, so killing softly would test the wrong world.
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));

    expect(readFileSync(join(repo, TARGET), 'utf8'),
      'the checkout the team works in must never hold mutant bytes').toBe(ORIGINAL);
    expect(git('status', '--porcelain', '--', TARGET), 'and git must agree it is clean').toBe('');
    expect(readFileSync(join(worktree, TARGET), 'utf8'), 'the mutant is evidence, not litter').toMatch(/MUTANT_MARKER/);

    const fresh = findArms(repo);
    expect(fresh.length).toBe(1);
    expect(fresh[0].manifest.runId).toBe('kill-1');
    expect(fresh[0].state, 'a kill does not instantly become knowledge').toBe(ARM_STATE.PEER_ACTIVE);

    const later = findArms(repo, STALE_AT());
    expect(later[0].state, 'and staleness is only ever a CANDIDATE').toBe(ARM_STATE.ORPHAN_CANDIDATE);
    expect(later[0].detail).toMatch(/ABANDONMENT UNPROVED/);
    expect(isolationPermission(later).allowed, 'unaccounted mutant bytes block the next run').toBe(false);
  }, 90_000);

  it('★★★⛔ A LIVE PROCESS THAT STOPS BEATING IS NOT DELETABLE — the ruling, exercised', async () => {
    // ⛔ THE DEFECT MY v2 SHIPPED. This process is ALIVE and holding the directory; it has simply
    // stopped writing beats, which is exactly what a suspended or debugger-stopped run looks like
    // from the filesystem. v2 called this FREE after 90s and let a nomination delete it.
    const { child, worktree } = await spawnArm('silent-1', 'silent');
    try {
      const arms = findArms(repo, STALE_AT());
      expect(arms[0].state).toBe(ARM_STATE.ORPHAN_CANDIDATE);

      // Nomination alone — the v2 authority — must now refuse.
      const bare = cleanupAuthority(repo, 'silent-1', arms, null, STALE_AT());
      expect(bare.allowed, 'selection is not custody authority').toBe(false);
      expect(bare.reason).toMatch(/independent confirmation/);
      expect(bare.reason).toMatch(/a suspended process looks identical/);

      expect(readFileSync(join(worktree, TARGET), 'utf8'),
        'and the live process still has its bytes').toMatch(/MUTANT_MARKER/);

      // ⇒ AND IT COMES BACK. A resumed run must return to PEER_ACTIVE with no cleanup action taken.
      child.stdin.write('RESUME\n');
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('never resumed')), 30_000);
        child.stdout.on('data', (d) => { if (String(d).includes('RESUMED')) { clearTimeout(t); resolve(); } });
      });
      expect(findArms(repo)[0].state, 'the suspended peer woke up').toBe(ARM_STATE.PEER_ACTIVE);
    } finally {
      child.kill('SIGKILL');
      await new Promise((r) => child.on('exit', r));
    }
  }, 120_000);
});

describe('heartbeats prove token possession, not liveness', () => {
  it('★★★ POSITIVE CONTROL: a fresh token-matched beat is PEER_ACTIVE', () => {
    // Without this every refusal below is satisfied by a classifier that never returns PEER_ACTIVE.
    openArm('p1', { beat: { seq: 0 } });
    expect(findArms(repo)[0].state).toBe(ARM_STATE.PEER_ACTIVE);
  });

  it('★★★⛔ A BEAT CARRYING A TOKEN THIS MANIFEST DID NOT MINT IS A CONTRADICTION', () => {
    // ⛔ v1 wrote a bare ISO timestamp, so ANY process — or a replayed copy — could refresh it or
    // move it backwards. A foreign token is not a stale beat; it means something other than this
    // run is writing this run's heartbeat, and the honest answer is that we do not know.
    const { runToken } = openArm('p2');
    writeBeat(heartbeatPathFor(repo, 'p2'), { runToken: `not-${runToken}`, seq: 0 });
    const a = findArms(repo)[0];
    expect(a.state).toBe(ARM_STATE.UNKNOWN);
    expect(a.detail).toMatch(/token this manifest did not mint/);
  });

  it('★★★⛔ a malformed or partially-written beat is UNKNOWN, never stale-and-deletable', () => {
    openArm('p3');
    writeFileSync(heartbeatPathFor(repo, 'p3'), '{"runToken":"abc","seq":');   // torn write
    expect(findArms(repo)[0].state).toBe(ARM_STATE.UNKNOWN);
    expect(readBeat(heartbeatPathFor(repo, 'p3')).reason).toBe('unparseable');
  });

  it('★★★⛔ a beat with no monotonic sequence is refused', () => {
    openArm('p4');
    writeFileSync(heartbeatPathFor(repo, 'p4'), JSON.stringify({ runToken: 'x', at: new Date().toISOString() }));
    expect(readBeat(heartbeatPathFor(repo, 'p4')).reason).toBe('no monotonic sequence');
  });

  it('★★★ an ABSENT beat is a candidate, but a CORRUPT one is unknown — different claims', () => {
    // ⚠ Absence and corruption must not collapse. "Nobody has beaten yet" is an expected state;
    // "something wrote nonsense here" is not, and only the first is a candidate for confirmation.
    openArm('p5');
    expect(findArms(repo, STALE_AT())[0].state).toBe(ARM_STATE.ORPHAN_CANDIDATE);
  });
});

describe('classification states are distinct and none of them is a licence', () => {
  it('★★★⛔ a manifest whose worktree was never created is NOT_MATERIALIZED', () => {
    // ⚠ The outside manifest is written BEFORE `git worktree add`, so this is the expected shape of
    // a kill inside that gap. Calling it an orphan would invite deleting a directory that does not
    // exist and then reporting success.
    openArm('nm1', { materialize: false });
    const a = findArms(repo, STALE_AT())[0];
    expect(a.state).toBe(ARM_STATE.NOT_MATERIALIZED);
    expect(cleanupAuthority(repo, 'nm1', [a], null, STALE_AT()).reason).toMatch(/no worktree to remove/);
  });

  it('★★★⛔ EVERY state except ORPHAN_CONFIRMED blocks a new run', () => {
    // Derived from the state set rather than listed, so a state added later cannot quietly acquire
    // a path around this gate.
    for (const s of Object.values(ARM_STATE)) {
      expect(BLOCKS_NEW_RUN.has(s), `${s} must block unless confirmed`).toBe(s !== ARM_STATE.ORPHAN_CONFIRMED);
    }
  });

  it('★★★ a CLOSED arm blocks nothing — the one state that must not refuse forever', () => {
    openArm('done', { beat: { seq: 0 } });
    const p = manifestPathFor(repo, 'done');
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), state: 'CLOSED' }));
    expect(findArms(repo)).toEqual([]);
    expect(isolationPermission(findArms(repo)).allowed).toBe(true);
  });
});

describe('containment decides what a delete may touch', () => {
  it('★★★⛔ the isolation ROOT is never contained in itself, and escapes are refused', () => {
    mkdirSync(join(repo, ISOLATION_ROOT, 'arm-x'), { recursive: true });
    expect(containedInRoot(repo, join(repo, ISOLATION_ROOT)),
      'deleting the root would take every peer with it').toBe(false);
    expect(containedInRoot(repo, repo), 'the repository itself, emphatically not').toBe(false);
    expect(containedInRoot(repo, join(repo, ISOLATION_ROOT, 'nope')),
      'an ABSENT path is unresolvable, and unresolvable is refused').toBe(false);
    expect(containedInRoot(repo, join(repo, ISOLATION_ROOT, 'arm-x')),
      'POSITIVE CONTROL: a real child IS contained, so the refusals above mean something').toBe(true);
  });
});

describe('confirmation is bound to the exact bytes it was written about', () => {
  const stale = () => findArms(repo, STALE_AT());

  it('★★★ POSITIVE CONTROL: a complete confirmation for a real candidate is ALLOWED', () => {
    // ⛔ Without this the whole file is satisfied by a function that refuses unconditionally — and
    // an apparatus that can never clean up gets switched off within a week.
    openArm('c1');
    const arms = stale();
    const r = cleanupAuthority(repo, 'c1', arms, confirmFor(arms[0]), STALE_AT());
    expect(r.allowed).toBe(true);
    expect(r.state).toBe(ARM_STATE.ORPHAN_CONFIRMED);
    expect(r.reason).toMatch(/graph-senior-dev/);
  });

  it('★★★⛔ a confirmation missing ANY required field is refused', () => {
    openArm('c2');
    const arms = stale();
    for (const f of ['runId', 'manifestHash', 'worktreeRealpath', 'approver', 'approvalMessageId']) {
      const c = JSON.parse(confirmFor(arms[0]));
      delete c[f];
      expect(parseConfirmation(JSON.stringify(c)).invalid, `${f} must be required`).toMatch(new RegExp(f));
    }
  });

  it('★★★⛔ an EMPTY observation is a rubber stamp with a schema', () => {
    // The one field carrying the outside look. A confirmation that does not say what was checked
    // asserts custody on the strength of its own existence.
    openArm('c3');
    const c = JSON.parse(confirmFor(stale()[0]));
    c.observedProcess = 'looked';
    expect(parseConfirmation(JSON.stringify(c)).invalid).toMatch(/what was actually checked/);
    expect(parseConfirmation('retry').invalid, 'free text is not authority').toMatch(/must be JSON/);
  });

  it('★★★⛔ A CONFIRMATION FOR ONE RUN CANNOT DELETE A SIBLING', () => {
    const a = openArm('sib-a');
    openArm('sib-b');
    writeFileSync(join(a.worktree, 'SENTINEL'), 'do not touch');
    const arms = stale();
    const forB = confirmFor(arms.find((x) => x.manifest.runId === 'sib-b'));
    const r = cleanupAuthority(repo, 'sib-a', arms, forB, STALE_AT());
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/names run sib-b, not sib-a/);
    expect(existsSync(join(a.worktree, 'SENTINEL')), 'the sibling sentinel survives').toBe(true);
  });

  it('★★★⛔ A CONFIRMATION FOR MANIFEST BYTES A CANNOT DELETE A REWRITTEN MANIFEST B', () => {
    openArm('m1');
    const arms = stale();
    const c = confirmFor(arms[0]);
    // The manifest changes after the confirmation was written — a different target, say.
    const p = manifestPathFor(repo, 'm1');
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), target: 'src/other.js' }));
    const r = cleanupAuthority(repo, 'm1', stale(), c, STALE_AT());
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/manifest CHANGED since it was confirmed/);
  });

  it('★★★⛔ A RESUMED RUN REVOKES ITS OWN CONFIRMATION', () => {
    // ⛔ The confirmation describes the world when someone looked. Between then and now the
    // suspended process may have woken up. The second read is what makes the first one evidence.
    const { runToken } = openArm('r1', { beat: { seq: 3 } });
    const arms = stale();
    const c = confirmFor(arms[0]);
    writeBeat(heartbeatPathFor(repo, 'r1'), { runToken, seq: 4 });      // it woke up
    const r = cleanupAuthority(repo, 'r1', stale(), c, STALE_AT());
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/the run RESUMED \(sequence advanced\)/);
  });

  it('★★★⛔ A SEQUENCE THAT GOES BACKWARDS FREEZES IT TOO', () => {
    // A rollback or a replay is a contradiction, never a licence. v1 could not detect this at all,
    // because a bare timestamp has no notion of order.
    const { runToken } = openArm('r2', { beat: { seq: 9 } });
    const arms = stale();
    const c = confirmFor(arms[0]);
    writeBeat(heartbeatPathFor(repo, 'r2'), { runToken, seq: 2 });
    const r = cleanupAuthority(repo, 'r2', stale(), c, STALE_AT());
    expect(r.reason).toMatch(/sequence went BACKWARDS/);
  });

  it('★★★⛔ ONE UNKNOWN ARM FREEZES THE WHOLE POPULATION', () => {
    // ⛔ Not "skip that one". If one manifest cannot be read the population is not known, and a
    // nominated delete inside an unknown population can be the wrong directory. The attempt ledger
    // made exactly this mistake once, reading `{}` as an empty history.
    openArm('good');
    writeFileSync(join(repo, MANIFEST_ROOT, 'torn.json'), '{"runId": "trunc');
    const arms = stale();
    const r = cleanupAuthority(repo, 'good', arms, confirmFor(arms.find((a) => a.manifest?.runId === 'good')), STALE_AT());
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/population is not known/);
  });

  it('★★★⛔ a PEER_ACTIVE arm is refused even WITH a valid-looking confirmation', () => {
    openArm('pa', { beat: { seq: 0 } });
    const arms = findArms(repo);
    expect(cleanupAuthority(repo, 'pa', arms, confirmFor(arms[0])).reason).toMatch(/PEER_ACTIVE/);
  });
});

describe('evidence is preserved before anything is removed', () => {
  it('★★★ the removal order puts preservation and its READBACK first', () => {
    // ⚠ Nothing is renamed or moved before preservation is durable: a rename is already a
    // destructive act against an interrupted run, and a preservation written afterwards describes
    // bytes that have already been disturbed.
    expect(REMOVAL_ORDER[0]).toBe('preserve-evidence');
    expect(REMOVAL_ORDER[1]).toBe('verify-preservation');
    expect(REMOVAL_ORDER.indexOf('close-manifest'),
      'the manifest closes LAST, so a crash mid-removal still blocks the next run')
      .toBe(REMOVAL_ORDER.length - 1);
  });

  it('★★★⛔ a missing or non-file target yields preserved:false, NEVER a throw', () => {
    // ⛔ My first draft called readFileSync on `join(worktree, target ?? '')` — the DIRECTORY when
    // target is empty — throwing EISDIR at the exact moment it existed to preserve evidence,
    // immediately before a delete.
    const { worktree } = openArm('pres-1');
    expect(preserveArmEvidence({ runId: 'a', worktree, target: '' }))
      .toMatchObject({ preserved: false, mutantSha256: null, note: 'manifest names no target' });
    expect(preserveArmEvidence({ runId: 'a', worktree, target: 'gone.js' }).note).toMatch(/unreadable/);
  });

  it('★★★ POSITIVE CONTROL: a real file IS hashed', () => {
    const { worktree } = openArm('pres-2');
    writeFileSync(join(worktree, 'f.js'), 'mutant');
    const r = preserveArmEvidence({ runId: 'a', worktree, target: 'f.js' });
    expect(r.preserved).toBe(true);
    expect(r.mutantSha256).toBe(sha(Buffer.from('mutant')));
  });
});
