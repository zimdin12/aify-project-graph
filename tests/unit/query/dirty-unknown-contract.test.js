// ⛔ `dirty=` IS A TRUST NUMBER, AND IT USED TO LIE WHEN IT COULD NOT LOOK.
//
//     function safeDirtyCount(repoRoot) {
//       try { return getTrackedDirtyFilesSync(repoRoot).length; }
//       catch { return 0; }          // <- a failed git query reported ZERO DIRTY FILES
//     }
//
// Zero dirty files is indistinguishable from a genuinely clean tree, so the line said "the graph
// matches your working tree" at exactly the moment the tool had lost the ability to check. The
// honest marker already existed one line away: the same banner renders `indexed=?`, `head=?` and
// `trust=missing` when those are unknown. Three fields admitted ignorance; `dirty` alone did not.
//
// Captured by accident while probing something unrelated — the defect executing:
//     snapshotLine(REPO)  ->  "SNAPSHOT: indexed=? head=? dirty=0 trust=missing"
//
// ⇒ THE CONTRACT, preregistered at docs/2026-08-21-prereg-safedirtycount.md BEFORE any edit:
//     git query succeeds, zero tracked dirt  ->  0   numeric
//     git query succeeds, N tracked dirt     ->  N   numeric
//     git query FAILS                        ->  ?   typed unknown, never 0
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotLine } from '../../../mcp/stdio/query/verbs/packet-input.js';
import { getTrackedDirtyFilesSync } from '../../../mcp/stdio/freshness/git.js';

const dirtyField = (line) => /dirty=(\S+)/.exec(line)?.[1];

let repo;
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'dirty-contract-'));
});
afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 3 }));

const initRepo = () => {
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 'T');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.js'), 'export const x = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
};

describe('C1 — a failed git query renders UNKNOWN, never zero', () => {
  it('★★★⛔ THE INDUCTION IS PROVEN TO INDUCE, before its result is read', () => {
    // ⛔ A CONTROL WHOSE INDUCTION CANNOT REACH THE CODE PATH PASSES VACUOUSLY. If the helper
    // degraded to [] instead of throwing — as its NEIGHBOUR getChangedFilesSync deliberately does —
    // then `catch` would never run, the fix would change nothing, and this control would still be
    // green. So the throw is asserted first, as its own fact.
    expect(() => getTrackedDirtyFilesSync(repo),
      'a non-repository must make the git query THROW, or C1 proves nothing').toThrow();
  });

  it('★★★⛔ and the field renders ? rather than 0', () => {
    const line = snapshotLine({ graph_commit: 'a'.repeat(40) }, { commit: 'a'.repeat(40) }, repo);
    expect(dirtyField(line), 'a count the tool could not take must not read as zero').toBe('?');
  });
});

describe('C2 — an honest clean tree still renders numeric zero', () => {
  it('★★★ POSITIVE CONTROL: clean means 0, not ?', () => {
    // ⛔ Without this, C1 is satisfied by a function that returns `?` unconditionally — which would
    // destroy the field while passing the control that motivated the change. This is the assertion
    // that keeps the fix from being a lobotomy.
    initRepo();
    const head = git('rev-parse', 'HEAD');
    expect(dirtyField(snapshotLine({ graph_commit: head }, { commit: head }, repo))).toBe('0');
  });
});

describe('C3 — a genuinely dirty tree still renders a number', () => {
  it('★★★ a TRACKED modification renders as a count, and only the failure path changed', () => {
    initRepo();
    writeFileSync(join(repo, 'src', 'a.js'), 'export const x = 2;\n');
    const head = git('rev-parse', 'HEAD');
    const shown = dirtyField(snapshotLine({ graph_commit: head }, { commit: head }, repo));
    expect(Number(shown), 'a tracked-dirty tree must not render as clean or unknown').toBe(1);
  });

  it('★★★ UNTRACKED files are still excluded — the original field-report contract holds', () => {
    // ⚠ The scope this field already had, re-pinned so the unknown-marker change cannot quietly
    // widen it. A field report once showed dirty=592 from untracked noise while the read-verb
    // warning correctly said nothing; tracked-only is what makes the two agree.
    initRepo();
    writeFileSync(join(repo, 'untracked.js'), 'noise\n');
    const head = git('rev-parse', 'HEAD');
    expect(dirtyField(snapshotLine({ graph_commit: head }, { commit: head }, repo))).toBe('0');
  });
});

describe('the three states are mutually distinguishable', () => {
  it('★★★⛔ 0, N and ? are three different answers', () => {
    // ⛔ THE WHOLE POINT. Before the fix, "clean" and "could not look" were the same token, so a
    // reader could not tell them apart and neither could a test. Asserting they differ is what
    // makes the field evidence rather than decoration.
    initRepo();
    const head = git('rev-parse', 'HEAD');
    const clean = dirtyField(snapshotLine({ graph_commit: head }, { commit: head }, repo));

    writeFileSync(join(repo, 'src', 'a.js'), 'export const x = 3;\n');
    const modified = dirtyField(snapshotLine({ graph_commit: head }, { commit: head }, repo));

    const broken = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
    const unknown = dirtyField(snapshotLine({ graph_commit: head }, { commit: head }, broken));
    rmSync(broken, { recursive: true, force: true });

    expect(new Set([clean, modified, unknown]).size, `got ${clean} / ${modified} / ${unknown}`).toBe(3);
    expect(unknown).toBe('?');
  });
});
