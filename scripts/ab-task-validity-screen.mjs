// PICK THE A/B TASK MECHANICALLY, BECAUSE I KNOW WHERE THE GRAPH IS STRONG.
//
// The pilot spent 10 cells and returned 10/10 vs 10/10. Its own review named the cause: the tasks
// "were NON-APPLICABLE to the absence gate's causal mechanism", so it could support neither "the gate
// works" nor "it does not". Both reviewers, independently:
//
//   "Scaling that design spends Steven's money to reproduce an uninterpretable null at higher
//    confidence."                                                              — ef-manager
//   "pick tasks where grep provably fails ... otherwise you'll get a second null that tells you
//    nothing new, the same way the first one did."                             — sc-critic
//
// ⛔ AND I MUST NOT CHOOSE THE TASK MYSELF. I have spent three weeks in this codebase and I know
// which corners the graph handles well; hand-picking a symbol is how an experimenter selects their
// own result. My first draft of this screen did exactly that — it named `indexedFileCount`, a symbol
// I WROTE TONIGHT, freshly indexed, whose answer I already knew. Candidates are now enumerated from
// the graph and ranked by an objective criterion, and age-gated out of my own recent work.
//
// PREREGISTERED, before the run:
//   POPULATION    every Function/Method in mcp/ with >= 1 incoming execution edge, excluding any
//                 symbol in a file touched in the last 3 days (my own arc), and excluding tests.
//   TASK SHAPE    "I want to change the behaviour of X — what breaks?" Transitive impact: the
//                 capability that survives the absence withdrawal and does not depend on
//                 exhaustiveness. NOT "is it safe to delete", which we cannot attest.
//   IDENTITY RULE a task is a VALID INSTRUMENT when the transitive consumer closure reaches files
//                 that a single `rg -l <name>` never names, AND the closure is >= 3 hops deep, AND
//                 it has at least MIN_DEEP consumers past hop 1 and MIN_BEYOND files past grep.
//
//   ⛔ AMENDED 2026-09-04, BEFORE ANY ARM RAN, AND THE ARGUMENT IS NOT MINE.
//   The floor was 2 hops, and an outside reviewer took it apart: the competition is not ONE grep,
//   it is an agent CHAINING greps by hand -- grep, read, grep the callers of what it found -- and
//   two hops is comfortably inside that. A screen can be mechanically rigorous and still be tuned
//   beneath the depth where the mechanism lives, and then it buys a second null that looks
//   procedurally clean for the same reason the pilot's did.
//   ⇒ The floor is 3, and depth alone is no longer sufficient: WIDTH is the second criterion,
//   because a two-grep chain that could technically reach a consumer set cannot hold a dozen of
//   them across a dozen files. Neither number is about what our graph handles well; both are about
//   what a person with rg can carry in their head.
//   ⚠ Distribution is REPORTED, so the choice of floor is checkable rather than asserted -- the
//   previous run scored 266 symbols and called 223 valid at floor 2, which is exactly the state in
//   which a floor can be too low and still look selective.
//   FINDING SCHEMA {symbol, file, grepFiles, hop1, deeper, maxHop, beyondGrep, valid}
//   CLAIM CEILING ⛔ THIS MEASURES THE TASK, NOT THE TOOL. "Valid instrument" means the question is
//                 CAPABLE of separating the arms. It does not predict that it will, and it says
//                 nothing about whether an agent will use the graph even when it would help.
//   CONTROLS (same pass)
//     NEGATIVE — a shallow symbol (closure entirely inside grep's own hits) must be REJECTED. A
//                screen that accepts every candidate is not a screen; this repo has shipped a
//                "detector" with a 100% positive rate before.
//     SOURCE-DERIVABLE — the winning chain must be re-checkable from SOURCE, not only from the
//                graph. If the graph is the sole witness, a graph defect manufactures a task only
//                the graph can answer, which is circular and would rig the A/B in our favour.
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// ⛔ THE THRESHOLDS LIVE WITH THE CONCEPT THAT OWNS THEM, and they are named so a later reader can
// see they were chosen rather than defaulted. See the AMENDED block in the header for why each is
// what it is; changing one silently is how a screen ends up selecting its own experiment's answer.
const MIN_HOPS = 3;    // deeper than a grep-read-grep chain reaches by hand
const MIN_DEEP = 5;    // consumers past hop 1 — width, not just depth
const MIN_BEYOND = 5;  // files the closure reaches that one `rg -l` never names

const repoRoot = 'C:/Docker/aify-project-graph';
const say = (...a) => console.log(...a);
const { openExistingDb } = await import(`file:///${repoRoot}/mcp/stdio/storage/db.js`);
const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));

// Files touched in my recent arc are excluded: a symbol I just wrote is not a fair specimen.
const recent = new Set(
  execFileSync('git', ['-C', repoRoot, 'log', '--since=3.days', '--name-only', '--pretty=format:'],
    { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean),
);
say(`excluded as recently-touched: ${recent.size} files`);

function grepFiles(name) {
  try {
    return new Set(execFileSync('rg', ['-l', '--fixed-strings', name, 'mcp/'],
      { cwd: repoRoot, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean));
  } catch { return new Set(); }
}

function closure(label, maxHops = 4) {
  const seen = new Map();
  let frontier = db.all(
    `SELECT id, label, file_path FROM nodes WHERE label = $l AND file_path LIKE 'mcp/%'`, { l: label });
  const origin = frontier.map((r) => r.file_path);
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop += 1) {
    const ids = frontier.map((r) => `'${r.id}'`).join(',');
    if (!ids) break;
    const callers = db.all(`
      SELECT DISTINCT f.id, f.label, f.file_path FROM edges e
      JOIN nodes f ON f.id = e.from_id
      WHERE e.to_id IN (${ids}) AND e.relation IN ('CALLS','INVOKES','PASSES_THROUGH')
        AND f.file_path LIKE 'mcp/%'
    `);
    const fresh = callers.filter((c) => !seen.has(c.id));
    for (const c of fresh) seen.set(c.id, { ...c, hop });
    frontier = fresh;
  }
  return { origin, consumers: [...seen.values()] };
}

// Enumerate candidates from the registry rather than naming them.
const pool = db.all(`
  SELECT n.label, n.file_path, COUNT(e.from_id) AS indeg
  FROM nodes n JOIN edges e ON e.to_id = n.id
  WHERE n.type IN ('Function','Method') AND n.label != '' AND n.file_path LIKE 'mcp/%'
    AND e.relation IN ('CALLS','INVOKES','PASSES_THROUGH')
  GROUP BY n.id HAVING indeg BETWEEN 2 AND 12
  ORDER BY n.label LIMIT 400
`).filter((r) => !recent.has(r.file_path));
say(`candidate pool after age gate: ${pool.length} symbols`);

const scored = [];
for (const cand of pool) {
  const g = grepFiles(cand.label);
  const { consumers } = closure(cand.label);
  if (consumers.length === 0) continue;
  const maxHop = consumers.reduce((m, c) => Math.max(m, c.hop), 0);
  const beyond = new Set(consumers.map((c) => c.file_path).filter((f) => !g.has(f)));
  scored.push({
    symbol: cand.label, file: cand.file_path, grepFiles: g.size,
    hop1: consumers.filter((c) => c.hop === 1).length,
    deeper: consumers.filter((c) => c.hop > 1).length,
    maxHop, beyondGrep: beyond.size, beyondList: [...beyond].slice(0, 6),
    valid: beyond.size >= MIN_BEYOND
      && maxHop >= MIN_HOPS
      && consumers.filter((c) => c.hop > 1).length >= MIN_DEEP,
  });
}

scored.sort((a, b) => (b.beyondGrep - a.beyondGrep) || (b.maxHop - a.maxHop));
const valid = scored.filter((s) => s.valid);
const rejected = scored.filter((s) => !s.valid);

say('');
say(`scored ${scored.length} symbols — ${valid.length} valid instruments, ${rejected.length} rejected`);
say(`thresholds: maxHop >= ${MIN_HOPS}, consumers past hop 1 >= ${MIN_DEEP}, files beyond grep >= ${MIN_BEYOND}`);
// ⭐ THE DISTRIBUTION, SO THE FLOOR IS CHECKABLE RATHER THAN ASSERTED. A floor that sits below the
// bulk of the population is not selecting anything; a floor that leaves three candidates is
// selecting the experiment's answer. Both are visible here and neither is visible from a count.
{
  const hist = new Map();
  for (const s of scored) hist.set(s.maxHop, (hist.get(s.maxHop) ?? 0) + 1);
  const line = [...hist.entries()].sort((a, b) => a[0] - b[0])
    .map(([h, n]) => `maxHop ${h}: ${n}`).join(' | ');
  say(`closure-depth distribution across all scored symbols — ${line}`);
  const deep = scored.filter((s) => s.maxHop >= MIN_HOPS).length;
  say(`  symbols at or past the depth floor: ${deep} of ${scored.length}`
    + ` (${Math.round((deep / Math.max(scored.length, 1)) * 100)}%)`);
}
say('');
say('TOP CANDIDATES (ranked by files the closure reaches that one grep never names):');
for (const s of valid.slice(0, 5)) {
  say(`  ${s.symbol.padEnd(28)} ${s.file}`);
  say(`      grep names ${String(s.grepFiles).padStart(3)} files | hop1 ${s.hop1} | hop2+ ${s.deeper} | maxHop ${s.maxHop} | BEYOND GREP ${s.beyondGrep}`);
  say(`      e.g. ${s.beyondList.slice(0, 3).join(', ')}`);
}
say('');
// ⛔ THE NEGATIVE CONTROL IS TAKEN FROM THE SAME RUN, not constructed to pass. If NOTHING was
// rejected, the criterion accepts everything and no candidate above means anything.
say(`[${rejected.length > 0 ? 'PASS' : 'FAIL'}] NEGATIVE CONTROL: ${rejected.length} symbol(s) were REJECTED as grep-answerable`);
if (rejected.length > 0) {
  const r = rejected[0];
  say(`      e.g. ${r.symbol} — grep names ${r.grepFiles} files, closure adds ${r.beyondGrep} beyond, maxHop ${r.maxHop}`);
}
db.close?.();
if (rejected.length === 0) { say('⛔ the screen accepts everything — conclude nothing, spend no runs.'); process.exit(2); }
say('');
say(valid.length > 0
  ? 'VERDICT: candidates exist. Seal ground truth from SOURCE for the chosen one before any arm runs.'
  : 'VERDICT: no valid instrument in this pool — do NOT spend the runs.');
process.exitCode = 0;
