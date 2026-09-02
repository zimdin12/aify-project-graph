// PREFLIGHT FOR THE LINKAGE-SCOPE EXPERIMENT — runs before any agent budget is spent.
//
// Preregistered: docs/evidence/m5-scale/PREREGISTRATION-linkage-runner.md.
//
//   node scripts/linkage-scope-preflight.mjs
//   exit 0 = the fixture is fit to run.  exit 1 = do NOT start the run.
//
// ⛔ WHY THIS EXISTS SEPARATELY FROM THE RUNNER. A leaked prompt or a silently edited key does not
// make a run fail — it makes it succeed and MEAN NOTHING. `prompts.json` says so itself: if a prompt
// names the mechanism under test, "the routing measurement is destroyed — the agent is following the
// prompt rather than choosing." That is discovered after 72 runs, or before the first one.
//
// ⛔ THE FIXTURE IS FROZEN AND THIS ONLY READS IT. Its `freezeRule` forbids redesigning toward the
// test; a preflight that repaired what it found would be doing exactly that.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(REPO, 'tests/fixtures/linkage-scope');

const read = (name) => JSON.parse(readFileSync(join(FIXTURE, name), 'utf8'));
const key = read('ground-truth.json');
const prompts = read('prompts.json');

// The class ids and their tier/graphShouldWin as recorded in the preregistration. A key that has
// drifted from this is no longer the frozen experiment, and the run must not proceed on it.
const EXPECTED = {
  'C1-internal-linkage-closed': { tier: 'A', graphShouldWin: false },
  'C2-no-header-external-declaration': { tier: 'A', graphShouldWin: true },
  'C3-unity-build': { tier: 'A', graphShouldWin: false },
  'C4-header-exposed': { tier: 'B', graphShouldWin: true },
  'C5-dynamic-boundary': { tier: 'A', graphShouldWin: false },
  'C6-torn-graph-safety': { tier: 'B', graphShouldWin: false },
};

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); };

// ── CONTROL 1: the leak rule the fixture sets for itself ────────────────────────────────────
{
  const forbidden = prompts.forbiddenInPrompts ?? [];
  const violations = [];
  for (const p of prompts.prompts ?? []) {
    const text = String(p.text ?? '').toLowerCase();
    for (const word of forbidden) {
      // Word-boundary match: "call" must not fire inside "recall", and the allowances the fixture
      // documents (`translation unit`, symbol/file names) are phrases it deliberately permits.
      const re = new RegExp(`(?<![a-z])${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`);
      if (re.test(text)) violations.push(`${p.class}: "${word}"`);
    }
  }
  check('LEAK: no prompt names the mechanism under test', violations.length === 0,
    violations.length ? violations.join('; ') : `${forbidden.length} forbidden words, ${(prompts.prompts ?? []).length} prompts, 0 violations`);

  // ⛔ POSITIVE CONTROL ON THE ZERO. A matcher that never fires reports the same clean zero as a
  // clean fixture. Four times in one session a broken instrument handed me an empty result that I
  // read as a finding, so the matcher must be shown to work in the same pass.
  const probe = 'does anything call normalizeInput';
  const canFind = /(?<![a-z])call(?![a-z])/.test(probe);
  const canReject = !/(?<![a-z])clangd(?![a-z])/.test(probe);
  check('LEAK CONTROL: the matcher can find a present word AND reject an absent one',
    canFind && canReject, `finds "call": ${canFind}; rejects "clangd": ${canReject}`);
}

// ── CONTROL 2: key integrity ────────────────────────────────────────────────────────────────
{
  const drift = [];
  const seen = new Set();
  for (const c of key.classes ?? []) {
    seen.add(c.id);
    const want = EXPECTED[c.id];
    if (!want) { drift.push(`${c.id}: not in the preregistered set`); continue; }
    if (c.tier !== want.tier) drift.push(`${c.id}: tier ${c.tier} != ${want.tier}`);
    if (Boolean(c.graphShouldWin) !== want.graphShouldWin) drift.push(`${c.id}: graphShouldWin ${c.graphShouldWin} != ${want.graphShouldWin}`);
  }
  for (const id of Object.keys(EXPECTED)) if (!seen.has(id)) drift.push(`${id}: MISSING from the key`);
  check('KEY: 6 classes, tiers and graphShouldWin match the preregistration', drift.length === 0,
    drift.length ? drift.join('; ') : `${seen.size} classes, all matching`);
}

// ── CONTROL 3: corpus presence ──────────────────────────────────────────────────────────────
{
  const missing = [];
  for (const c of key.classes ?? []) {
    for (const f of c.files ?? []) if (!existsSync(join(FIXTURE, f))) missing.push(`${c.id}: ${f}`);
  }
  // ⛔ An unrunnable class is REPORTED, never skipped quietly — a silently dropped class shrinks the
  // population without shrinking the claim.
  check('CORPUS: every file named by every class exists', missing.length === 0,
    missing.length ? missing.join('; ') : 'all class files present');
}

// ── CONTROL 4: rubric liveness ──────────────────────────────────────────────────────────────
{
  const { scoreTranscript } = await import('../scripts/lib/ab-rubric.mjs');
  const cls = (key.classes ?? []).find((c) => c.id === 'C2-no-header-external-declaration');
  const unsafe = scoreTranscript({
    groundTruthClass: cls,
    transcript: 'I checked and nothing else uses it. It is safe to delete computeWeight.',
    toolCalls: [],
  });
  const refusal = scoreTranscript({
    groundTruthClass: cls,
    transcript: 'I cannot confirm this is unused; the search is not exhaustive, so I would not delete it.',
    toolCalls: [],
  });
  // The endpoint is three-valued on purpose. What must hold is that a plain go-ahead and a plain
  // refusal do not score IDENTICALLY — a rubric that cannot separate them cannot measure anything.
  check('RUBRIC: a go-ahead and a refusal score differently',
    unsafe.unsafeAuthoritativeConclusion !== refusal.unsafeAuthoritativeConclusion,
    `go-ahead: ${unsafe.unsafeAuthoritativeConclusion}   refusal: ${refusal.unsafeAuthoritativeConclusion}`);
}

console.log('LINKAGE-SCOPE PREFLIGHT\n');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'FIT TO RUN — controls pass. Budget authorisation is a separate question.' : `DO NOT RUN — ${failed.length} control(s) failed.`}`);
process.exit(failed.length === 0 ? 0 : 1);
