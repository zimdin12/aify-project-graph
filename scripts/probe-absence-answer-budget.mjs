// HAVE I REBUILT THE WARNING WALL, ONE JUSTIFIED CLAUSE AT A TIME?
//
// Across this session I added, to the absence answer: MAY BE INCOMPLETE (uncommitted mention),
// NOT MODELLED for JS/TS/Python, INDEXED SCOPE. Each was justified by its OWN byte measurement
// against its OWN local threshold. None of them measured the TOTAL.
//
// ⛔ THAT IS THE FAILURE MODE, NOT A HYPOTHETICAL. This repo tore out a 445-byte warning wall and
// recorded the lesson: "a caveat everyone skims protects nobody". A wall is not built by one reckless
// paragraph — it is built by a series of individually defensible additions, each measured against
// the answer as it stood BEFORE the previous one landed.
//
// PREREGISTERED, before the run:
//   POPULATION   the two absence shapes on THIS repository's real graph, which carries the most
//                clauses: NO CALLERS (empty set) and NO MATCH.
//   MEASURE      total bytes; bytes of the ANSWER (the first line, what was asked) vs the CAVEAT
//                remainder; and each named clause's share.
//   IDENTITY RULE  a clause is present when its distinctive label appears; the decomposition is
//                only reported for labels actually found, never assumed.
//   THRESHOLD, fixed now: the caveat remainder exceeding **445 B** means the wall is rebuilt, using
//                the repo's own recorded number for "too much". A second, softer line: caveats
//                exceeding 80% of the whole answer means the answer is mostly apology.
//   CLAIM CEILING  a BYTE measurement on one repo, one dirty state. It does not measure whether an
//                agent reads or acts on any of it.
//   CONTROLS   positive: a symbol WITH callers returns them (the graph is real, so the absences are
//              genuine); and every clause the decomposition names must be found, or the breakdown
//              is reported as incomplete rather than silently short.
import { join } from 'node:path';

const repoRoot = process.cwd();
const say = (...a) => console.log(...a);

const { graphCallers } = await import('../mcp/stdio/query/verbs/callers.js');

const control = String(await graphCallers({ repoRoot, symbol: 'buildTrustLine' }));
const controlOk = !/NO CALLERS|NO MATCH/.test(control);
say(`[${controlOk ? 'PASS' : 'FAIL'}] POSITIVE CONTROL: a symbol with callers returns them`);
if (!controlOk) { say('⛔ CONTROL FAILED — conclude nothing.'); process.exit(2); }

// Labels in the order they render. Each is looked for; a missing one is reported, not assumed.
const LABELS = [
  ['TRUST:', 'trust banner'],
  ['INDEXED SCOPE:', 'indexed scope        (added this session)'],
  ['SCOPE:', 'code-intel scope'],
  ['NOT MODELLED:', 'not modelled         (extended this session)'],
  ['MAY BE INCOMPLETE:', 'uncommitted mention  (added this session)'],
  ['NOT COVERED:', 'uncommitted absence  (added this session)'],
  ['NOT CHECKED:', 'scan not run         (added this session)'],
];

function decompose(text) {
  // ⛔ THE ANSWER RUNS UP TO THE FIRST LABELLED CAVEAT, NOT TO THE FIRST FULL STOP.
  //
  // My first version cut at the first sentence, which put `Try graph_search(...)` — the actionable
  // remedy — on the CAVEAT side and produced an "89% caveat" figure that was an artifact of the
  // split. A remedy that can change the answer is the useful half, not apology. Getting this
  // boundary wrong makes the whole audit read alarmingly and wrongly.
  const labelPositions = LABELS
    .map(([label]) => text.indexOf(label))
    .filter((i) => i !== -1);
  const answerEnd = labelPositions.length ? Math.min(...labelPositions) : text.length;
  const answer = text.slice(0, answerEnd);
  // ⛔ LONGEST LABEL FIRST, WITH MASKING. `indexOf('SCOPE:')` matches the SCOPE: *inside*
  // "INDEXED SCOPE:", which reported the latter as 8 bytes wide. That is the same substring-vs-
  // boundary defect I fixed in the production relevance gate two cycles ago, reproduced here in my
  // own instrument — so the first run of this probe produced a decomposition that was simply wrong.
  const found = [];
  let mask = text;
  for (const [label, name] of [...LABELS].sort((a, b) => b[0].length - a[0].length)) {
    const at = mask.indexOf(label);
    if (at === -1) continue;
    found.push({ label, name, at });
    mask = mask.slice(0, at) + '\u0000'.repeat(label.length) + mask.slice(at + label.length);
  }
  found.sort((a, b) => a.at - b.at);
  for (let i = 0; i < found.length; i += 1) {
    const end = i + 1 < found.length ? found[i + 1].at : text.length;
    found[i].bytes = end - found[i].at;
  }
  return { answer, caveats: text.length - answer.length, found, total: text.length };
}

// ⛔ A REAL NO-CALLERS SYMBOL, DRAWN FROM THE GRAPH. My first version used an invented name, which
// does not exist — so it returned NO MATCH and I measured that shape TWICE while labelling one of
// them NO CALLERS. The identity of the shape has to be read from the answer, not assumed.
const { openExistingDb } = await import('../mcp/stdio/storage/db.js');
const db0 = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
let orphan = null;
try {
  orphan = db0.get(`
    SELECT n.label FROM nodes n
    WHERE n.type = 'Function' AND n.label != ''
      AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.to_id = n.id)
    ORDER BY n.label LIMIT 1
  `)?.label ?? null;
} finally { db0.close?.(); }
if (!orphan) { say('⛔ no callerless symbol found in the graph — conclude nothing.'); process.exit(2); }
say(`(no-callers specimen drawn from the graph: ${orphan})`);

const SHAPES = [
  ['NO CALLERS (empty set)', orphan],
  ['NO MATCH   (unknown)  ', 'zzqNoSuchSymbolAnywhere'],
];

let worstCaveats = 0;
let worstPct = 0;
for (const [shape, symbol] of SHAPES) {
  const text = String(await graphCallers({ repoRoot, symbol }));
  const d = decompose(text);
  const pct = (d.caveats / d.total) * 100;
  worstCaveats = Math.max(worstCaveats, d.caveats);
  worstPct = Math.max(worstPct, pct);
  say('');
  say(`=== ${shape}   total ${d.total} B`);
  say(`    answer  ${String(d.answer.length).padStart(5)} B`);
  say(`    caveats ${String(d.caveats).padStart(5)} B  = ${pct.toFixed(1)}% of the answer`);
  for (const f of d.found) {
    say(`      ${f.label.padEnd(20)} ${String(f.bytes).padStart(4)} B   ${f.name}`);
  }
  if (d.found.length === 0) say('      (no labelled clause found — decomposition INCOMPLETE)');
  const accounted = d.found.reduce((n, f) => n + f.bytes, 0);
  const unaccounted = d.caveats - accounted;
  if (unaccounted > 8) say(`      (${unaccounted} B of caveat unaccounted for — decomposition INCOMPLETE)`);
  say('    RAW:');
  say('    ' + text.replace(/\n/g, '\n    '));
}

say('');
say(`worst caveat remainder: ${worstCaveats} B   (threshold 445 B — the wall this repo tore out)`);
say(`worst caveat share:     ${worstPct.toFixed(1)}%  (soft line 80%)`);
say('');
if (worstCaveats > 445) {
  say('⛔ VERDICT: THE WALL IS REBUILT. The caveat remainder now exceeds the size of the prose this');
  say('   project already removed once, assembled from individually-justified additions.');
  process.exitCode = 1;
} else if (worstPct > 80) {
  say('⚠ VERDICT: under the byte threshold but the answer is mostly caveat — the softer line trips.');
  process.exitCode = 1;
} else {
  say('VERDICT: within both lines. Recorded so the next addition is measured against THIS total.');
  process.exitCode = 0;
}
