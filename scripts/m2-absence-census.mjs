// Census of absence-shaped answers and whether they reach a scope producer.
// Preregistered at docs/evidence/m2-absence-census/PREREGISTRATION.md BEFORE this existed.
//
// ⛔ CLAIM CEILING. This reads SOURCE. It may say which absence paths REACH a scope producer.
// It may NOT say a producer emitted anything (reachability is not output — callers.js:93 records a
// scope note that threw on every call, whose catch returned '', inert while the output looked
// unchanged), and it may NOT say how often agents hit these paths.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'C:/Docker/aify-project-graph';
const VERBS_DIR = path.join(REPO, 'mcp/stdio/query/verbs');

// ── POPULATION: the REAL registry, never a hand-kept list ────────────────────────────────────
const schema = await import(pathToFileURL(path.join(REPO, 'mcp/stdio/tools/schema.js')).href);
const registry = schema.TOOLS ?? schema.default ?? schema.tools ?? null;
const toolNames = Array.isArray(registry) ? registry.map((t) => t.name)
  : registry && typeof registry === 'object' ? Object.keys(registry) : [];
// REGISTRY CONTROL: 0 means the read failed and every verdict below is void.
console.log(`registry tools read: ${toolNames.length}`);
if (toolNames.length === 0) { console.log('VOID: registry read failed'); process.exit(3); }

// ⚠ THE FIRST IDENTITY RULE UNDER-MATCHED. It required `NO <CAPS> for`, so impact.js — whose
// literal is `NO IMPACT — no edges found for ...`, an em-dash where the rule demanded `for` — was
// filed as having NO absence path while it reached TWO scope producers. A self-contradictory row.
const ABSENCE_RE = /NO [A-Z][A-Z ]+|NO MATCH|no match|not found|no edges found|no results/;
// ⛔ THIS LIST IS HAND-MAINTAINED AND IT DRIFTED WITHIN ONE SESSION. `spineCoverage` was added to
// graph_consequences as the structured `structural_coverage` field, and this census kept reporting
// that verb as NO_SCOPE — my own instrument under-reporting my own progress, which is the
// parallel-list defect in the tool built to catch that class. A producer added without touching
// this line is invisible here.
//
// ⚠ Not all producers answer the same question, and the FINDING must keep them apart:
//   EVIDENCE scope  — what the answer was computed FROM (the spine, its coverage, the compile DB)
//   NAME help       — noMatchMessage, "did you mean", which is not a scope statement at all
//   RELATION scope  — unsearchedRelationNote, which relations were never consulted
const EVIDENCE_SCOPE_PRODUCERS = ['buildAbsenceTrustLine', 'spineCoverage'];
const SCOPE_PRODUCERS = [...EVIDENCE_SCOPE_PRODUCERS, 'unsearchedRelationNote', 'noMatchMessage'];

const reachedProducers = (code) =>
  SCOPE_PRODUCERS.filter((p) => new RegExp(`\\b${p}\\s*\\(`).test(code));

const files = fs.readdirSync(VERBS_DIR).filter((f) => f.endsWith('.js')).sort();
const rows = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(VERBS_DIR, f), 'utf8');
  // Strip comments so a DISCUSSION of "NO CALLERS" is not counted as an emitted answer.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const literalAbsence = ABSENCE_RE.test(code);
  const reached = reachedProducers(code);
  // STRUCTURAL INVARIANT: a verb reaching an absence-scope producer HAS an absence path by
  // construction, whatever its wording. This is what the literal rule alone could not see.
  const absent = literalAbsence || reached.length > 0;
  rows.push({
    verb: f.replace(/\.js$/, ''),
    absence: absent,
    literalAbsence,
    scopeProducersReached: reached,
    verdict: !absent ? 'N_A_NO_ABSENCE_PATH' : (reached.length > 0 ? 'HAS_SCOPE' : 'NO_SCOPE'),
  });
}

const by = (v) => rows.filter((r) => r.verdict === v);
console.log(`\nfiles scanned: ${rows.length}`);
console.log(`HAS_SCOPE            : ${by('HAS_SCOPE').length}`);
console.log(`NO_SCOPE             : ${by('NO_SCOPE').length}`);
console.log(`N_A_NO_ABSENCE_PATH  : ${by('N_A_NO_ABSENCE_PATH').length}`);

// ── CONTROLS, same pass ──────────────────────────────────────────────────────────────────────
const callers = rows.find((r) => r.verb === 'callers');
console.log(`\nPOSITIVE CONTROL callers -> ${callers?.verdict} ${JSON.stringify(callers?.scopeProducersReached)}`);
if (callers?.verdict !== 'HAS_SCOPE') console.log('ABANDON: the census cannot see a scope producer I wired myself');
const naSample = by('N_A_NO_ABSENCE_PATH').slice(0, 3).map((r) => r.verb);
console.log(`NEGATIVE CONTROL no-absence verbs -> ${by('N_A_NO_ABSENCE_PATH').length} e.g. ${JSON.stringify(naSample)}`);

// IDENTITY-RULE MISSES: reached a producer but the literal rule did not fire. Printed rather than
// silently absorbed, so the rule gets improved instead of patched over.
const misses = rows.filter((r) => !r.literalAbsence && r.scopeProducersReached.length > 0);
console.log(`\nIDENTITY-RULE MISSES (producer reached, literal rule missed): ${misses.length}`);
for (const r of misses) console.log(`  ${r.verb.padEnd(20)} ${JSON.stringify(r.scopeProducersReached)}`);

console.log('\n=== NO_SCOPE (absence-shaped, no scope producer reached) ===');
for (const r of by('NO_SCOPE')) console.log(`  ${r.verb}`);
console.log('\n=== HAS_SCOPE ===');
for (const r of by('HAS_SCOPE')) console.log(`  ${r.verb.padEnd(24)} ${JSON.stringify(r.scopeProducersReached)}`);

// ⛔ THE NUMBER THAT GOVERNS M2 IS EVIDENCE SCOPE, NOT ANY SCOPE. Counting noMatchMessage as
// "has scope" would conflate name help with a statement about what the answer was computed from.
const evidence = rows.filter((r) => r.scopeProducersReached.some((p) => EVIDENCE_SCOPE_PRODUCERS.includes(p)));
console.log(`\n=== EVIDENCE SCOPE (the M2 number): ${evidence.length} of ${rows.filter((r) => r.absence).length} absence-shaped ===`);
for (const r of evidence) console.log(`  ${r.verb.padEnd(24)} ${JSON.stringify(r.scopeProducersReached)}`);

fs.writeFileSync(path.join(REPO, 'docs/evidence/m2-absence-census/census.json'),
  JSON.stringify({ registryTools: toolNames.length, filesScanned: rows.length, rows }, null, 1), 'utf8');
