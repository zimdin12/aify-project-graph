// "WHICH BUILD IS ANSWERING ME" MUST BE TRUE, OR IT IS WORSE THAN ABSENT.
//
// serverBuild() read `git rev-parse HEAD` LAZILY, inside the first graph_health
// call, from the working directory. That is not the identity of the running code:
// a long-lived MCP server whose checkout is updated underneath it (git pull, a
// colleague's push) reports the NEW commit while executing the OLD code.
// `startedAt` had the same flaw — it recorded the time of the first health call,
// not process start — so the one field that could have caught the mismatch shared
// the defect. A guard failing together with the thing it guards is how a blind
// spot survives.
//
// Cost a real run (2026-07-30): sc-manager did the careful thing — restart, then
// confirm `server.commit` via graph_health BEFORE testing a fix — and the field
// answered about the filesystem. He then tested code that was never loaded. His
// summary: it converts "I should check" into "I checked".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStaleWarning,
  serverBuildInfo,
  staleProcessWarning,
  _resetServerBuildCache,
} from '../../../mcp/stdio/server-build.js';

const here = dirname(fileURLToPath(import.meta.url));
const buildSrc = readFileSync(join(here, '../../../mcp/stdio/server-build.js'), 'utf8');
const freshnessSrc = readFileSync(join(here, '../../../mcp/stdio/query/verbs/read_freshness.js'), 'utf8');
const healthSrc = readFileSync(join(here, '../../../mcp/stdio/query/verbs/health.js'), 'utf8');

describe('server build identity', () => {
  it('captures commit and start time at MODULE LOAD, not inside the accessor', () => {
    // Structural, deliberately: this is the whole defect. Inside the accessor
    // these read the tree at first-call time, which is a fact about the
    // filesystem rather than about the running build.
    expect(buildSrc).toMatch(/^const PROCESS_STARTED_AT = new Date\(\)\.toISOString\(\);/m);
    // ⚠ PINS THE PROPERTY THIS TEST NAMES, NOT THE RIGHT-HAND SIDE. It used to require
    // `const LOADED_COMMIT = gitAt(`, and a behaviour-PRESERVING change turned it red: adding a
    // one-directional test seam in front of the git call kept the capture at module load — which
    // is the entire defect this test exists for — while changing the spelling of the expression.
    //
    // That is the "gate on spelling rather than behaviour" failure this repo has now caught in
    // four separate instruments. Anchoring at column 0 still proves the thing that matters: the
    // value is bound once at module scope and cannot have migrated into the accessor, where it
    // would read the filesystem at first-call time instead of describing the running build.
    expect(buildSrc).toMatch(/^const LOADED_COMMIT =/m);

    const accessor = buildSrc.slice(buildSrc.indexOf('export function serverBuildInfo()'));
    expect(accessor).not.toMatch(/startedAt: new Date\(\)/);
    expect(accessor).toMatch(/startedAt: PROCESS_STARTED_AT/);
    expect(accessor).toMatch(/commit: LOADED_COMMIT/);
  });

  it('returns a stable IDENTITY across calls — but not a frozen verdict', () => {
    // This assertion used to be `expect(a).toBe(b)`, justified as "cached — the
    // build cannot change while the process lives." The build cannot; the TREE
    // can, and staleProcess is a comparison against the tree. Reference identity
    // therefore required freezing the one field whose whole job is to change,
    // and the test enshrined that. sc-manager ran three days on a server that had
    // cached "not stale" on its first call and never looked again.
    //
    // What must actually be stable is the process's IDENTITY.
    _resetServerBuildCache();
    const a = serverBuildInfo();
    const b = serverBuildInfo();
    expect(b.commit).toBe(a.commit);
    expect(b.startedAt).toBe(a.startedAt);
    expect(b.version).toBe(a.version);
    expect(typeof a.startedAt).toBe('string');
    expect(new Date(a.startedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('reports the RUNNING commit as `commit`, the tree separately, and does not cry stale when they agree', () => {
    // Swapping these would leave the field lying, just differently.
    _resetServerBuildCache();
    const info = serverBuildInfo();
    // This test process loaded from a checkout that has not moved mid-run.
    //
    // staleProcess must be present and FALSE, not absent. It used to be omitted
    // on the happy path, which made "this build is current" indistinguishable
    // from "this build has no such check" — and that ambiguity is precisely the
    // inference sc-manager drew when a frozen verdict returned no field: they
    // concluded the guard post-dated their binary. It shipped five days before it.
    expect(info.staleProcess).toBe(false);
    expect(Object.hasOwn(info, 'staleProcess')).toBe(true);
    expect(info.workingTreeCommit).toBeUndefined();
    expect(staleProcessWarning()).toBeNull();
    expect(buildSrc).toMatch(/workingTreeCommit: treeCommit/);
    expect(buildSrc).toMatch(/const staleProcess = Boolean\(LOADED_COMMIT && treeCommit && LOADED_COMMIT !== treeCommit\)/);
  });

  it('the stale warning names both commits and demands a restart', () => {
    // ⚠ WAS THREE SOURCE GREPS, and one of them broke on a pure rename during the
    // process-scope fix — a test that fails on a refactor and cannot fail on a behaviour
    // change, which is the source-contract hazard KNOWN_SOURCE_CONTRACT exists to bound.
    // The warning is now a pure function, so this CALLS it with a stale state.
    const w = buildStaleWarning({
      loadedCommit: 'aaa1111',
      startedAt: '2026-08-19T00:00:00.000Z',
      treeCommit: 'bbb2222',
      staleDelta: { executable_files_changed: 2, files_changed: 2, sample: ['mcp/x.js'] },
    });
    expect(w).toMatch(/SERVER IS RUNNING STALE CODE/);
    expect(w, 'both commits, so the reader can tell which bytes answered').toContain('aaa1111');
    expect(w).toContain('bbb2222');
    expect(w).toMatch(/RESTART the aify-project-graph MCP server/);
  });

  it('EVERY read verb carries the warning, not just graph_health', () => {
    // The generalization sc-manager's case demands: a stale process is a
    // condition on the whole session, not a graph condition. Reporting it only in
    // the diagnostic verb means a reader who never calls it acts on stale-build
    // output indefinitely.
    expect(freshnessSrc).toMatch(/import \{ staleProcessWarning \} from '\.\.\/\.\.\/server-build\.js'/);
    const inspect = freshnessSrc.slice(freshnessSrc.indexOf('export async function inspectReadFreshness'));
    expect(inspect).toMatch(/const staleBuild = staleProcessWarning\(\)/);
    // It must be pushed BEFORE the snapshot-staleness warning: if the build is
    // wrong, the freshness answer itself came from the wrong build.
    expect(inspect.indexOf('staleBuild')).toBeLessThan(inspect.indexOf('graph snapshot is stale'));
  });

  it('graph_health surfaces it as the FIRST verdict, above nodes/edges', () => {
    // A JSON-only signal is not a signal — the rendered summary is what a reader
    // scans before attributing behaviour to a commit.
    //
    // ⚠ THIS ASSERTION IS SOURCE-ANCHORED AND THAT IS A KNOWN WEAKNESS, declared
    // rather than hidden. It is one of the 68 cases in graph-senior-dev's 2026-08-10
    // audit that read implementation text instead of running it — and it proved the
    // point the same day: it failed when the summary line changed from inlining
    // `_build.staleWarning` to naming it, which was a 265-token IMPROVEMENT, not a
    // regression. It fired on a fix.
    //
    // Kept, narrowly, because forcing `staleProcess` behaviourally means faking a
    // process whose loaded commit differs from the checkout, and the honest version of
    // that fixture belongs with the suite reclassification in the plan (§3) rather
    // than bolted on here. Until then it asserts ORDER ONLY — that the stale signal is
    // pushed before `nodes=` — and deliberately does NOT assert the message text, so
    // it cannot fire on wording again.
    const verdictBlock = healthSrc.slice(healthSrc.indexOf('const verdicts = []'));
    const stalePos = verdictBlock.indexOf('_build.staleProcess');
    const nodesPos = verdictBlock.indexOf('`nodes=${nodes}');
    expect(stalePos, 'the stale-process verdict must still be pushed').toBeGreaterThan(-1);
    expect(stalePos, 'and it must be pushed before nodes/edges').toBeLessThan(nodesPos);
  });

  it('★★ version is captured at LOAD, not read from disk per query', async () => {
    // ef-manager, on the v0.6.0 release itself, 2026-08-11. `version` was read from
    // package.json at QUERY time, so it reported the CHECKOUT's version and never the
    // running process's. Observed twice on ONE process — "0.5.0" before the release
    // commit landed, "0.6.0" after, with `startedAt` IDENTICAL. The number moved
    // without a restart.
    //
    // ⛔ The worst possible field to get wrong: `commit`, `staleProcess` and
    // `staleWarning` are all honest, and `version` contradicted all three inside the
    // same object — the one block whose job is telling a reader whether to trust the
    // build. An agent asked to "verify the shipping build" reads version, sees the new
    // number, and proceeds on a stale process.
    //
    // The property, stated so it cannot regress: within one process, version must be
    // as immutable as startedAt. Mutating package.json on disk must not move it.
    const { serverBuildInfo } = await import('../../../mcp/stdio/server-build.js');
    const { readFileSync, writeFileSync } = await import('node:fs');
    const { join: pjoin } = await import('node:path');

    const pkgPath = pjoin(here, '../../../package.json');
    const original = readFileSync(pkgPath, 'utf8');
    const before = serverBuildInfo();

    try {
      const bumped = JSON.parse(original);
      bumped.version = '99.99.99-probe';
      writeFileSync(pkgPath, `${JSON.stringify(bumped, null, 2)}\n`);

      // ⚠ THE CACHE MUST BE DEFEATED OR THIS CASE IS VACUOUS. serverBuildInfo() memoises
      // for 5s, so a second call inside that window returns the previous object and the
      // disk is never touched — the test then passes whether or not the defect exists.
      // Verified by reintroducing the bug: 8/8 still green until this line was added.
      _resetServerBuildCache();
      const after = serverBuildInfo();
      expect(after.version, 'a disk edit must NOT move the running process version')
        .toBe(before.version);
      expect(after.version).not.toBe('99.99.99-probe');
      // ...and startedAt is the reference immutable — if it moved, the fixture is wrong.
      expect(after.startedAt).toBe(before.startedAt);
    } finally {
      writeFileSync(pkgPath, original);
    }
  });

  it('★★ a dirty-at-load tree is part of BUILD IDENTITY, and `dirty` cannot heal itself', async () => {
    // ef-manager, third instance of one defect in this file in one day.
    //
    // Their process started at 18:45 with HEAD=4615ed1 and UNCOMMITTED edits to
    // server-build.js. Four minutes later those edits became 040b518 — so the process
    // runs code that exists in NO COMMIT, and reported:
    //
    //     commit: 4615ed1 · dirty: false · startedAt: 18:45:45Z
    //
    // `dirty` was TRUE at load and read FALSE afterwards, because the edits had since
    // been committed. A reader parses that as "a clean build of 4615ed1". It is neither.
    //
    // ⛔ The field HEALED ITSELF while the condition it described persisted, which is
    // worse than a merely stale field — and it made the warning's own sentence
    // "Answers come from 4615ed1" false for that very process.
    //
    // The property: build identity must be load-time, and the query-time value must not
    // be able to masquerade as it.
    const { serverBuildInfo: build } = await import('../../../mcp/stdio/server-build.js');
    _resetServerBuildCache();
    const info = build();

    // Whatever the tree's state, the two must be distinguishable — never one field.
    expect(Object.hasOwn(info, 'dirty'), 'the ambiguous `dirty` name is retired').toBe(false);
    expect(Object.hasOwn(info, 'treeDirtyNow'), 'query-time dirtiness must be named as such').toBe(true);

    // ★★ buildId is UNCONDITIONAL. It was originally emitted only on a dirty load, so a
    // clean process had none — and ef-manager, told "quote buildId, not commit", went to
    // quote it and found it absent. An instruction that cannot be followed on the healthy
    // path is worse than no instruction.
    //
    // OMIT-WHEN-HEALTHY IS RIGHT FOR DIAGNOSTICS AND WRONG FOR IDENTITY: an empty
    // `nextActions` means "nothing to do"; a missing identifier means nothing at all, and
    // the reader falls back to the field we are replacing.
    expect(info.buildId, 'identity must exist in BOTH states').toBeTruthy();

    if (info.loadedDirtyFiles) {
      // Loaded a dirty tree — identity carries it and says why it matters.
      expect(info.buildId).toMatch(/\+\d+dirty$/);
      expect(info.loadedDirtyFiles.length).toBeGreaterThan(0);
      expect(info.loadedDirtyNote).toMatch(/exists in no commit/);
      expect(info.loadedDirtyNote, 'must forbid the invalid comparison explicitly').toMatch(/Do NOT diff/);
    } else {
      // Clean at load — identity is the bare commit, and no dirty fields are invented.
      expect(info.buildId).toBe(info.commit);
      expect(info.loadedDirtyNote).toBeUndefined();
    }
  });

  it('the stale warning is emitted ONCE — summary names it, server carries it', () => {
    // ef-manager, measured on e8c8d61: `server.staleWarning` (265 tok) was ALSO
    // inlined verbatim at the head of `summary`, making `server` the largest field in
    // the response at 26.8%. Same defect as nextActions-duplicated-into-summary,
    // reported and fixed that morning, recurring the same day in a feature shipped
    // since — so an instance fix did not prevent the pattern.
    //
    // The rule this pins: a summary NAMES a field, it does not INLINE it. Both land in
    // the same response, so the second copy is pure cost.
    const verdictBlock = healthSrc.slice(healthSrc.indexOf('const verdicts = []'));
    const stalePush = verdictBlock.slice(0, verdictBlock.indexOf('`nodes=${nodes}'));
    expect(stalePush, 'summary must POINT at server.staleWarning, not reproduce it')
      .toMatch(/see server\.staleWarning/);
    expect(stalePush, 'the full warning text must not be interpolated into the summary')
      .not.toMatch(/\$\{_build\.staleWarning\}/);
  });
});
