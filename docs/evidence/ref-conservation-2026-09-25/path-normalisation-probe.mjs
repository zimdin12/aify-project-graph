// PATH NORMALISATION — can a Windows path alias defeat `existsWithExactCase`?
//
// WHY THIS EXISTS. The case-rename defect (commit 27c5c422) was: `existsSync` is case-insensitive
// on Windows, so it answered PRESENT for a path no directory listing contains, and the orchestrator
// skipped deleting stale nodes. The fix compares each segment against `readdirSync`.
//
// dashboard-manager then pointed out that case is not the only aliasing Windows does, and named two
// more shapes it had NOT measured: trailing dots / spaces (`src/middle.js.`), and 8.3 short names
// (`LONGDI~1`). Both would make `existsSync` answer true for a spelling no listing contains — the
// SAME shape as the original defect. An unmeasured pointer is not a finding, so this measures it.
//
// ⛔ BOTH DIRECTIONS ARE TESTED, because only one of them is dangerous and it is not the obvious one.
//   - ALIAS ACCEPTED (existsSync true, listing has no such entry): the ORIGINAL defect. The fix must
//     say ABSENT.
//   - LIVE FILE DENIED (a file genuinely named `dot.js.`, reported absent): a NEW defect the fix
//     could introduce, because `existsWithExactCase` keeps `existsSync` as a fast path to FALSE.
//     The caller's response to "absent" is `deleteNodesForFile`, so a wrong FALSE destroys real data.
//     ARM 3 exists only to look for this, and it is the arm worth keeping.
//
// ⛔ ARM 2 IS NOT OPTIONAL. `path.join` normalises, so a probe for `src/middle.js.` can silently
//    become a probe for `src/middle.js`. That returns a clean-looking FALSE for the alias and reads
//    exactly like "the vector does not fire". A mutation that applies nothing manufactures a finding
//    — so ARM 2 prints the bytes `join` actually produced, and cross-checks against raw concatenation.
//
// Controls in EVERY run: a real path that must be TRUE (the instrument can say PRESENT) and an absent
// path that must be FALSE (it can say ABSENT). A probe that cannot return ABSENT cannot return PRESENT.
//
// Run: node docs/evidence/ref-conservation-2026-09-25/path-normalisation-probe.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const { existsWithExactCase } = await import(
  new URL('../../../mcp/stdio/freshness/path-exists.js', import.meta.url)
);

// ⭐ BROKEN-SUBJECT DIFFERENTIAL. `--unfixed` swaps the fixed helper for the bare `existsSync` the
// defect shipped with. A clean run against the FIXED subject proves nothing on its own: it looks
// identical whether the vectors are absent or the probe is blind. Running the SAME instrument
// against a subject known to have the defect is what shows it can see one. Expected under
// `--unfixed`: ARM 1 fails on exactly the alias rows (wrong case, 8.3) and nothing else.
const UNFIXED = process.argv.includes('--unfixed');
const probe = UNFIXED
  ? (repoRoot, rel) => existsSync(join(repoRoot, rel))
  : existsWithExactCase;

const root = mkdtempSync(join(tmpdir(), 'apg-path-normalisation-'));
let failures = 0;

function fail(msg) {
  failures += 1;
  console.log('  FAILURE: ' + msg);
}

try {
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'middle.js'), 'export function middle() { return 1; }\n');
  mkdirSync(join(root, 'LongDirectoryNameHere'));
  writeFileSync(join(root, 'LongDirectoryNameHere', 'f.js'), 'export function f() {}\n');

  console.log('HELPER UNDER TEST: ' + (UNFIXED
    ? 'bare existsSync  [--unfixed: the BROKEN subject, expected to FAIL the alias rows]'
    : 'existsWithExactCase  [the fixed subject]'));
  console.log('SUBJECT: ' + root);
  console.log('GROUND TRUTH readdir(src) = ' + JSON.stringify(readdirSync(join(root, 'src'))));
  console.log('');

  // ── ARM 2 first: prove the probe inputs survive path.join ─────────────────────────────────────
  // Printed BEFORE the verdicts, because every verdict below is void if the input was mangled.
  console.log('ARM 2 — INPUT INTEGRITY (does join() preserve the alias suffix?)');
  for (const rel of ['src/middle.js.', 'src/middle.js ', 'src/middle.js']) {
    const joined = join(root, rel);
    const tail = joined.slice(root.length);
    // Built WITHOUT join(), so it is a genuinely independent second construction of the same path.
    const concat = root + sep + rel.split('/').join(sep);
    const preserved = tail.endsWith(rel.slice(rel.lastIndexOf('/') + 1));
    console.log(
      '  input=' + JSON.stringify(rel).padEnd(18) +
      ' join_tail=' + JSON.stringify(tail).padEnd(20) +
      ' preserved=' + String(preserved).padEnd(6) +
      ' existsSync(join)=' + String(existsSync(joined)).padEnd(6) +
      ' existsSync(concat)=' + existsSync(concat)
    );
    if (!preserved) fail('join() mangled ' + JSON.stringify(rel) + ' — ARM 1 verdict for it is VOID');
  }
  console.log('');

  // ── ARM 1: does an alias defeat the fix? ──────────────────────────────────────────────────────
  console.log('ARM 1 — ALIAS VECTORS (existsSync says present for a spelling readdir does not list)');
  const arm1 = [
    { rel: 'src/middle.js', expect: true, note: 'POSITIVE CONTROL — the real path' },
    { rel: 'src/nope.js', expect: false, note: 'NEGATIVE CONTROL — genuinely absent' },
    { rel: 'src/MIDDLE.js', expect: false, note: 'wrong case — the defect 27c5c422 fixed' },
    { rel: 'src/middle.js.', expect: false, note: 'trailing DOT' },
    { rel: 'src/middle.js ', expect: false, note: 'trailing SPACE' },
    { rel: 'LONGDI~1/f.js', expect: false, note: '8.3 short name' },
  ];
  for (const { rel, expect, note } of arm1) {
    const es = existsSync(join(root, rel));
    const ec = probe(root, rel);
    const ok = ec === expect;
    console.log(
      '  ' + JSON.stringify(rel).padEnd(18) +
      ' existsSync=' + String(es).padEnd(6) +
      ' exactCase=' + String(ec).padEnd(6) +
      (es === true && ec === false ? ' [ALIAS ACCEPTED BY existsSync, REJECTED BY FIX]' : '') +
      '  ' + note
    );
    if (!ok) fail(JSON.stringify(rel) + ' expected ' + expect + ', got ' + ec);
  }
  console.log('');

  // ── ARM 3: the dangerous direction — a LIVE file must never be called absent ───────────────────
  console.log('ARM 3 — LIVE FILES WITH ALIAS-SHAPED NAMES (a wrong FALSE here deletes real nodes)');
  for (const name of ['dot.js.', 'space.js ']) {
    try {
      writeFileSync(join(root, 'src', name), 'x\n');
    } catch (err) {
      console.log('  could not create ' + JSON.stringify(name) + ' (' + err.code + ') — vector not reachable here');
    }
  }
  const listing = readdirSync(join(root, 'src'));
  console.log('  readdir(src) now = ' + JSON.stringify(listing));
  for (const name of listing) {
    const rel = 'src/' + name;
    const ec = probe(root, rel);
    console.log(
      '  ' + JSON.stringify(name).padEnd(14) +
      ' inReaddir=true' +
      ' existsSync=' + String(existsSync(join(root, rel))).padEnd(6) +
      ' exactCase=' + String(ec).padEnd(6) +
      (ec ? ' ok' : ' LIVE FILE REPORTED ABSENT -> WOULD DELETE ITS NODES')
    );
    if (!ec) fail('live file ' + JSON.stringify(rel) + ' reported ABSENT');
  }

  console.log('');
  console.log(failures === 0 ? 'VERDICT: 0 failures' : 'VERDICT: ' + failures + ' FAILURE(S)');
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
