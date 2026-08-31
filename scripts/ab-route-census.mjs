// ROUTE CENSUS — which verbs actually change their answer when the graph is torn?
//
// ⛔ THIS RUNS BEFORE ANY AGENT RUN IS SPENT, AND IT CAN CANCEL THE EXPERIMENT.
//
// Review's precondition: "A mutation at health is irrelevant if the agent acts through preflight
// and never reads health." The publication gate can only be *estimated* on routes whose output
// actually differs between a healthy and a torn graph. Every other verb is a route where a null
// result means nothing — not "attestation did not help", just "attestation was never consulted".
//
// So this measures, mechanically and with no agent involved:
//
//   for each verb:  output(healthy)  vs  output(torn)   -> DIFFERS or IDENTICAL
//
// A verb that is IDENTICAL under tearing cannot carry the mechanism. If an agent naturally routes
// there, the correct score is NOT REACHED, and attestation is neither credited nor blamed.
//
// ⚠ EVERY ARM GETS ITS OWN DISPOSABLE COPY. The live .aify-graph is never opened, never torn, and
// never read here — a shared graph would let one arm's rebuild change another arm's bytes.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Docker/aify-project-graph';
const CORPUS = join(ROOT, 'tests', 'fixtures', 'linkage-scope', 'corpus');

/** Build a real indexed repo from the neutral corpus. Returns its path. */
async function buildFixtureRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'apg-census-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  for (const f of ['weights.cpp', 'pipeline.cpp', 'bundle.cpp', 'normalize.h', 'normalize.cpp',
    'stage.cpp', 'gain.cpp']) {
    copyFileSync(join(CORPUS, f), join(repo, 'src', f));
  }
  // A JS file too: the graph's strongest extractors are JS/TS, and a C++-only corpus with no
  // compile DB would make every verb degrade for reasons unrelated to tearing.
  writeFileSync(join(repo, 'src', 'entry.js'),
    'export function normalizeInput(x) { return x - 1; }\n'
    + 'export function runNormalize() { return normalizeInput(9); }\n');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'corpus');
  const { ensureFresh } = await import(`file:///${ROOT}/mcp/stdio/freshness/orchestrator.js`);
  await ensureFresh({ repoRoot: repo });
  return repo;
}

/**
 * Tear a graph deterministically: bind DB generation N+1 to manifest N.
 *
 * ⚠ CHOSEN BECAUSE IT IS THE HONEST SHAPE. It is what a rebuild that committed while its manifest
 * never landed actually leaves behind — not a synthetic corruption invented to trip a check.
 */
async function tear(repo) {
  const { openDb } = await import(`file:///${ROOT}/mcp/stdio/storage/db.js`);
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  try { db.run('UPDATE graph_generation SET generation = generation + 1'); } finally { db.close(); }
}

/**
 * Deep-copy a repo directory so each arm is isolated.
 *
 * ⛔ ROBOCOPY RETURNS 1 ON SUCCESS. Codes 0-7 are all success (1 = files were copied); only 8+ is a
 * failure. execFileSync throws on any non-zero, so the obvious call fails on a copy that worked
 * perfectly. Same shape as reading a suite's exit status off the wrong command — the status means
 * what the TOOL says it means, not what the convention next door says.
 */
function cloneRepo(src) {
  const dst = mkdtempSync(join(tmpdir(), 'apg-arm-'));
  try {
    execFileSync('robocopy', [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'],
      { stdio: 'ignore' });
  } catch (e) {
    if (typeof e?.status !== 'number' || e.status >= 8) throw e;
  }
  if (!existsSync(join(dst, '.aify-graph', 'graph.sqlite'))) {
    throw new Error(`clone produced no graph at ${dst} — the copy silently did nothing`);
  }
  return dst;
}

// The verbs a decision-shaped task could plausibly route through. Derived from the census of what
// imports the publication classifier PLUS the verbs the field report shows agents actually using —
// a list of only the former would beg the question this script exists to answer.
const VERBS = [
  ['graph_health', 'query/verbs/health.js', 'graphHealth', (r) => ({ repoRoot: r })],
  ['graph_status', 'query/verbs/status.js', 'graphStatus', (r) => ({ repoRoot: r })],
  ['graph_preflight', 'query/verbs/preflight.js', 'graphPreflight', (r) => ({ repoRoot: r, symbol: 'normalizeInput' })],
  ['graph_callers', 'query/verbs/callers.js', 'graphCallers', (r) => ({ repoRoot: r, symbol: 'normalizeInput' })],
  ['graph_consequences', 'query/verbs/consequences.js', 'graphConsequences', (r) => ({ repoRoot: r, symbol: 'normalizeInput' })],
  ['graph_impact', 'query/verbs/impact.js', 'graphImpact', (r) => ({ repoRoot: r, symbol: 'normalizeInput' })],
];

/** Strip fields that vary run-to-run for reasons unrelated to tearing. */
function normalize(s) {
  return String(s)
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<TS>')
    .replace(/\d+(\.\d+)?\s*ms/g, '<MS>')
    .replace(/[0-9a-f]{7,40}/g, '<SHA>');
}

async function runVerb([name, path, fn, args], repo) {
  try {
    const mod = await import(`file:///${ROOT}/mcp/stdio/${path}`);
    const out = await mod[fn](args(repo));
    return normalize(typeof out === 'string' ? out : JSON.stringify(out));
  } catch (e) {
    return `THREW: ${e?.message ?? e}`;
  }
}

const base = await buildFixtureRepo();
const healthy = cloneRepo(base);
const torn = cloneRepo(base);
await tear(torn);

console.log('ROUTE CENSUS — does this verb\'s answer change when the graph is torn?\n');
console.log('  verb                 healthy vs torn      carries the mechanism?');
console.log('  ' + '-'.repeat(66));

const results = [];
for (const v of VERBS) {
  const a = await runVerb(v, healthy);
  const b = await runVerb(v, torn);
  const differs = a !== b;
  results.push({ verb: v[0], differs });
  console.log(`  ${v[0].padEnd(20)} ${(differs ? 'DIFFERS' : 'identical').padEnd(20)} ${differs ? 'YES — estimable here' : 'NO  — score NOT REACHED'}`);
}

// ⛔ THE CONTROL. If NOTHING differs, the tear itself did not take, and every "identical" above is
// an artifact of a broken fixture rather than a fact about the verbs. A census where no verb can
// discriminate is a census that measured nothing.
const anyDiffers = results.some((r) => r.differs);
console.log('\n  CONTROL: at least one verb must differ, or the tear never took.');
console.log(`  -> ${anyDiffers ? 'PASS — the tear is observable' : 'FAIL — VOID, the fixture is not torn'}`);

for (const d of [healthy, torn, base]) rmSync(d, { recursive: true, force: true });
if (!anyDiffers) process.exit(2);
