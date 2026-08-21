// ⛔⛔ THIS FILE PINS A LIVE DEFECT. THE ASSERTIONS BELOW DESCRIBE BEHAVIOUR THAT IS WRONG.
//
// Read the test names before the expectations. A green run here does NOT mean the system is
// correct — it means the defect is still exactly as characterised. When the fix lands, the
// assertions marked ⛔ DEFECT flip, and the flip is the point.
//
// ═══ WHAT IS BROKEN ═══
//
// `graph_find`-style freshness runs ask git which files changed between the indexed commit and
// HEAD. `getChangedFilesSync` returns [] on ANY git failure — deliberately, and documented:
// "so callers can degrade gracefully instead of throwing". That is correct for its display-path
// caller and dangerous for the orchestrator, which folds the result into the set of files to
// reindex.
//
// When the indexed commit is no longer resolvable — after a rebase, a branch reset, a force-push,
// a gc that prunes it, or across a shallow-clone boundary — the delta comes back EMPTY. The
// orchestrator then finds nothing to process, takes its no-op path, and ADVANCES THE MANIFEST
// COMMIT with status:'ok' while leaving node and edge state untouched.
//
// ⇒ The graph reports itself indexed at a commit whose code it has never read.
//
// ═══ MEASURED, unmocked, against the real orchestrator ═══
//
//     arm       indexed commit resolvable   manifest advanced   new symbol in graph
//     CONTROL   true                        yes                 YES
//     HOSTILE   false                       yes                 NO
//
// ⚠ THE CONTROL ARM IS NOT OPTIONAL. It proves the harness reindexes at all. Without it, "the new
// symbol is absent" is equally explained by a setup that never indexed anything — and a broken
// experiment produces the same silence as a real defect.
//
// ⚠ AND THE TRIGGER IS BROADER THAN FIRST REPORTED. I initially claimed this needed a CLEAN working
// tree. Both arms run DIRTY and it reproduces anyway: what matters is that the changed file is not
// in the dirty set, which is the normal case for anything committed and not since re-edited.
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
 * `manifestCommit`, and run freshness again.
 */
async function run(manifestCommitFor) {
  const repo = mkdtempSync(join(tmpdir(), 'apg-stalecommit-'));
  created.push(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t.t');
  git(repo, 'config', 'user.name', 'T');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
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
  // hostile arm would be measuring nothing, and its result would look identical.
  let resolvable = true;
  try { git(repo, 'rev-parse', '--verify', `${manifest.commit}^{commit}`); } catch { resolvable = false; }

  await ensureFresh({ repoRoot: repo });

  const after = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let betaInGraph = false;
  const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));
  try { betaInGraph = db.all("SELECT label FROM nodes WHERE label = 'beta'").length > 0; }
  finally { db.close(); }

  return { resolvable, advanced: after.commit === second, betaInGraph };
}

describe('a graph whose indexed commit vanished', () => {
  it('★★★ CONTROL — a RESOLVABLE indexed commit reindexes the change', async () => {
    // ⛔ WITHOUT THIS ARM THE OTHER ONE PROVES NOTHING. It establishes that this harness really
    // does ingest a new symbol, so the hostile arm's absence is a defect rather than an inert setup.
    const r = await run(({ first }) => first);
    expect(r.resolvable, 'the control must actually be resolvable').toBe(true);
    expect(r.betaInGraph, 'the harness reindexes: the new symbol IS ingested').toBe(true);
  }, 180_000);

  it('⛔ DEFECT (pinned): an UNRESOLVABLE indexed commit advances the manifest anyway', async () => {
    // ⛔⛔ THIS ASSERTION DESCRIBES BROKEN BEHAVIOUR AND IS EXPECTED TO FLIP WHEN FIXED.
    //
    // The manifest advances to a commit whose code was never read. Pinned so the defect is
    // reproducible on demand by anyone, and so a later change cannot alter it silently — in either
    // direction. A fix flips `betaInGraph` to true; a regression that removes the advance flips
    // `advanced`. Both are visible here.
    const r = await run(() => UNRESOLVABLE);
    expect(r.resolvable, 'the induction must really be unresolvable').toBe(false);
    expect(r.advanced, '⛔ DEFECT: the manifest advances to a commit whose code was never read').toBe(true);
    expect(r.betaInGraph, '⛔ DEFECT: the symbol added in that commit is absent from the graph').toBe(false);
  }, 180_000);
});
