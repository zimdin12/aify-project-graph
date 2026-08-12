#!/usr/bin/env node
// EQUIVALENCE ORACLE FOR A PURE-MOVE REFACTOR.
//
// A refactor slice claims one thing: THE OUTPUT DID NOT CHANGE. The test suite cannot
// establish that — it asserts the properties someone thought to assert, and a move can
// alter something nobody pinned. So a move needs its own instrument: capture every byte
// the generator produces BEFORE, capture again AFTER, diff.
//
// ⚠ DELIBERATELY NOT A COMMITTED SNAPSHOT TEST, and the reason is the lesson of this whole
// session. A stored golden file is a WORDING CONTRACT: it pins whatever the prose happens
// to say and goes red on every legitimate content change, so it trains its owner to
// regenerate it without reading the diff. That is how a false sentence gets defended by a
// green suite. This is a two-shot tool instead — capture, move code, compare, delete. It
// exists only for the duration of a slice and nothing outlives it.
//
//   node scripts/refactor-oracle.mjs capture <label>
//   node scripts/refactor-oracle.mjs compare <label>
//
// Exit 0 = byte-identical. Exit 1 = the move changed behaviour, with the first differing
// line shown.
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(repoRoot, '.aify-graph', '.refactor-oracle');

// The four artefacts generateBrief writes. All of them, because a move that changes only
// the JSON while the markdown is stable is exactly the kind of thing a partial check misses.
const ARTEFACTS = ['brief.json', 'brief.agent.md', 'brief.onboard.md', 'brief.plan.md'];

const [, , mode, label = 'default'] = process.argv;
if (!['capture', 'compare'].includes(mode)) {
  console.error('usage: refactor-oracle.mjs capture|compare <label>');
  process.exit(2);
}

const { generateBrief } = await import(pathToFileURL(join(repoRoot, 'mcp/stdio/brief/generator.js')).href);

// ⚠ The SUBJECT must be immutable, not "the biggest repo available". This originally ran
// against the working repo, where adding one file moved `"files": 486` to 487 — which the
// refactor itself would do, four times over.
//
// APG_ORACLE_REPO overrides it; the default is a committed fixture whose contents cannot
// drift between capture and compare.
const subject = process.env.APG_ORACLE_REPO
  ? join(process.cwd(), process.env.APG_ORACLE_REPO)
  : repoRoot;

if (!existsSync(join(subject, '.aify-graph'))) {
  console.error(`subject has no .aify-graph: ${subject}`);
  process.exit(2);
}

// ⚠⚠ AND POINTING AT THE FIXTURE IN PLACE WAS STILL NOT ENOUGH — third attempt.
//
// tests/fixtures/ lives INSIDE this git repo, so `recentActivity(repoRoot)` and the dirty
// count run git against the fixture path and get APG'S OWN history and working state back.
// Adding one unrelated file to the repo still moved the fixture's brief. Measured, not
// reasoned about: the exit code stayed 1 after the previous "fix".
//
// ⇒ The subject is COPIED to a scratch directory with its own git history, so nothing
// about the developer's working tree can reach it. That is what "immutable subject"
// actually requires.
// ⚠⚠⚠ FOURTH ATTEMPT, and the first three each failed a DIFFERENT control:
//   1. subject = this repo        → adding one file moved `"files": 486` (the refactor
//                                    itself adds four, so it would fail on its own job)
//   2. subject = fixture in place → tests/fixtures/ is inside this git repo, so the
//                                    fixture's git-derived fields tracked MY dirty tree
//   3. subject = copied per run   → the fresh temp path is embedded in brief.json as
//                                    `root`, so consecutive identical runs disagreed
//   4. and once those were fixed, a REAL code change went undetected — tiny-flecs is too
//      small to have four hubs, so the subject was immutable but not discriminating.
//
// ⇒ The subject is keyed to the LABEL and built ONCE at capture, then reused verbatim at
// compare. That makes it genuinely fixed across the pair, which in turn allows it to be
// this repo — large enough to exercise every branch. Immutability comes from reuse, not
// from picking something small.
//
// ★ Every one of those four was found by a control, not by reasoning. The "unchanged →
// exit 0" and "real change → exit 1" pair must BOTH run, every time: an oracle that cannot
// detect a change is worse than no oracle, because it manufactures confidence.
const scratch = join(tmpdir(), `apg-oracle-subject-${label}`);
if (mode === 'capture') {
  rmSync(scratch, { recursive: true, force: true });
  cpSync(subject, scratch, { recursive: true, filter: (s) => !s.includes(`${sep}node_modules`) && !s.includes(`${sep}.git${sep}`) && !s.endsWith(`${sep}.git`) });
  const git = (...a) => { try { execFileSync('git', ['-C', scratch, ...a], { stdio: 'ignore' }); } catch { /* best effort */ } };
  git('init', '-q');
  git('-c', 'user.email=oracle@test', '-c', 'user.name=oracle', 'add', '-A');
  git('-c', 'user.email=oracle@test', '-c', 'user.name=oracle', 'commit', '-qm', 'oracle subject');
} else if (!existsSync(scratch)) {
  console.error(`no subject for "${label}" — run capture first`);
  process.exit(2);
}

generateBrief({ repoRoot: scratch });

const read = (name) => {
  const p = join(scratch, '.aify-graph', name);
  return existsSync(p) ? readFileSync(p, 'utf8') : `<<MISSING: ${name}>>`;
};

// ⚠⚠ THE FIRST VERSION OF THIS ORACLE WAS UNUSABLE FOR ITS OWN PURPOSE, and I shipped a
// commit message claiming it had passed when it had just printed exit=1.
//
// Two things move without any code changing:
//   · the DATE — `GENERATED: 2026-08-11` became `2026-08-12` at midnight.
//   · the repo FILE COUNT — `"files": 486` became 487 when I added one script.
//
// ⇒ The second is fatal to the whole point. Splitting generator.js into four modules ADDS
// FILES, so the oracle would report a pure move as a behaviour change — the instrument
// would fail precisely on the operation it exists to check, and the natural response
// (regenerate the baseline) destroys its value entirely.
//
// ★ THE FIX IS NOT MORE NORMALISATION. Normalising the file count would blind it to a real
// regression in file counting, which is a thing generateBrief genuinely does. The fix is to
// hold the SUBJECT still: run against an immutable fixture repo, so the only thing that can
// vary between capture and compare is the generator code itself. Dates are still normalised
// because nothing can hold those still.
// ⚠ The scratch directory is freshly created each run, and its path is EMBEDDED in
// brief.json as `root`. Caught only by running capture→compare twice with no code change
// and getting exit 1 — which is why that control exists and why it runs first.
const normaliseSubject = (s) => s
  .split(scratch).join('<SUBJECT>')
  .split(scratch.replace(/\\/g, '\\\\')).join('<SUBJECT>') // JSON-escaped Windows form
  .split(scratch.replace(/\\/g, '/')).join('<SUBJECT>');

const normalise = (s) => normaliseSubject(s)
  .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ISO>')
  .replace(/\d{4}-\d{2}-\d{2}/g, '<DATE>')
  .replace(/\b[0-9a-f]{7,40}\b/g, '<SHA>')
  .replace(/\r\n/g, '\n');

const snapshot = Object.fromEntries(ARTEFACTS.map((a) => [a, normalise(read(a))]));
const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

if (mode === 'capture') {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${label}.json`), JSON.stringify(snapshot, null, 2));
  for (const a of ARTEFACTS) console.log(`  ${a.padEnd(18)} ${digest(snapshot[a])}  ${snapshot[a].length} chars`);
  console.log(`captured "${label}" — now move the code, then: node scripts/refactor-oracle.mjs compare ${label}`);
  process.exit(0);
}

const prevPath = join(OUT, `${label}.json`);
if (!existsSync(prevPath)) {
  console.error(`no capture named "${label}" — run capture BEFORE moving code`);
  process.exit(2);
}
const prev = JSON.parse(readFileSync(prevPath, 'utf8'));

let failed = false;
for (const a of ARTEFACTS) {
  const before = prev[a] ?? '<<ABSENT>>';
  const after = snapshot[a];
  if (before === after) {
    console.log(`  ✓ ${a.padEnd(18)} identical (${digest(after)})`);
    continue;
  }
  failed = true;
  const b = before.split('\n');
  const n = after.split('\n');
  const i = b.findIndex((line, idx) => line !== n[idx]);
  console.log(`  ✗ ${a.padEnd(18)} CHANGED — first difference at line ${i + 1}`);
  console.log(`      before: ${JSON.stringify((b[i] ?? '<eof>').slice(0, 110))}`);
  console.log(`      after:  ${JSON.stringify((n[i] ?? '<eof>').slice(0, 110))}`);
}

if (failed) {
  console.error('\n⛔ the move changed behaviour — a refactor slice must be a MOVE, not a rewrite');
  process.exit(1);
}
console.log('\n✓ byte-identical across the move');
