// "WHICH BUILD IS ANSWERING ME" MUST BE TRUE, OR IT IS WORSE THAN ABSENT.
//
// serverBuild() read `git rev-parse HEAD` LAZILY, inside the first graph_health
// call, from the working directory. That is not the identity of the running code:
// a long-lived MCP server whose checkout is updated underneath it (git pull, a
// colleague's push) reports the NEW commit while executing the OLD code.
// `startedAt` had the same flaw — it recorded the time of the first health call,
// not process start, so it could not be used to spot the mismatch either.
//
// Cost a real run (2026-07-30): sc-manager correctly confirmed `server.commit
// e341de0` before testing a fix, got behaviour from an older build, and spent a
// scarce exclusivity window on it. The one field whose entire purpose is
// answering "which build is answering" was answering about the filesystem.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const healthSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../mcp/stdio/query/verbs/health.js'),
  'utf8',
);

describe('server build identity', () => {
  it('captures the commit at MODULE LOAD, not inside the first call', () => {
    // The capture must sit at module scope. Inside serverBuild() it would read
    // the tree at first-call time, which is the defect.
    expect(healthSrc).toMatch(/^const _loadedCommit = gitAt\(/m);
    expect(healthSrc).toMatch(/^const _processStartedAt = new Date\(\)\.toISOString\(\);/m);
  });

  it('startedAt is process start, not first-call time', () => {
    // `startedAt: new Date().toISOString()` INSIDE serverBuild() was the old bug.
    const inside = healthSrc.slice(healthSrc.indexOf('function serverBuild()'));
    expect(inside).not.toMatch(/startedAt: new Date\(\)/);
    expect(inside).toMatch(/startedAt: _processStartedAt/);
  });

  it('compares the loaded commit against the live tree and flags a stale process', () => {
    expect(healthSrc).toMatch(/const stale = Boolean\(_loadedCommit && treeCommit && _loadedCommit !== treeCommit\)/);
    expect(healthSrc).toMatch(/staleProcess: true/);
    expect(healthSrc).toMatch(/RESTART the aify-project-graph MCP server/);
  });

  it('reports the RUNNING commit as `commit`, and the tree separately', () => {
    // If these were swapped, the field would still be lying — just differently.
    expect(healthSrc).toMatch(/commit: _loadedCommit/);
    expect(healthSrc).toMatch(/workingTreeCommit: treeCommit/);
  });

  it('surfaces the stale warning in verdicts, above every other line', () => {
    // A JSON-only signal is not enough: the rendered summary is what a reader
    // scans before attributing behaviour to a commit.
    const verdictBlock = healthSrc.slice(healthSrc.indexOf('const verdicts = []'));
    const stalePos = verdictBlock.indexOf('_build.staleWarning');
    const nodesPos = verdictBlock.indexOf('`nodes=${nodes}');
    expect(stalePos).toBeGreaterThan(-1);
    expect(stalePos).toBeLessThan(nodesPos);
  });
});
