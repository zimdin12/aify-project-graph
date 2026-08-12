#!/usr/bin/env node
// MUTATE YOUR OWN WORK BEFORE THE REVIEWER DOES.
//
// Every substantive finding against this repo in the last two days came from someone
// changing production and observing that the tests stayed GREEN. Nothing about writing a
// test tells you whether it can fail; only breaking the thing it guards does. This turns
// that loop into something runnable instead of something remembered.
//
//   node scripts/self-review.mjs <spec.json>
//
// The spec is a list of mutations, each naming the file, an anchor to replace, its
// replacement, and the test files that SHOULD go red:
//
//   [{ "name": "drop a claim from the route",
//      "file": "mcp/stdio/stale-warning-claims.js",
//      "from": "CLAIM.VERIFY_BY_STARTED_AT, ",
//      "to": "",
//      "tests": ["tests/unit/query/stale-warning-claim-schema.test.js"] }]
//
// ⇒ SURVIVED means the mutation did not break any test — the guarantee you believed you
// had does not exist. That is a finding, and it is the whole output of this tool.
//
// ★★ THREE CARRIER RULES, each of which I violated today at real cost:
//
//  1. RESTORE FROM AN IMMUTABLE OBJECT. Not a working-tree copy — a git blob. I restored
//     from a scratch backup taken AFTER a mutation, shipped the mutation, and the
//     contaminated tree reported GREEN because the contaminant also satisfied the
//     exemption that hid it.
//  2. ASSERT THE MUTATION APPLIED. A replacement whose anchor has drifted silently does
//     nothing, and "no test failed" then means "nothing was tested". Twice today a
//     no-op mutation read as a surviving one.
//  3. VERIFY THE RESTORE BY HASH before running anything else. A partial restore is a
//     second contaminated carrier, and the next result is about a tree nobody has seen.
//
// ⚠ Requires a CLEAN working tree for the files it touches: it restores from HEAD, so
// uncommitted edits to those files would be destroyed. It refuses to run otherwise —
// I have lost work to exactly that three times.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = process.argv[2];
if (!specPath) {
  console.error('usage: self-review.mjs <spec.json>');
  process.exit(2);
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const files = [...new Set(spec.map((m) => m.file))];

// RULE 1 — the pristine copy comes from git, not from the working tree.
const pristine = new Map();
for (const f of files) {
  try {
    pristine.set(f, execFileSync('git', ['show', `HEAD:${f}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch {
    console.error(`⛔ ${f} is not committed at HEAD — nothing immutable to restore from`);
    process.exit(2);
  }
}

// Refuse to run against uncommitted edits in the target files.
const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: REPO, encoding: 'utf8' })
  .split('\n').map((l) => l.trim()).filter(Boolean);
if (dirty.length) {
  console.error('⛔ uncommitted changes in target files — commit or stash first, or this tool will destroy them:');
  for (const d of dirty) console.error(`   ${d}`);
  process.exit(2);
}

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const baseline = new Map([...pristine].map(([f, s]) => [f, hash(s)]));

// RULE 3 — restore, then PROVE the restore.
function restoreAndVerify() {
  for (const [f, content] of pristine) writeFileSync(join(REPO, f), content);
  for (const [f, h] of baseline) {
    const now = hash(readFileSync(join(REPO, f), 'utf8'));
    if (now !== h) {
      console.error(`⛔ RESTORE FAILED for ${f} (${now} != ${h}) — refusing to continue`);
      process.exit(3);
    }
  }
}

function redCount(tests) {
  try {
    execFileSync('npx', ['vitest', 'run', ...tests], { cwd: REPO, encoding: 'utf8', shell: true, stdio: 'pipe' });
    return 0;
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    return out.split('\n').filter((l) => /^\s+×/.test(l)).length || 1;
  }
}

let survived = 0;
console.log(`self-review: ${spec.length} mutation(s)\n`);
for (const m of spec) {
  restoreAndVerify();
  const before = readFileSync(join(REPO, m.file), 'utf8');
  const after = before.replace(m.from, m.to);
  // RULE 2 — a mutation that did not apply is not a surviving mutation.
  if (after === before) {
    console.log(`  ${String(m.name).padEnd(54)} ⛔ NOT-APPLIED (anchor missing — fix the spec)`);
    survived += 1;
    continue;
  }
  writeFileSync(join(REPO, m.file), after);
  const reds = redCount(m.tests);
  if (reds > 0) {
    console.log(`  ${String(m.name).padEnd(54)} RED (${reds})`);
  } else {
    console.log(`  ${String(m.name).padEnd(54)} ⚠ SURVIVED — the guarantee does not exist`);
    survived += 1;
  }
}
restoreAndVerify();

console.log(`\nrestore verified against HEAD blobs.`);
if (survived > 0) {
  console.error(`⛔ ${survived} mutation(s) survived or failed to apply — those are findings.`);
  process.exit(1);
}
console.log('✓ every mutation was caught.');
