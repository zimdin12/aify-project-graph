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
import {
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
    expect(buildSrc).toMatch(/^const LOADED_COMMIT = gitAt\(/m);

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
    expect(buildSrc).toMatch(/SERVER IS RUNNING STALE CODE/);
    expect(buildSrc).toMatch(/Answers come from \$\{LOADED_COMMIT\}/);
    expect(buildSrc).toMatch(/RESTART the aify-project-graph MCP server/);
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
    const verdictBlock = healthSrc.slice(healthSrc.indexOf('const verdicts = []'));
    const stalePos = verdictBlock.indexOf('_build.staleWarning');
    const nodesPos = verdictBlock.indexOf('`nodes=${nodes}');
    expect(stalePos).toBeGreaterThan(-1);
    expect(stalePos).toBeLessThan(nodesPos);
  });
});
