// WHAT DOES THE RELEVANCE SCAN ACTUALLY COST? — the number the cap of 25 was never checked against.
//
// `uncommittedMentionClause` reads every uncommitted source file and scans it for the queried
// name(s). Past `RELEVANCE_SCAN_CAP = 25` files it returns '' — silently. I chose 25 by intuition,
// citing the 592-untracked field report, and never measured what the scan costs.
//
// ⛔ WHY THE NUMBER DECIDES A CORRECTNESS QUESTION, NOT JUST A PERFORMANCE ONE. Silence at the cap
// is indistinguishable from "checked and found nothing", so the disclosure disables itself exactly
// when the tree is dirtiest — which is when an agent is most likely to hold an uncommitted caller.
// The two ways out are (a) emit a "not checked" note, which fires on every result of a busy repo and
// rebuilds the warning wall, or (b) raise the cap so exceeding it is genuinely exceptional. Only a
// cost number can choose between them.
//
// PREREGISTERED, before the run:
//   POPULATION   real source files from this repository, largest-first so the estimate is
//                pessimistic rather than flattering.
//   MEASURE      wall time to read + scan N files for a small name set, at N = 25/50/100/200/400.
//   DECISION RULE, fixed now:
//     - if 200 files cost < 50 ms  -> the cap at 25 is not justified by cost. Raise it, and give the
//       residual over-cap case a note (rare enough not to be noise).
//     - if 200 files cost >= 50 ms -> the cap is doing real work. Keep it low and disclose at it.
//   CLAIM CEILING  one repo, warm OS file cache, one platform. A cold cache or a network filesystem
//                  would be slower and this does not measure that.
//   CONTROLS (same pass)
//     TIMER  a known ~50 ms busy loop must measure as roughly 50 ms — else every small number below
//            is unreadable.
//     ZERO   scanning an empty file list must cost ~0 — else the harness overhead dominates.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const say = (...a) => console.log(...a);

const { mentionsIdentifier } = await import('../mcp/stdio/query/verbs/read_freshness.js');

// ---- CONTROLS ------------------------------------------------------------------------------
const spinStart = performance.now();
const until = Date.now() + 50;
while (Date.now() < until) { /* deliberate busy loop */ }
const spinMs = performance.now() - spinStart;
const timerOk = spinMs >= 40 && spinMs <= 90;
say(`[${timerOk ? 'PASS' : 'FAIL'}] TIMER control: a ~50 ms busy loop measured ${spinMs.toFixed(1)} ms`);

const zeroStart = performance.now();
for (const _f of []) { /* nothing */ }
const zeroMs = performance.now() - zeroStart;
const zeroOk = zeroMs < 1;
say(`[${zeroOk ? 'PASS' : 'FAIL'}] ZERO control: scanning no files cost ${zeroMs.toFixed(3)} ms`);
if (!timerOk || !zeroOk) {
  say('⛔ CONTROLS FAILED — conclude nothing.');
  process.exit(2);
}

// ---- POPULATION ----------------------------------------------------------------------------
const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
if (!existsSync(dbPath)) { say('⛔ no graph — conclude nothing.'); process.exit(2); }
const { openExistingDb } = await import('../mcp/stdio/storage/db.js');
const db = openExistingDb(dbPath);
let candidates = [];
try {
  candidates = db.all(`
    SELECT DISTINCT file_path FROM nodes
    WHERE type = 'File' AND file_path != '' AND language != ''
  `).map((r) => r.file_path);
} finally { db.close?.(); }

// Largest-first: a pessimistic estimate beats a flattering one.
const withSize = [];
for (const f of candidates) {
  try { withSize.push({ f, size: statSync(join(repoRoot, f)).size }); } catch { /* gone */ }
}
withSize.sort((a, b) => b.size - a.size);
const files = withSize.map((x) => x.f);
const totalBytes = withSize.reduce((n, x) => n + x.size, 0);
say('');
say(`population: ${files.length} real source files, largest first `
  + `(largest ${(withSize[0]?.size / 1024).toFixed(0)} KB, total ${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);

const NAMES = ['target', 'buildTrustLine', 'ensureFresh'];

function scan(n) {
  const slice = files.slice(0, n);
  const t0 = performance.now();
  let hits = 0;
  for (const f of slice) {
    let text;
    try { text = readFileSync(join(repoRoot, f), 'utf8'); } catch { continue; }
    if (NAMES.some((name) => mentionsIdentifier(text, name))) hits += 1;
  }
  return { ms: performance.now() - t0, n: slice.length, hits };
}

say('');
say('  N files    wall      per file   hits');
const rows = [];
for (const n of [25, 50, 100, 200, 400]) {
  scan(Math.min(n, files.length));            // warm, so this measures scanning not first-read I/O
  const r = scan(Math.min(n, files.length));
  rows.push(r);
  say(`  ${String(r.n).padStart(7)}  ${r.ms.toFixed(1).padStart(7)} ms  `
    + `${(r.ms / Math.max(1, r.n)).toFixed(3).padStart(7)} ms   ${r.hits}`);
}

const at200 = rows.find((r) => r.n >= 200) ?? rows[rows.length - 1];
say('');
say(`DECISION INPUT: ${at200.n} files cost ${at200.ms.toFixed(1)} ms (preregistered threshold: 50 ms)`);
say(at200.ms < 50
  ? 'VERDICT: the cap at 25 is NOT justified by cost. Raise it, and disclose at the new one.'
  : 'VERDICT: the cap is doing real work. Keep it low and disclose when it is exceeded.');
process.exitCode = 0;
