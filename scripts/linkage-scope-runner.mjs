// THE LINKAGE-SCOPE RUNNER — drives the frozen experiment in tests/fixtures/linkage-scope/.
//
//   node scripts/linkage-scope-runner.mjs                 # mock executor, spends NOTHING
//   node scripts/linkage-scope-runner.mjs --executor=<module.mjs>
//
// Preregistered: docs/evidence/m5-scale/PREREGISTRATION-linkage-runner.md.
//
// ⚠ REPEATS DROPPED 2026-09-03 (Steven): 4 repos × 3 tasks × 2 arms × 1 = 24 runs, not 72.
// `--repeats` already defaulted to 1, so this costs no code — but it changes what may be CLAIMED.
// Repeats existed to separate a real difference from run-to-run variance, and agents are
// non-deterministic. At one run per cell NO PER-CELL DELTA IS SIGNAL. What survives is the paired
// comparison across the 12 repo×task cells: "the graph arm was safer in N of 12". Report that, and
// never a single cell's difference.
//
// ⛔ BUILDING COSTS NOTHING. RUNNING FOR REAL COSTS 24 AGENT RUNS AND IS STEVEN'S CALL. No real
// executor ships with this file. The default is a mock that proves the plumbing and emits numbers
// that mean NOTHING about the product. Pointing --executor at a real agent adapter is a deliberate,
// separate act; it cannot happen by running this script.
//
// ⛔ THE FIXTURE IS FROZEN. This reads ground-truth.json, prompts.json and corpus/ and changes none
// of them. Its freezeRule forbids redesigning toward the test: if the wiring cannot drive the rubric
// without editing the key, the answer is to stop and report that, not to adjust the fixture.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ScratchRepo } from './lib/linkage-scratch-repo.mjs';
import { scoreTranscript, GATE_CARRYING_VERBS } from './lib/ab-rubric.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(REPO, 'tests/fixtures/linkage-scope');
const read = (f) => JSON.parse(readFileSync(join(FIXTURE, f), 'utf8'));

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

// ── 1. PREFLIGHT, before anything is spent ───────────────────────────────────────────────────
// Runs the preflight SCRIPT rather than a copy of its logic: the artifact the operation will use is
// the artifact that must be checked. A leaked prompt does not make a run fail, it makes a run
// succeed and mean nothing.
function preflightOrRefuse() {
  try {
    execFileSync('node', [join(REPO, 'scripts/linkage-scope-preflight.mjs')], { encoding: 'utf8' });
    return true;
  } catch (e) {
    console.error(String(e.stdout ?? ''));
    console.error('PREFLIGHT FAILED — not running. Fix the fixture, do not bypass this.');
    return false;
  }
}

// ── 2. The arms ──────────────────────────────────────────────────────────────────────────────
// ⛔ THE ARM WAS CALLED `grep` AND THAT NAMED THE WRONG EXPERIMENT (renamed 2026-09-03, Steven).
//
// Both arms are the SAME agent with the SAME tools on the SAME sources — grep included, because
// every agent has grep and we are not proposing to replace it. The single treatment is whether the
// GRAPH IS PRESENT. Calling the control "grep" framed the result as graph-VERSUS-grep, which is a
// claim this project's purpose statement explicitly disclaims, and it also implies the graph arm
// somehow lacks grep. It does not.
//
// ⇒ The question is: does adding the graph to an agent that ALREADY HAS GREP make its decision
// better, faster or safer? `nograph` gets the same sources and no index at all.
const ARMS = Object.freeze(['graph', 'nograph']);

// Returns the repo AND the verified facts about the state it is in. The facts travel with the row:
// a cell whose treatment silently failed must be visibly invalid, not quietly counted.
async function prepare(klass, arm) {
  const repo = new ScratchRepo(klass).materialise();
  const state = { indexed: false, attestation: null };
  if (arm === 'graph') {
    await repo.index();
    state.indexed = repo.isIndexed();
    if (!state.indexed) throw new Error('graph arm was not indexed — that is a mislabelled nograph arm');
    if (klass.id === 'C6-torn-graph-safety') state.attestation = await repo.tear();
  }
  return { repo, state };
}

// ── 3. The executor boundary ─────────────────────────────────────────────────────────────────
// One function, injected. The mock returns fixed transcripts so the plumbing can be exercised end to
// end for free. It is deliberately BAD at the task: a mock that answered well would make a green
// wiring run look like a product result.
const mockExecutor = async ({ prompt, arm, klass }) => ({
  transcript: arm === 'graph'
    ? `MOCK(${klass.id}): I looked at the graph. No callers found.`
    : `MOCK(${klass.id}): no graph here; I read the sources. No callers found.`,
  toolCalls: arm === 'graph' ? ['graph_callers'] : ['Grep', 'Read'],
  cost: { tokens: null, durationMs: null },
  runtime: 'mock',
  mock: true,
});

export async function loadExecutor(spec) {
  if (!spec || spec === 'mock') return { fn: mockExecutor, isMock: true };
  const mod = await import(spec.startsWith('.') ? join(REPO, spec) : spec);
  if (typeof mod.default !== 'function') throw new Error(`executor ${spec} has no default export function`);
  return { fn: mod.default, isMock: false };
}

// ── 4. Reporting — pure, and forbidden from averaging tiers ───────────────────────────────────
// The key's analysisRule: "Report per tier, per class, per runtime. NEVER average synthetic and real
// into one 'X% better' headline." So there is no overall number here to quote. That absence is the
// design, not an omission.
// ⛔ RUNTIME IS A GROUPING LEVEL, NOT A LABEL. The key: "Hermes and Claude Code reported separately,
// never pooled." Two runtimes summed into one cell is the same defect as averaging tier A with tier
// B, one level down — and it is invisible in the output, because a pooled cell looks exactly like a
// single-runtime cell with more runs.
export function buildReport(rows) {
  const byTier = {};
  for (const r of rows) {
    const t = (byTier[r.tier] ??= {});
    const c = (t[r.classId] ??= {});
    const rt = (c[r.runtime ?? 'unknown'] ??= {});
    const a = (rt[r.arm] ??= { runs: 0, unsafe: 0, refused: 0, ambiguous: 0, gateNotReached: 0, sourceVerified: 0 });
    a.runs += 1;
    if (r.score.unsafeAuthoritativeConclusion === true) a.unsafe += 1;
    else if (r.score.unsafeAuthoritativeConclusion === false) a.refused += 1;
    else a.ambiguous += 1;
    if (r.score.gateReached === false) a.gateNotReached += 1;
    if (r.score.sourceVerified) a.sourceVerified += 1;
  }
  return byTier;
}

/**
 * The PAIRED view — graph vs nograph on the SAME cell.
 *
 * ⛔ WITHOUT THIS, DROPPING REPEATS LEFT THE EXPERIMENT UNANALYSABLE. With repeats=3 the per-arm
 * counts in `buildReport` carried within-cell information. At repeats=1 every count is 0 or 1, and
 * the only statement the design still supports — "the graph arm was safer in N of M cells" — was
 * computed nowhere. The instrument has to follow the analysis unit; Steven moved the unit on
 * 2026-09-03 and this is the half that had to move with it.
 *
 * ⛔ PER TIER AND PER RUNTIME, NEVER POOLED. The key's analysisRule forbids averaging synthetic
 * (tier A) with real (tier B) into one headline, and forbids pooling Hermes with Claude Code. A
 * single "N of 12" across everything would break both rules at once, which is exactly the shape a
 * reader most wants to quote.
 *
 * ⚠ UNPAIRABLE CELLS ARE COUNTED, NOT DROPPED. A cell where one arm errored or never ran cannot be
 * compared, and silently omitting it shrinks the denominator — the failure mode that has produced
 * more wrong numbers in this project than any other.
 *
 * Safety axis is the rubric's primary one: `unsafeAuthoritativeConclusion === true` is the harm.
 */
export function buildPairedReport(rows) {
  const cells = new Map(); // tier|runtime|classId -> { graph, nograph }
  for (const r of rows) {
    const key = `${r.tier}|${r.runtime ?? 'unknown'}|${r.classId}`;
    const cell = cells.get(key) ?? {};
    cell[r.arm] = r;
    cells.set(key, cell);
  }

  const out = {};
  for (const [key, cell] of cells) {
    const [tier, runtime, classId] = key.split('|');
    const bucket = ((out[tier] ??= {})[runtime] ??= {
      graphAvoidedHarm: 0, nographAvoidedHarm: 0, sameHarm: 0,
      graphMoreDecisive: 0, nographMoreDecisive: 0, sameDecisiveness: 0,
      unpairable: 0, unpairableCells: [],
    });
    const g = cell.graph;
    const n = cell.nograph;
    if (!g || !n) {
      bucket.unpairable += 1;
      bucket.unpairableCells.push(`${classId} (missing ${!g ? 'graph' : 'nograph'})`);
      continue;
    }
    // ⛔ TWO AXES, BECAUSE THE RUBRIC IS DELIBERATELY THREE-VALUED AND I FLATTENED IT.
    //
    // My first version compared `=== true` against everything else and called the winner "safer".
    // That collapses `false` (a decisive, correct refusal) with `ambiguous` — which the rubric's own
    // header calls "a routing decision to a human, never a pass". So a cell where the graph arm
    // refused cleanly and the nograph arm produced an ambiguous answer was counted as "same", and
    // the field was named for a broader claim than it measured.
    //
    // ⇒ HARM is the primary axis: an unsafe authoritative conclusion is the expensive failure and
    // it is what `unsafeAvoided` counts. DECISIVENESS is reported separately and never folded in:
    // turning an ambiguous answer into a clean refusal is a real improvement, but it is NOT a
    // safety improvement and must not be added to one.
    const harm = (r) => r.score.unsafeAuthoritativeConclusion === true;
    const decisive = (r) => r.score.unsafeAuthoritativeConclusion === false;

    if (harm(g) === harm(n)) bucket.sameHarm += 1;
    else if (harm(n)) bucket.graphAvoidedHarm += 1;
    else bucket.nographAvoidedHarm += 1;

    if (decisive(g) === decisive(n)) bucket.sameDecisiveness += 1;
    else if (decisive(g)) bucket.graphMoreDecisive += 1;
    else bucket.nographMoreDecisive += 1;
  }
  return out;
}

function printPaired(paired) {
  console.log('\n══ PAIRED OUTCOMES — graph vs nograph on the SAME cell');
  console.log('   (n=1 per cell: a single cell\'s difference is NOT signal. Read the counts.)');
  console.log('   HARM = an unsafe authoritative conclusion. DECISIVENESS = a clean refusal vs an');
  console.log('   ambiguous answer (the rubric routes ambiguous to a human; it is not a pass).');
  console.log('   ⚠ These are SEPARATE axes. More decisive is NOT safer — do not add them.');
  for (const tier of Object.keys(paired).sort()) {
    for (const runtime of Object.keys(paired[tier]).sort()) {
      const b = paired[tier][runtime];
      const pairs = b.graphAvoidedHarm + b.nographAvoidedHarm + b.sameHarm;
      console.log(`   tier ${tier} · ${runtime}  HARM: graph avoided ${b.graphAvoidedHarm}/${pairs}`
        + ` · nograph avoided ${b.nographAvoidedHarm}/${pairs} · same ${b.sameHarm}/${pairs}`);
      console.log(`   tier ${tier} · ${runtime}  DECISIVE: graph ${b.graphMoreDecisive}/${pairs}`
        + ` · nograph ${b.nographMoreDecisive}/${pairs} · same ${b.sameDecisiveness}/${pairs}`
        + (b.unpairable ? `  ⚠ UNPAIRABLE ${b.unpairable}: ${b.unpairableCells.join(', ')}` : ''));
    }
  }
  console.log('   No cross-tier and no cross-runtime total: the key forbids both.');
}

function printReport(byTier, rows, { isMock }) {
  for (const tier of Object.keys(byTier).sort()) {
    console.log(`\n══ TIER ${tier} ${tier === 'A' ? '(purpose-built qualification — NOT field value)' : '(real pinned snapshots)'}`);
    for (const classId of Object.keys(byTier[tier]).sort()) {
      console.log(`  ${classId}`);
      for (const runtime of Object.keys(byTier[tier][classId]).sort()) {
        console.log(`    runtime: ${runtime}`);
        for (const arm of Object.keys(byTier[tier][classId][runtime]).sort()) {
          const a = byTier[tier][classId][runtime][arm];
          console.log(`      ${arm.padEnd(6)} runs=${a.runs}  unsafe=${a.unsafe}  refused=${a.refused}`
            + `  ambiguous=${a.ambiguous}  gateNotReached=${a.gateNotReached}  sourceVerified=${a.sourceVerified}`);
        }
      }
    }
  }
  console.log('\nNo cross-tier total is printed. The key forbids averaging synthetic with real.');

  // ⛔ THE TREATMENT AUDIT. C6's whole point is a torn graph; a C6 graph row that was not verifiably
  // torn is not a weak result, it is NOT THE EXPERIMENT. Printed next to the numbers so it cannot be
  // read past.
  const c6 = rows.filter((r) => r.classId === 'C6-torn-graph-safety' && r.arm === 'graph');
  const torn = c6.filter((r) => r.state?.attestation === 'generation_mismatch');
  console.log(`\nTREATMENT AUDIT — C6 graph rows verifiably torn: ${torn.length}/${c6.length}`
    + (c6.length && torn.length === c6.length ? '  OK' : '  ⛔ INVALID — do not report these cells'));
  const unindexed = rows.filter((r) => r.arm === 'graph' && !r.state?.indexed);
  console.log(`graph rows that were actually indexed: ${rows.filter((r) => r.arm === 'graph').length - unindexed.length}`
    + `/${rows.filter((r) => r.arm === 'graph').length}`);
  if (isMock) {
    console.log('\n⛔ MOCK EXECUTOR. Every number above is plumbing, not evidence. It says nothing');
    console.log('   whatsoever about the product, and must never be reported as a result.');
  }
}

// ── 5. The run ───────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!preflightOrRefuse()) process.exit(1);

  const key = read('ground-truth.json');
  const prompts = read('prompts.json');
  const promptFor = new Map(prompts.prompts.map((p) => [p.class, p.text]));

  const only = argOf('classes', null)?.split(',').filter(Boolean) ?? null;
  const repeats = Number(argOf('repeats', '1'));
  const { fn: execute, isMock } = await loadExecutor(argOf('executor', 'mock'));

  const classes = key.classes.filter((c) => !only || only.includes(c.id));
  const rows = [];
  const skipped = [];

  for (const klass of classes) {
    const prompt = promptFor.get(klass.id);
    // ⛔ EXACT TEXT ONLY. A paraphrase or an added hint is an instruction the agent follows rather
    // than a choice it makes, and the routing measurement is what this experiment is for.
    if (!prompt) { skipped.push(`${klass.id}: no prompt in prompts.json`); continue; }

    for (const arm of ARMS) {
      for (let i = 0; i < repeats; i += 1) {
        let repo;
        try {
          const prepared = await prepare(klass, arm);
          repo = prepared.repo;
          const result = await execute({ prompt, arm, klass, repoDir: repo.dir });
          const score = scoreTranscript({
            groundTruthClass: klass,
            transcript: result.transcript,
            toolCalls: result.toolCalls ?? [],
            cost: result.cost ?? {},
          });
          rows.push({
            classId: klass.id, tier: klass.tier, arm, repeat: i, score,
            runtime: result.runtime ?? (result.mock ? 'mock' : 'unknown'),
            state: prepared.state, mock: Boolean(result.mock),
          });
        } catch (e) {
          // A failed run is RECORDED, never dropped — a silently missing cell looks like a cell that
          // was never planned.
          skipped.push(`${klass.id}/${arm}/#${i}: ${e.message}`);
        } finally {
          repo?.dispose();
        }
      }
    }
  }

  printReport(buildReport(rows), rows, { isMock });
  printPaired(buildPairedReport(rows));

  if (skipped.length) {
    console.log(`\n⚠ NOT RUN (${skipped.length}) — reported, not silently dropped:`);
    for (const s of skipped) console.log(`   ${s}`);
  }

  console.log(`\ngate-carrying verbs in force: ${GATE_CARRYING_VERBS.join(', ')}`);
  console.log('(C6 scoring: routing straight to graph_callers without health/preflight/status is');
  console.log(' gate_not_reached — recorded, and NOT scored as mechanism success or failure.)');

  const outDir = join(REPO, 'docs/evidence/m5-scale/runs');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${isMock ? 'mock' : 'run'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(out, JSON.stringify({ isMock, repeats, rows, skipped }, null, 2));
  console.log(`\nrows written to ${out.slice(REPO.length + 1)}`);
}

if (!process.env.APG_LINKAGE_RUNNER_NO_MAIN) await main();
