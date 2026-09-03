// WHAT DOES A NO MATCH ACTUALLY WEIGH, ON A REAL REPO?
//
// Last cycle I added `INDEXED SCOPE: N files` to the empty-set absence and left NO MATCH OPEN,
// reasoning: "that message is ~96 bytes; the clause would be +78% of it". That 96 B came from a
// ONE-FILE FIXTURE, which is the best case and not the case anyone runs in.
//
// ⛔ AND THE HAZARD IS ALREADY ESTABLISHED FOR THIS SHAPE. This repo's own defect class is
// "'NO MATCH' / 'not found' read as a claim about the REPOSITORY". An agent asking whether a symbol
// exists gets a bare no, with nothing saying how much was searched. So the question is only cost —
// which means it has to be measured against a real answer, not a fixture's.
//
// PREREGISTERED, before the run:
//   POPULATION   this repository's own graph, 3 query shapes that all produce NO MATCH:
//                a nonsense name, a plausible-but-absent name, and a name that exists only in prose.
//   MEASURE      bytes of the real NO MATCH answer; bytes the clause would add; the ratio.
//   DECISION RULE, fixed now:
//     - FULL clause ("INDEXED SCOPE: N files — this absence is within that scope, not a statement
//       about the repository.") if it is < 25% of the real answer.
//     - else SHORT clause ("INDEXED SCOPE: N files.") if THAT is < 25%.
//     - else add nothing, and record the byte reason as the exclusion.
//     25% is chosen because the same clause is ~11% of the empty-set answer where it is already
//     accepted, and because the caveat this repo had to tear out was 79% of a NO MATCH.
//   CLAIM CEILING  a BYTE measurement on one repo. It says nothing about whether agents read it.
//   CONTROLS  positive: a symbol that EXISTS returns a non-absence answer, so the verb works and the
//             NO MATCHes below are genuine; and each measured answer must actually contain NO MATCH.
import { join } from 'node:path';

const repoRoot = process.cwd();
const say = (...a) => console.log(...a);

const FULL = ' INDEXED SCOPE: 881 files — this absence is within that scope,'
  + ' not a statement about the repository.';
const SHORT = ' INDEXED SCOPE: 881 files.';

const { graphCallers } = await import('../mcp/stdio/query/verbs/callers.js');

const control = String(await graphCallers({ repoRoot, symbol: 'buildTrustLine' }));
const controlOk = !/NO MATCH/.test(control) && control.length > 0;
say(`[${controlOk ? 'PASS' : 'FAIL'}] POSITIVE CONTROL: an existing symbol does NOT return NO MATCH`);
if (!controlOk) { say('⛔ CONTROL FAILED — conclude nothing.'); process.exit(2); }

const SHAPES = [
  ['nonsense name', 'zzqNoSuchSymbolAnywhere'],
  ['plausible but absent', 'buildTrustLineForEveryVerb'],
  ['exists only in prose', 'warningWall'],
];

say('');
say('shape                     answer B   full B   full %   short B   short %');
const rows = [];
for (const [label, symbol] of SHAPES) {
  const text = String(await graphCallers({ repoRoot, symbol }));
  if (!/NO MATCH/.test(text)) { say(`  ${label.padEnd(24)} SKIPPED — not a NO MATCH (${text.slice(0, 40)}...)`); continue; }
  const n = text.length;
  rows.push({ label, n });
  say(`  ${label.padEnd(24)}${String(n).padStart(6)}  ${String(FULL.length).padStart(7)}`
    + `  ${((FULL.length / (n + FULL.length)) * 100).toFixed(1).padStart(6)}%`
    + `  ${String(SHORT.length).padStart(7)}  ${((SHORT.length / (n + SHORT.length)) * 100).toFixed(1).padStart(6)}%`);
}

if (rows.length === 0) { say('⛔ no NO MATCH shape was produced — conclude nothing.'); process.exit(2); }

const worst = rows.reduce((a, b) => (a.n <= b.n ? a : b)); // smallest answer = worst ratio
const fullPct = (FULL.length / (worst.n + FULL.length)) * 100;
const shortPct = (SHORT.length / (worst.n + SHORT.length)) * 100;
say('');
say(`worst case is the SMALLEST answer (${worst.label}, ${worst.n} B):`);
say(`  full clause  ${fullPct.toFixed(1)}%   short clause  ${shortPct.toFixed(1)}%   (threshold 25%)`);
say('');
say(fullPct < 25
  ? 'VERDICT: add the FULL clause — it is under the preregistered budget even in the worst case.'
  : shortPct < 25
    ? 'VERDICT: add the SHORT clause; the full one exceeds the budget.'
    : 'VERDICT: add nothing to NO MATCH; both forms exceed the budget, and that is the exclusion reason.');
process.exitCode = 0;
