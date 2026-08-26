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
import { existsSync } from 'node:fs';
import { removedDeclarations } from '../mcp/stdio/analysis/deleted-with-callers.js';
import { openExistingDb } from '../mcp/stdio/storage/db.js';

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

/**
 * The PRECONDITION, without which the fire rate above is misleading.
 *
 * ⛔ `callersOf` only counts edges whose provenance is LSP_VERIFIED, so the hook is SILENT BY
 * CONSTRUCTION on any graph that has never had a code-intel collection run. Measured by executing
 * it: a freshly-indexed graph of this repository holds 12,837 EXTRACTED and 1,230 AMBIGUOUS call
 * edges and **zero** verified ones. The same repository's collected graph holds 2,379 (15.5%).
 *
 * ⇒ Reporting "2.2% of file-changes could fire" beside a graph with no verified edges would be a
 * true number attached to a false impression. The rate is a CEILING on a ceiling: the text stage
 * bounds it, and this bounds whether the second stage can ever agree.
 *
 * Returns null when there is no graph to read — unknown, never assumed clean.
 */
export function verifiedEdgeCoverage(repo) {
  const dbPath = `${repo}/.aify-graph/graph.sqlite`;
  if (!existsSync(dbPath)) return null;
  let db;
  try { db = openExistingDb(dbPath); } catch { return null; }
  try {
    const rows = db.all(
      "SELECT provenance, count(*) AS c FROM edges WHERE relation IN ('CALLS','REFERENCES','IMPORTS') GROUP BY provenance",
    );
    const total = rows.reduce((a, r) => a + r.c, 0);
    const verified = rows.find((r) => r.provenance === 'LSP_VERIFIED')?.c ?? 0;
    return { total, verified, share: total ? verified / total : null };
  } catch { return null; } finally { try { db.close(); } catch { /* ignore */ } }
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
    // ⚠ Carried in the payload, not left to prose: a fire rate quoted without this is a true number
    // creating a false impression, because the hook cannot speak at all when `verified` is 0.
    verifiedEdges: verifiedEdgeCoverage(repo),
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
  const v = r.verifiedEdges;
  console.log('');
  if (!v) {
    console.log('PRECONDITION: no graph found — cannot say whether the hook could speak at all.');
  } else if (v.verified === 0) {
    console.log(`PRECONDITION: ${v.verified} of ${v.total} call edges are LSP_VERIFIED.`);
    console.log('⛔ THE HOOK IS SILENT BY CONSTRUCTION HERE. It only counts compiler-verified callers,');
    console.log('   so on this graph the rate above is a ceiling on something that cannot happen.');
    console.log('   Run graph_collect_code_intel first, or enabling the hook delivers nothing.');
  } else {
    console.log(`PRECONDITION: ${v.verified} of ${v.total} call edges are LSP_VERIFIED (${(v.share * 100).toFixed(1)}%).`);
    console.log('   The hook can speak on this graph; its reach grows with collection coverage.');
  }
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
