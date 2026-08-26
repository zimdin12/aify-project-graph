// scripts/measure-hook-fire-rate.mjs
//
// How often WOULD the deletion-guard hook speak, on this repository's real history?
//
//   node scripts/measure-hook-fire-rate.mjs [commits] [--json] [--repo <path>]
//
// ⛔ WHY THIS EXISTS. Enabling a PostToolUse hook means running a check after every edit an agent
// makes, forever. "How noisy is it" is the first question anyone should ask, and until now the only
// answer was a rate measured once, on a corpus that no longer exists. A rate nobody can re-derive is
// a claim, not a measurement.
//
// ⚠ WHAT IS COUNTED, AND WHAT IT IS NOT. The unit is a source FILE-CHANGE inside a commit. The hook
// fires per EDIT — one tool call, usually one file — and a commit bundles many, so these are not the
// same number and the smaller word is not used for the larger thing. Test files are excluded: the
// hook serves production edits.
//
// ⚠ AND IT IS AN UPPER BOUND. Only the hook's TEXT stage is replayable over history — "did this diff
// remove an exported declaration". The second stage asks the graph whether that symbol still has
// compiler-verified callers, which needs the graph as it was at that commit, and that does not
// exist. So the real rate is at most this, and the gap is not estimated here.
//
// ⛔ THE CONTROLS RUN FIRST AND THE SCRIPT REFUSES TO REPORT WITHOUT THEM. A rate produced by a
// filter that cannot say "no" is meaningless, and one that cannot say "yes" is worse. Both are
// exercised on synthetic diffs whose answers are known before the real corpus is touched.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { removedDeclarations } from '../mcp/stdio/analysis/deleted-with-callers.js';

const SOURCE_EXT = /\.(js|mjs|cjs|ts|tsx|py|php|rb|java|cpp|cc|h|hpp)$/;
const TEST_PATH = /^tests?\//;

const ADD_ONLY = ['--- a/x.js', '+++ b/x.js', '+export function added() {}'].join('\n');
const ONE_DELETE = ['--- a/x.js', '+++ b/x.js', '-export function gone() {}'].join('\n');

/**
 * Prove the text filter discriminates before any rate is computed. Returns a reason string when it
 * does not, so the caller can refuse rather than publish a number from a dead instrument.
 */
export function controlFailure() {
  const none = removedDeclarations(ADD_ONLY);
  const one = removedDeclarations(ONE_DELETE);
  if (!Array.isArray(none) || none.length !== 0) return 'an add-only diff reported a removal';
  if (!Array.isArray(one) || one.length !== 1) return 'a one-deletion diff did not report exactly one removal';
  if (one[0]?.exported !== true) return 'a removed `export` was not marked exported';
  return null;
}

export function isCountedPath(file) {
  return SOURCE_EXT.test(file) && !TEST_PATH.test(file);
}

export function measure({ repo, commits = 200, git }) {
  const failure = controlFailure();
  if (failure) throw new Error(`controls failed (${failure}) — refusing to report a rate`);

  const shas = git(repo, 'log', '--format=%H', `-${commits}`).trim().split('\n').filter(Boolean);
  let fileChanges = 0;
  let withRemoval = 0;
  let withExportedRemoval = 0;
  const examples = [];

  for (const sha of shas) {
    let files;
    try { files = git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha).trim().split('\n').filter(Boolean); }
    catch { continue; }
    for (const file of files.filter(isCountedPath)) {
      fileChanges += 1;
      let diff;
      try { diff = git(repo, 'diff', `${sha}^`, sha, '--', file); } catch { continue; }
      const removed = removedDeclarations(diff);
      if (!Array.isArray(removed) || removed.length === 0) continue;
      withRemoval += 1;
      const exported = removed.filter((r) => r?.exported === true);
      if (exported.length === 0) continue;
      withExportedRemoval += 1;
      if (examples.length < 8) examples.push({ sha: sha.slice(0, 8), file, symbols: exported.map((r) => r.name).slice(0, 3) });
    }
  }

  return {
    unit: 'source file-change inside a commit (NOT an edit; a commit bundles many)',
    bound: 'upper — the caller check cannot be replayed against a historical graph',
    commitsExamined: shas.length,
    fileChanges,
    withRemoval,
    withExportedRemoval,
    upperBoundFireRate: fileChanges ? withExportedRemoval / fileChanges : null,
    examples,
  };
}

const realGit = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function main(argv) {
  const at = argv.indexOf('--repo');
  const repo = at >= 0 && argv[at + 1] ? argv[at + 1] : resolve('.');
  const n = Number(argv.find((a) => /^\d+$/.test(a)) ?? 200);
  const r = measure({ repo, commits: n, git: realGit });

  if (argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return 0; }
  const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  console.log(`repo                        : ${repo}`);
  console.log(`commits examined            : ${r.commitsExamined}`);
  console.log(`source FILE-CHANGES         : ${r.fileChanges}   <- the denominator (${r.unit})`);
  console.log(`  with ANY removed decl     : ${r.withRemoval}`);
  console.log(`  with an EXPORTED removal  : ${r.withExportedRemoval} (${pct(r.upperBoundFireRate)})  <- ${r.bound} bound on fire rate`);
  if (r.examples.length) {
    console.log('\nexamples of what would reach the caller check:');
    for (const e of r.examples) console.log(`   ${e.sha}  ${e.file}  ->  ${e.symbols.join(', ')}`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exit(main(process.argv.slice(2))); }
  catch (err) { console.error(err.message); process.exit(2); }
}
