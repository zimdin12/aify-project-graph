// DOES THE RELEVANCE GATE FIRE ON SUBSTRINGS? — a defect check on code shipped hours earlier.
//
// `uncommittedMentionClause` decides relevance with `text.includes(name)`. That is a SUBSTRING test,
// so a symbol called `get` matches a file containing `budget`, `target`, `getter` or `widget`, and
// the clause then tells an agent the file "mentions get" when it does not.
//
// ⛔ THE CODEBASE ALREADY KNOWS THIS HAZARD AND SAYS SO IN ITS OWN TRUST LINE:
//   "resolves calls BY NAME, so a common name (has, get, writeFile) OVERCOUNTS with unrelated
//    same-named calls"  — lsp-evidence.js:158
// I wrote a name-matching gate the same day, in the same file family, and reproduced the exact
// failure the product warns its users about. Adjacent knowledge does not stop the defect it
// describes.
//
// PREREGISTERED, before the run:
//   POPULATION   real symbol labels drawn from THIS repository's own graph, capped and sorted for
//                determinism. Not invented names — the question is about names that actually exist.
//   IDENTITY RULE  a FALSE RELEVANCE is a (name, file) pair where `text.includes(name)` is true but
//                every occurrence of `name` is bounded on at least one side by an identifier
//                character [A-Za-z0-9_$] — i.e. it only ever appears INSIDE a longer identifier.
//   FINDING SCHEMA {name, file, sampleContext} for each false relevance.
//   CLAIM CEILING  a TEXTUAL measurement about substring vs identifier-boundary matching on this
//                  repo's symbol names. It is NOT a claim about how often agents query short names,
//                  and NOT a claim about any other repo.
//   CONTROLS (same pass)
//     POSITIVE  a genuine whole-identifier mention is matched by BOTH tests — else the strict test
//               is broken and every "false relevance" below is really a false alarm of my own.
//     NEGATIVE  a name absent from the text is matched by NEITHER — else both tests match anything.
//
// ABANDON RULE: if either control fails, report the instrument as broken and conclude nothing.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const say = (...a) => console.log(...a);

// The strict test the fix would use: an occurrence bounded by non-identifier characters on both
// sides. Written by index scan rather than regex so no symbol needs escaping — C++ names carry
// `::`, `~` and `operator<<`, which make a \b-based pattern wrong or unbuildable.
const IDENT = /[A-Za-z0-9_$]/;
function mentionsIdentifier(text, name) {
  if (!name) return false;
  let i = text.indexOf(name);
  while (i !== -1) {
    const before = i === 0 ? '' : text[i - 1];
    const after = text[i + name.length] ?? '';
    if (!IDENT.test(before) && !IDENT.test(after)) return true;
    i = text.indexOf(name, i + 1);
  }
  return false;
}

// ---- CONTROLS, before anything else -------------------------------------------------------
const posText = 'import { target } from "./base.js";\nexport function f() { return target(); }\n';
const posOk = posText.includes('target') && mentionsIdentifier(posText, 'target');
const negOk = !posText.includes('zzqAbsent') && !mentionsIdentifier(posText, 'zzqAbsent');
say(`[${posOk ? 'PASS' : 'FAIL'}] POSITIVE CONTROL: a real whole-identifier mention matches both tests`);
say(`[${negOk ? 'PASS' : 'FAIL'}] NEGATIVE CONTROL: an absent name matches neither`);
if (!posOk || !negOk) {
  say('⛔ CONTROLS FAILED — the instrument is broken. CONCLUDE NOTHING.');
  process.exit(2);
}

// ---- POPULATION: real symbol labels from this repo's own graph -----------------------------
const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
if (!existsSync(dbPath)) {
  say(`⛔ no graph at ${dbPath} — cannot draw a real population. CONCLUDE NOTHING.`);
  process.exit(2);
}
const { openExistingDb } = await import('../mcp/stdio/storage/db.js');
const db = openExistingDb(dbPath);
let names = [];
let files = [];
try {
  names = db.all(`
    SELECT DISTINCT label FROM nodes
    WHERE type IN ('Function','Method','Class') AND label != '' AND length(label) <= 12
    ORDER BY length(label), label LIMIT 200
  `).map((r) => r.label);
  files = db.all(`
    SELECT DISTINCT file_path FROM nodes
    WHERE type = 'File' AND file_path LIKE 'mcp/%' ORDER BY file_path LIMIT 60
  `).map((r) => r.file_path);
} finally { db.close?.(); }

say('');
say(`population: ${names.length} symbol labels (<=12 chars), ${files.length} real source files`);
if (names.length === 0 || files.length === 0) {
  say('⛔ empty population — CONCLUDE NOTHING.');
  process.exit(2);
}

// ---- MEASURE --------------------------------------------------------------------------------
const { mentionsIdentifier: productionMentions } = await import('../mcp/stdio/query/verbs/read_freshness.js');
let disagreements = 0;
const findings = [];
let loosePairs = 0;
let strictPairs = 0;
for (const file of files) {
  let text;
  try { text = readFileSync(join(repoRoot, file), 'utf8'); } catch { continue; }
  for (const name of names) {
    const loose = text.includes(name);
    if (!loose) continue;
    loosePairs += 1;
    const strict = mentionsIdentifier(text, name);
    // ⭐ CROSS-CHECK THE SHIPPED CODE AGAINST THIS PROBE'S OWN IMPLEMENTATION. They were written
    // separately, so agreement is real evidence rather than one reader consulting itself. If
    // production ever regresses to a substring test, `strict` stays correct here and the
    // disagreement count below goes non-zero instead of the finding silently reading as "fixed".
    if (productionMentions(text, name) !== strict) disagreements += 1;
    if (strict) { strictPairs += 1; continue; }
    const at = text.indexOf(name);
    const ctx = text.slice(Math.max(0, at - 18), at + name.length + 18).replace(/\s+/g, ' ');
    findings.push({ name, file, sampleContext: ctx });
  }
}

const falsePairs = findings.length;
const pct = loosePairs === 0 ? 0 : (falsePairs / loosePairs) * 100;
say('');
say(`(name,file) pairs where includes() says RELEVANT : ${loosePairs}`);
say(`  ...of those, a real identifier mention          : ${strictPairs}`);
say(`  ...of those, SUBSTRING ONLY (false relevance)   : ${falsePairs}  = ${pct.toFixed(1)}%`);
say('');
say(`SHIPPED-CODE CROSS-CHECK: ${disagreements} disagreement(s) with this probe's independent implementation  ${disagreements === 0 ? 'AGREE' : 'DIVERGED'}`);
say('');
say('sample false relevances (name — context it actually appeared in):');
for (const f of findings.slice(0, 12)) {
  say(`  ${JSON.stringify(f.name).padEnd(16)} ${f.file}`);
  say(`      ...${f.sampleContext}...`);
}
say('');
say(falsePairs > 0
  ? `⛔ VERDICT: the gate fires on substrings. ${falsePairs} of ${loosePairs} relevance decisions on this\n`
    + '   repo are names appearing only INSIDE longer identifiers — the clause would tell an agent a\n'
    + '   file mentions a symbol it does not contain.'
  : 'VERDICT: no substring-only matches found in this population — the hazard is not realised here.');
process.exitCode = falsePairs > 0 ? 1 : 0;
