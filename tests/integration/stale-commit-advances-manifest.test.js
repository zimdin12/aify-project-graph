// ⛔ THE DEFECT THIS FILE WAS BUILT TO PIN, AND THE FIX THAT CLOSED IT.
//
// ═══ WHAT WAS BROKEN ═══
//
// `getChangedFilesSync` returned `[]` on ANY git failure. So these were the same value:
//
//     HEAD..HEAD   -> []    a legitimate empty delta
//     bogus..HEAD  -> []    a failure
//
// The orchestrator folds that into the set of files to reindex. With an indexed commit git could no
// longer resolve — after a rebase, a branch reset, a force-push, a gc that pruned it, or across a
// shallow-clone boundary — the delta came back empty, nothing was found to process, the no-op path
// fired, and the manifest commit ADVANCED with status:'ok' while node and edge state stayed
// untouched. The graph reported itself indexed at a commit whose code it had never read.
//
// Measured, unmocked, before the fix:
//
//     arm       indexed commit resolvable   manifest advanced   new symbol in graph
//     CONTROL   true                        yes                 YES
//     HOSTILE   false                       yes                 NO      ← the defect
//
// ═══ THE FIX ═══
//
// `null` now means "the delta could not be computed"; `[]` still means "zero files changed". The
// orchestrator treats an unresolvable indexed commit as morally identical to an ABSENT one — which
// `!manifest.commit` already forces a full rebuild for — so the repair folded one term into an
// existing decision rather than adding a path. `packet-verify` writes `?? []` and keeps the
// degradation its own comment promises.
//
// ⚠ THE ASSERTIONS BELOW USED TO ASSERT THE OPPOSITE, deliberately, and were written to flip here.
// The flip IS the evidence: `betaInGraph` moved from false to true, so the fix is demonstrated by a
// test that existed before it and characterised the broken behaviour first.
//
// ⚠ THE CONTROL ARM IS NOT OPTIONAL AND DID NOT CHANGE. It proves this harness ingests a new symbol
// at all. Without it, "the symbol is present" after the fix could equally be a harness that indexes
// everything unconditionally — and now that the hostile arm triggers a FULL REBUILD, the control is
// what proves the resolvable path is still doing an incremental update rather than rebuilding too.
//
// ⚠ THE TRIGGER IS BROADER THAN FIRST REPORTED. I claimed it needed a CLEAN working tree. Both arms
// run DIRTY and it reproduced anyway: what matters is that the changed file is not in the dirty
// set, which is the normal case for anything committed and not since re-edited.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureFresh } from '../../mcp/stdio/freshness/orchestrator.js';
import { openExistingDb } from '../../mcp/stdio/storage/db.js';

/** A syntactically valid sha that this repository does not contain. */
const UNRESOLVABLE = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

const created = [];
afterEach(() => {
  while (created.length) {
    const d = created.pop();
    try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* win lock */ }
  }
});

const git = (r, ...a) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8' }).trim();

/**
 * Index a real repo, add a real second commit introducing `beta`, point the manifest at
 * `manifestCommitFor(...)`, and run freshness again.
 */
async function run(manifestCommitFor) {
  const repo = mkdtempSync(join(tmpdir(), 'apg-stalecommit-'));
  created.push(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t.t');
  git(repo, 'config', 'user.name', 'T');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
  // ⛔ A FILE THAT NEVER CHANGES, and it is what makes the control DISCRIMINATE at all. In a
  // single-file repo an incremental update and a full rebuild produce IDENTICAL results, so "the
  // new symbol is present" would be satisfied by a fix that rebuilds everything on every run —
  // correct and ruinous. This file is absent from an incremental run's processedFiles and present
  // in a rebuild's, which is the only thing that tells the two apart.
  writeFileSync(join(repo, 'src', 'untouched.js'), 'export function gamma() { return 3; }\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'w');
  const first = git(repo, 'rev-parse', 'HEAD');

  await ensureFresh({ repoRoot: repo });

  // A genuine second commit that adds a symbol the graph has never seen.
  writeFileSync(join(repo, 'src', 'a.js'),
    'export function alpha() { return 1; }\nexport function beta() { return 2; }\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'x');
  const second = git(repo, 'rev-parse', 'HEAD');

  const manifestPath = join(repo, '.aify-graph', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.commit = manifestCommitFor({ first, second });
  writeFileSync(manifestPath, JSON.stringify(manifest));

  // ⛔ THE INDUCTION, ASSERTED RATHER THAN ASSUMED. If git could still resolve this commit the
  // hostile arm would be measuring nothing, and its result would look identical to a pass.
  let resolvable = true;
  try { git(repo, 'rev-parse', '--verify', `${manifest.commit}^{commit}`); } catch { resolvable = false; }

  const result = await ensureFresh({ repoRoot: repo });

  const after = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let betaInGraph = false;
  const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));
  try { betaInGraph = db.all("SELECT label FROM nodes WHERE label = 'beta'").length > 0; }
  finally { db.close(); }

  const processed = result.processedFiles ?? [];
  return {
    resolvable,
    advanced: after.commit === second,
    betaInGraph,
    // Did the run touch the file that never changed? The incremental/rebuild discriminator.
    touchedUntouched: processed.some((f) => String(f).includes('untouched')),
  };
}

describe('a graph whose indexed commit vanished', () => {
  it('★★★ CONTROL — a RESOLVABLE indexed commit reindexes the change', async () => {
    // ⛔ WITHOUT THIS ARM THE OTHER ONE PROVES NOTHING. Before the fix it established that the
    // harness ingests a new symbol at all. After the fix it carries a second load: the hostile arm
    // now triggers a FULL REBUILD, and this arm is what shows the ordinary path did not start
    // rebuilding too. A fix that rebuilds on every run would be correct and ruinous.
    const r = await run(({ first }) => first);
    expect(r.resolvable, 'the control must actually be resolvable').toBe(true);
    expect(r.betaInGraph, 'the harness reindexes: the new symbol IS ingested').toBe(true);
    // ⛔ THE ASSERTION THAT CATCHES OVER-CORRECTION, and the one this control was missing until I
    // checked it against the hostile world I had preregistered. `betaInGraph` alone is satisfied by
    // a fix that rebuilds everything every time. This says the ordinary path did NOT touch the file
    // that never changed — so it is still doing an incremental update.
    expect(r.touchedUntouched, 'the resolvable path must stay INCREMENTAL, not rebuild').toBe(false);
  }, 180_000);

  it('★★★ FIXED — an UNRESOLVABLE indexed commit no longer advances over unread code', async () => {
    // ⚠ THIS ASSERTION USED TO BE ITS OWN OPPOSITE. It asserted `betaInGraph === false` and was
    // labelled ⛔ DEFECT, pinned so the broken behaviour was reproducible on demand and could not
    // change silently in either direction. The flip below is the evidence that the fix works, from
    // a test written before it.
    //
    // The manifest still advances — correctly now, because the full rebuild actually READ the new
    // commit. What changed is that the code is in the graph rather than merely claimed.
    const r = await run(() => UNRESOLVABLE);
    expect(r.resolvable, 'the induction must really be unresolvable').toBe(false);
    expect(r.betaInGraph, 'the symbol added in that commit is now IN the graph').toBe(true);
    expect(r.advanced, 'and the manifest advance is honest: the content was read').toBe(true);
    // The rebuild really is a rebuild: it reprocessed the file that never changed too. That is the
    // stated COST of this repair, asserted rather than left implicit in a design note.
    expect(r.touchedUntouched, 'an unavailable delta forces a FULL rebuild — the stated cost').toBe(true);
  }, 180_000);
});
