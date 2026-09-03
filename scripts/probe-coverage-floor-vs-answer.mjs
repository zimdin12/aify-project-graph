// DOES A LOW-COVERAGE SPINE REFUSE, OR DOES IT ANSWER?
//
// ef-manager, reviewing the absence surface, rejected the question I asked (which caveat to cut) and
// put a different one in its place. Quoted verbatim from their reply:
//
//   "LSP SCOPE at 73/627 = 11.6% is not a caveat, it is a CANNOT-ANSWER wearing an answer's
//    clothes. A refusal that shares a channel with a result gets read as a result."
//
// This repository has prior form for exactly that shape: a collection covering 0.6% of the repo
// silenced graph_health's only code-intel warning, recorded in collection-coverage-defect.
//
// ⛔ THE CLAIM UNDER TEST IS ABOUT TWO SURFACES DISAGREEING, NOT ABOUT WHAT AGENTS READ. Whether an
// agent is actually misled by a caveat is the expensive A/B and this probe cannot touch it. What it
// can settle mechanically is narrower and prior to it: on ONE repository state, at ONE instant, does
// `graph_health` deny absence authority while `graph_callers` returns an ANSWER for the same repo?
// If the two disagree, the floor question is live. If they agree, ef-manager's point does not apply
// to this code and I say so.
//
// PREREGISTERED, before the run:
//   POPULATION   this repository's real graph, as it stands. Symbols drawn from the real registry:
//                (a) symbols with NO incoming edge in EXECUTION_FAMILY — the verb's own relation set
//                (b) one symbol WITH such an edge, as the shape control
//   IDENTITY RULE  the surfaces DISAGREE when, in the same pass, graphCapabilities reports
//                `absenceAuthority: false` for a COVERAGE reason, and graph_callers returns an
//                ANSWER shape ("NO CALLERS") rather than a REFUSAL shape for a symbol in that repo.
//   FINDING SCHEMA {surface, verdict, reason, shape}
//   CLAIM CEILING  ⛔ a disagreement makes the coverage-floor question LIVE. It does not say what the
//                floor should be, does not measure agent behaviour, and does not establish that the
//                caveat is unread. One repo, one tree state, one verb.
//   CONTROLS (same pass)
//     AUTHORITY GRANT   graphCapabilities must be able to return TRUE on complete inputs — otherwise
//                       "false here" is a property of the function, not of this repository.
//     COVERAGE CAUSE    the denial must be for a COVERAGE reason. A denial for `not_indexed` or
//                       `legacy_unattested` would be a different defect wearing this one's clothes.
//     ANSWER SHAPE      graph_callers on a symbol that HAS callers must return a caller list. If it
//                       returns NO CALLERS there, the shape detector is broken and every absence
//                       below is an artifact.
//     REFUSAL DETECTABLE  graph_callers must produce a REFUSAL shape for at least one input. If no
//                       input refuses, the detector cannot tell refusal from answer, and "it never
//                       refuses" would be unfalsifiable rather than measured.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();
const say = (...a) => console.log(...a);

const { graphCapabilities } = await import('../mcp/stdio/query/graph-capabilities.mjs');
const { graphCallers } = await import('../mcp/stdio/query/verbs/callers.js');
const { graphHealth } = await import('../mcp/stdio/query/verbs/health.js');
const { openExistingDb } = await import('../mcp/stdio/storage/db.js');
const { EXECUTION_FAMILY } = await import('../mcp/stdio/storage/taxonomy.js');
const { spineCoverage } = await import('../mcp/stdio/query/lsp-evidence.js');

// ── CONTROL: can the authority flag ever be granted? ────────────────────────────────────────────
const completeInputs = {
  indexed: true, integrity: null, attestation: 'attested', collectionAvailable: true,
  compilerVerifiedEdges: 100, coverage: { complete: true }, collectionCurrent: true,
  languageHasServer: true,
};
const grant = graphCapabilities(completeInputs);
const partial = graphCapabilities({ ...completeInputs, coverage: { complete: false } });
say(`[${grant.absenceAuthority === true ? 'PASS' : 'FAIL'}] AUTHORITY GRANT CONTROL: complete inputs -> absenceAuthority=${grant.absenceAuthority}`);
say(`        partial coverage -> absenceAuthority=${partial.absenceAuthority} reason=${partial.reason}`);
say('');

// ── THE REAL REPOSITORY'S SPINE ─────────────────────────────────────────────────────────────────
const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
let cov = null;
let orphans = [];
let called = [];
try {
  cov = spineCoverage(db);
  const family = EXECUTION_FAMILY.map((r) => `'${r}'`).join(',');
  orphans = db.all(`
    SELECT n.label FROM nodes n
    WHERE n.type IN ('Function','Method') AND n.label != ''
      AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.to_id = n.id AND e.relation IN (${family}))
    ORDER BY n.label LIMIT 12
  `).map((r) => r.label);
  // The shape control's specimen comes from the same registry, selected on the OPPOSITE property.
  called = db.all(`
    SELECT n.label FROM nodes n
    WHERE n.type IN ('Function','Method') AND n.label != ''
      AND EXISTS (SELECT 1 FROM edges e WHERE e.to_id = n.id AND e.relation IN (${family}))
    ORDER BY n.label LIMIT 3
  `).map((r) => r.label);
} finally { db.close?.(); }

say(`spine coverage on this repository: ${JSON.stringify({
  language: cov?.language ?? null,
  files_processed: cov?.files_processed ?? null,
  files_eligible: cov?.files_eligible ?? null,
})}`);
const pct = (cov?.files_processed !== null && cov?.files_eligible)
  ? (cov.files_processed / cov.files_eligible) * 100 : null;
say(`  = ${pct === null ? 'unknown' : pct.toFixed(1) + '%'} of eligible files carry compiler-verified evidence`);
say('');

// ── SURFACE 1: what graph_health says about absence authority, on this repo ──────────────────────
const healthText = String(await graphHealth({ repoRoot }));
const authorityLine = healthText.split('\n').find((l) => /absenceAuthority/i.test(l)) ?? '(not reported)';
const reasonLine = healthText.split('\n').find((l) => /\breason\b/i.test(l)) ?? '(no reason line)';
const healthDenies = /absenceAuthority\W+false/i.test(healthText);
const COVERAGE_REASONS = ['collection_partial', 'no_collection', 'trust_spine_empty'];
const coverageCause = COVERAGE_REASONS.find((r) => healthText.includes(r)) ?? null;
say('--- SURFACE 1: graph_health');
say(`  ${authorityLine.trim()}`);
say(`  ${reasonLine.trim()}`);
say(`  [${healthDenies ? 'DENIES' : 'GRANTS'}] absence authority`);
say(`  [${coverageCause ? 'PASS' : 'FAIL'}] COVERAGE CAUSE CONTROL: denial reason is coverage-related (${coverageCause ?? 'none found'})`);
say('');

// ── SURFACE 2: what graph_callers does for the same repo, same instant ───────────────────────────
// ⛔ SHAPE BY WHAT CAME BACK, NEVER BY WHAT I SELECTED FOR. Selecting a symbol as callerless does not
// make its answer a NO CALLERS answer; measured in the firing-rate probe, only 21 of 40 were.
function shapeOf(text) {
  if (/NO CALLERS/.test(text)) return 'ANSWER:NO CALLERS';
  if (/NO MATCH/.test(text)) return 'ANSWER:NO MATCH';
  if (/AMBIGUOUS MATCH/.test(text)) return 'ANSWER:AMBIGUOUS';
  if (/INSUFFICIENT COVERAGE|CANNOT ANSWER|REFUS/i.test(text)) return 'REFUSAL';
  return 'ANSWER:RESULTS';
}

const shapes = new Map();
for (const symbol of orphans) {
  const s = shapeOf(String(await graphCallers({ repoRoot, symbol })));
  shapes.set(s, (shapes.get(s) ?? 0) + 1);
}
say('--- SURFACE 2: graph_callers on callerless symbols');
for (const [s, n] of shapes) say(`  ${String(n).padStart(3)} x ${s}`);

// CONTROL: a symbol that HAS callers must not come back as an absence.
let answerShapeOk = false;
let controlShape = '(none available)';
if (called.length > 0) {
  controlShape = shapeOf(String(await graphCallers({ repoRoot, symbol: called[0] })));
  answerShapeOk = controlShape === 'ANSWER:RESULTS';
}
say(`  [${answerShapeOk ? 'PASS' : 'FAIL'}] ANSWER SHAPE CONTROL: "${called[0] ?? '-'}" (has callers) -> ${controlShape}`);

// CONTROL: is a REFUSAL shape reachable at all? An empty directory has no index.
const empty = mkdtempSync(join(tmpdir(), 'apg-norepo-'));
let refusalReachable = false;
let refusalShape = '(threw)';
try {
  const out = String(await graphCallers({ repoRoot: empty, symbol: 'anything' }));
  refusalShape = shapeOf(out);
  refusalReachable = refusalShape === 'REFUSAL' || /not indexed|no graph|run graph_index/i.test(out);
} catch (e) {
  refusalShape = `threw: ${e.message.slice(0, 60)}`;
  refusalReachable = true; // a throw is a refusal the caller cannot mistake for a result
} finally { rmSync(empty, { recursive: true, force: true }); }
say(`  [${refusalReachable ? 'PASS' : 'FAIL'}] REFUSAL DETECTABLE CONTROL: unindexed repo -> ${refusalShape}`);
say('');

// ── VERDICT ─────────────────────────────────────────────────────────────────────────────────────
const controlsOk = grant.absenceAuthority === true && answerShapeOk && refusalReachable;
if (!controlsOk) {
  say('⛔ CONTROLS FAILED — conclude nothing about the two surfaces.');
  process.exit(2);
}
const answersDespiteDenial = healthDenies && Boolean(coverageCause)
  && [...shapes.keys()].some((s) => s.startsWith('ANSWER:'));
say(answersDespiteDenial
  ? 'VERDICT: ⚠ THE SURFACES DISAGREE. graph_health denies absence authority for a coverage reason,\n'
    + '  and graph_callers answers anyway for symbols in the same repository at the same instant.\n'
    + '  ⚠ That makes the coverage-floor question LIVE. It does not say where the floor is, and it\n'
    + '  does not measure whether any agent was misled — that is the A/B, not this.'
  : 'VERDICT: the surfaces agree on this repository state — ef-manager\'s point does not apply here.');
process.exitCode = 0;
