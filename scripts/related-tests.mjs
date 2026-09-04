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

const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

/** Source files in the commit that a test could plausibly import. Docs and evidence are excluded. */
export function stagedSourceFiles(files) {
  return files.filter((f) => f.startsWith('mcp/') && f.endsWith('.js') && !f.endsWith('.test.js'));
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
    const abs = `${REPO}/${t}`;
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
  return execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8', cwd: REPO })
    .split('\n').filter((f) => f.endsWith('.test.js'));
}

function stagedFiles() {
  return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    { encoding: 'utf8', cwd: REPO }).split('\n').filter(Boolean);
}

// `node -e` and test importers have no argv[1]; guard rather than throw on the import path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sources = stagedSourceFiles(stagedFiles());
  if (sources.length === 0) process.exit(0);          // docs/evidence commit — nothing to check
  const related = testsImporting(sources, allTestFiles());
  if (related.length === 0) {
    // ⚠ NOT SILENCE. Zero related tests is a real fact about the change and the author should see
    // it — it means nothing existing describes the contract being altered.
    process.stderr.write(
      `[related-tests] ${sources.length} source file(s) staged, NO existing test imports them.\n`
      + '  Nothing describes the contract you are changing. That is worth knowing before you commit.\n');
    process.exit(0);
  }
  process.stdout.write(related.join('\n') + '\n');
}
