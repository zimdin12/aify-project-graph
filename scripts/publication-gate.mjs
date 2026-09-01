#!/usr/bin/env node
// ⛔ THE BOUNDED GATE FOR AN EVIDENCE-PUBLICATION COMMIT.
//
// A receipt describes a COMPLETED run, so it can never live inside the subject it certifies —
// certifying the commit that contains the receipt about itself is a recursion, not a debt. So this
// repository has two identities:
//
//   1. TESTED SUBJECT            — certified by a completed bare full-suite receipt;
//   2. EVIDENCE-PUBLICATION COMMIT — publishes the immutable receipt/sidecar ABOUT its parent, and
//                                    claims NO full-suite verdict for itself.
//
// This gate is what an evidence-publication commit must pass INSTEAD of another full suite. It is
// deliberately narrow: it checks that the published evidence is intact, honest about its subject,
// and that nothing else rode along with it.
//
// Usage: node scripts/publication-gate.mjs [commit]     (default HEAD)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ALLOWED, REQUIRED_FIELDS } from './publication-rules.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const COMMIT = process.argv[2] ?? 'HEAD';
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });

// Decision rules live in publication-rules.mjs so they can be imported and tested.
// Running as a script? The CLI path below only executes when invoked directly.
const INVOKED_DIRECTLY = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!INVOKED_DIRECTLY) { /* imported for tests */ } else {

const failures = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

// ── 1. identity ────────────────────────────────────────────────────────────────────────────────
const sha = git('rev-parse', COMMIT).trim();
const parent = git('rev-parse', `${COMMIT}^`).trim();
check('commit resolves', /^[0-9a-f]{40}$/.test(sha), sha);
check('parent resolves', /^[0-9a-f]{40}$/.test(parent), parent);

// ── 2. only allowlisted evidence paths changed ─────────────────────────────────────────────────
const changed = git('diff', '--name-only', `${parent}..${sha}`).split('\n').map((l) => l.trim()).filter(Boolean);
const stray = changed.filter((f) => !ALLOWED.some((re) => re.test(f)));
check('only evidence paths changed', stray.length === 0, stray.length ? stray.join(', ') : `${changed.length} files, all under docs/evidence/`);

// ── 3. whitespace / conflict markers ───────────────────────────────────────────────────────────
let diffCheckOk = true;
try { git('diff', '--check', `${parent}..${sha}`); } catch { diffCheckOk = false; }
check('git diff --check', diffCheckOk);
let showCheckOk = true;
try { git('show', '--check', sha); } catch { showCheckOk = false; }
check('git show --check', showCheckOk);

// ── 4. sidecar schema, receipt integrity, producer tripwire ────────────────────────────────────
const sidecars = changed.filter((f) => f.endsWith('.SIDECAR.md'));
check('at least one sidecar published', sidecars.length > 0, `${sidecars.length}`);

for (const rel of sidecars) {
  const abs = path.join(REPO, rel);
  const text = fs.readFileSync(abs, 'utf8');
  const missing = REQUIRED_FIELDS.filter((f) => !new RegExp(`\\|\\s*${f}\\s*\\|`, 'i').test(text));
  check(`sidecar schema: ${path.basename(rel)}`, missing.length === 0, missing.join(', '));

  const nameMatch = text.match(/\|\s*raw receipt\s*\|\s*`([^`]+)`/i);
  const shaMatch = text.match(/\|\s*raw receipt sha256\s*\|\s*`([0-9a-f]{64})`/i);
  const subjMatch = text.match(/\|\s*subject commit\s*\|\s*`([0-9a-f]{40})`/i);
  check(`sidecar names its raw receipt: ${path.basename(rel)}`, Boolean(nameMatch));
  check(`sidecar records a sha256: ${path.basename(rel)}`, Boolean(shaMatch));
  check(`sidecar names a subject commit: ${path.basename(rel)}`, Boolean(subjMatch));
  if (!nameMatch || !shaMatch) continue;

  const rawAbs = path.join(path.dirname(abs), nameMatch[1]);
  const rawRel = path.relative(REPO, rawAbs).split('\\').join('/');
  check(`raw receipt exists and is readable: ${nameMatch[1]}`, fs.existsSync(rawAbs));
  if (!fs.existsSync(rawAbs)) continue;

  let tracked = true;
  try { git('ls-files', '--error-unmatch', rawRel); } catch { tracked = false; }
  check(`raw receipt is tracked: ${nameMatch[1]}`, tracked);

  const bytes = fs.readFileSync(rawAbs);
  // ★ THE INTEGRITY CHECK. Recomputed from bytes on disk, not trusted from the sidecar's prose.
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  check(`raw receipt sha256 matches sidecar: ${nameMatch[1]}`, actual === shaMatch[1], `recomputed ${actual.slice(0, 16)} vs recorded ${shaMatch[1].slice(0, 16)}`);

  // Control bytes: a raw NUL or an ANSI escape means the capture was not passed through the
  // sanitising pipeline, so it is not the artifact the process claims to produce.
  check(`no raw NUL: ${nameMatch[1]}`, !bytes.includes(0));
  check(`no ANSI escapes: ${nameMatch[1]}`, !bytes.includes(0x1b));

  // Producer tripwire: a suite receipt must carry the VITEST_EXIT line, which only the real
  // capture pipeline emits. A hand-written or truncated file fails here.
  const raw = bytes.toString('utf8');
  check(`receipt carries VITEST_EXIT: ${nameMatch[1]}`, /^VITEST_EXIT=\d+$/m.test(raw));
}

for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  [${c.detail}]` : ''}`);
console.log('');
if (failures.length) {
  console.log(`PUBLICATION GATE FAILED (${failures.length}):`);
  for (const f of failures) console.log(`   ${f}`);
  process.exit(1);
}
console.log(`PUBLICATION GATE PASSED — ${sha.slice(0, 7)} is an evidence-publication descendant of ${parent.slice(0, 7)}`);
console.log('⚠ This is NOT a full-suite verdict for this commit. It certifies published evidence only.');

}
