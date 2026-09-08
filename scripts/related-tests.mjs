// WHICH EXISTING TESTS DESCRIBE THE CONTRACT I AM ABOUT TO CHANGE?
//
// ⛔ THE FAILURE THIS EXISTS FOR, 2026-09-04. I edited `mcp/stdio/query/verbs/packet-evidence.js`,
// ran the six-case file I had just written to describe my change, saw green, and committed.
// `tests/unit/query/packet-evidence.test.js` had existed since 2026-08-12 and referenced
// `buildEvidenceBlock` four times. I never ran it. The full suite then went red with 20 failures
// across four files I had not opened.
//
// ⭐ THE ASYMMETRY IS THE WHOLE POINT: the file I wrote describes MY INTENT. The file that already
// existed describes THE CONTRACT I WAS BREAKING. I ran the one that agreed with me.
//
// ⚠ WHY NOT "RUN THE FULL SUITE BEFORE EVERY COMMIT": it takes ~11 minutes here, and this repo has
// a hard COMMIT-BEFORE-MUTATING rule, so that bar would be abandoned inside a day — a rule with a
// 100% failure rate is worse than none. This is the cheap version: seconds, and it only looks at
// tests that actually import what changed.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// ⚠ LAZY, because this module is IMPORTED BY A TEST and a guard that throws on import is a guard
// that can take the whole hook down. Resolved at call time, and a non-repo cwd yields '' rather than
// an exception — the hook then finds no tests and exits 0, which is the safe direction for a
// pre-commit check that must never block a commit for its own reasons.
let repoRoot = null;
function repo() {
  if (repoRoot === null) {
    try {
      repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    } catch { repoRoot = ''; }
  }
  return repoRoot;
}

/** Source files in the commit that a test could plausibly import. Docs and evidence are excluded. */
export function stagedSourceFiles(files) {
  // ⚠ `scripts/` IS SOURCE TOO, AND LEAVING IT OUT MADE THIS GUARD BLIND TO ITS OWN CODE. The first
  // version filtered `mcp/` only, so the commit that added scripts/lib/oracle-built-fixtures.mjs ran
  // no related tests at all — a forced door that does not cover the room it stands in.
  const SOURCE_DIRS = ['mcp/', 'scripts/'];
  return files.filter((f) => SOURCE_DIRS.some((d) => f.startsWith(d))
    && (f.endsWith('.js') || f.endsWith('.mjs'))
    && !f.endsWith('.test.js'));
}

/** Test files in the commit. A test can break by its own edit, with no source change at all. */
export function stagedTestFiles(files) {
  return files.filter((f) => f.startsWith('tests/') && f.endsWith('.test.js'));
}

// ⛔ A TEST THAT ENUMERATES A TREE AT RUNTIME HAS NO IMPORT EDGE TO WHAT IT READS, so
// `testsImporting` is structurally blind to it. The ratchet in
// tests/unit/negative-assertions-are-controlled.test.js is exactly that shape: it reads every test
// file in the repo and imports none of them. It was therefore never selected by this hook, and
// caught three of my violations at FULL-SUITE time instead — ~20 minutes each, three times in one
// session, on the same rule.
//
// ⚠ WHY THIS DOES NOT TRY TO WORK OUT WHICH TREE EACH ONE WALKS. The root is a runtime expression
// (`new URL('..', import.meta.url)`, a git invocation, a joined constant); recovering it from the
// source means guessing, and a wrong guess DROPS the test silently — which is the defect being
// fixed, reintroduced one level up. So anything that enumerates runs whenever anything is staged.
// Measured 2026-09-08: 31 files, 192 tests, 49s. Against 20 minutes, three times.
//
// ⚠ WHAT THIS CANNOT SEE: enumeration through a glob library, a shell-out that lists files by some
// other verb, or a helper module that walks on the test's behalf. The signal is the three calls
// below and nothing else; a new corpus test using a fourth mechanism is invisible here until this
// regex learns it.
const ENUMERATES_A_TREE = /readdirSync|readdir\(|ls-files/;

/**
 * Tests that read a whole tree rather than importing named modules.
 *
 * @param {string[]} testFiles repo-relative test paths to search
 * @returns {string[]} tests that enumerate, sorted
 */
export function corpusWideTests(testFiles) {
  const hits = [];
  for (const t of testFiles) {
    const abs = `${repo()}/${t}`;
    if (!existsSync(abs)) continue;
    let text;
    try { text = readFileSync(abs, 'utf8'); } catch { continue; }
    if (ENUMERATES_A_TREE.test(text)) hits.push(t);
  }
  return hits.sort();
}

/**
 * Test files that IMPORT one of `sources`.
 *
 * Matching is on the import specifier's final segment, so `../../../mcp/stdio/query/verbs/
 * packet-evidence.js` matches the staged `mcp/stdio/query/verbs/packet-evidence.js`. A basename can
 * collide across directories; that over-includes, which costs seconds and is the safe direction.
 *
 * @param {string[]} sources repo-relative source paths
 * @param {string[]} testFiles repo-relative test paths to search
 * @returns {string[]} test files importing at least one source, sorted
 */
export function testsImporting(sources, testFiles) {
  const wanted = new Set(sources.map((s) => basename(s)));
  if (wanted.size === 0) return [];
  const hits = new Set();
  for (const t of testFiles) {
    const abs = `${repo()}/${t}`;
    if (!existsSync(abs)) continue;
    let text;
    try { text = readFileSync(abs, 'utf8'); } catch { continue; }
    // Only look at import/require specifiers, so a bare mention in a comment does not pull a file in.
    for (const m of text.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      if (wanted.has(basename(m[1]))) { hits.add(t); break; }
    }
  }
  return [...hits].sort();
}

function allTestFiles() {
  return execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8', cwd: repo() })
    .split('\n').filter((f) => f.endsWith('.test.js'));
}

function stagedFiles() {
  return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    { encoding: 'utf8', cwd: repo() }).split('\n').filter(Boolean);
}

// `node -e` and test importers have no argv[1]; guard rather than throw on the import path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const staged = stagedFiles();
  if (staged.length === 0) process.exit(0);
  const sources = stagedSourceFiles(staged);
  const allTests = allTestFiles();

  const selected = new Set(testsImporting(sources, allTests));
  // ⛔ A TEST-ONLY COMMIT USED TO RUN NOTHING AT ALL. `stagedSourceFiles` returned empty and the
  // hook exited 0 having selected no tests — so the one file the author had just edited, the file
  // most likely to be wrong, was the one thing not run.
  for (const t of stagedTestFiles(staged)) selected.add(t);
  for (const t of corpusWideTests(allTests)) selected.add(t);

  if (sources.length > 0 && testsImporting(sources, allTests).length === 0) {
    // ⚠ NOT SILENCE. Zero related tests is a real fact about the change and the author should see
    // it — it means nothing existing describes the contract being altered. It stays a warning even
    // now that corpus-wide tests are always selected, because those describe repo invariants and
    // not this contract.
    process.stderr.write(
      `[related-tests] ${sources.length} source file(s) staged, NO existing test imports them.\n`
      + '  Nothing describes the contract you are changing. That is worth knowing before you commit.\n');
  }
  if (selected.size === 0) process.exit(0);
  process.stdout.write([...selected].sort().join('\n') + '\n');
}
