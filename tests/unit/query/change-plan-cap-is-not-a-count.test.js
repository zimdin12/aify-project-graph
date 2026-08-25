// A DISPLAY CAP WAS BEING REPORTED AS A POPULATION.
//
// Third instance of one class, found in field testing's mechanical sweep after the first two:
// symbol_lookup reported a candidate CAP as a total, graph_packet's DEFINED IN listed 3 of
// 16 in silence, and here `testFiles` was cut to `top_k` (default 6) and its length then
// emitted as the count in the SIGNALS line.
//
// ⚠⚠ MY WRITE-UP OF THIS OVERSTATED IT TWICE, AND THE CORRECTIONS ARE THE USEFUL PART.
//
// FIRST I claimed the cap "fed the RISK VERDICT" and called this the worst-placed of the
// three. It does reach computeDecision as `testCount` — but that branches only on
// `testCount === 0` vs `> 0` (preflight.js:173, :208) and slicing a non-empty array never
// yields an empty one, so THE TIER COULD NEVER MOVE. The test I wrote asserting it moved
// PASSED WITH THE DEFECT REINSTATED: a vacuous assertion defending an inflated claim.
//
// THEN I retreated to "it reaches the reason string a reader acts on" (preflight.js:209).
// I could not reach that branch either — not with 20 tests, not with LSP-verified callers;
// earlier conditions return first. ⇒ So I am not asserting it. An unreachable branch is
// not evidence, and two rounds of quietly shrinking a claim to fit whatever survived is
// how a severity gets inflated in the first place.
//
// ⇒ WHAT IS DEMONSTRATED, and all that is claimed here: one wrong number in SIGNALS.
// The `testCount` fix stays — a display cap must never be handed to a decision function,
// whether or not today's thresholds happen to be insensitive to it — but it is defence in
// depth, not a defect with a shown consequence, and it is not counted as one.
//
// The cap itself is fine — it is a display budget. What it must not do is stand in for the
// population it was drawn from.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphChangePlan } from '../../../mcp/stdio/query/verbs/change_plan.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

const TEST_FILES = 20; // comfortably over the default top_k of 6

let repoRoot;

const insertNode = (db, node) => db.run(
  `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
   VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
  { start_line: 1, end_line: 1, language: 'javascript', confidence: 1, extra: '{}', ...node },
);

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-cap-count-'));
  await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await mkdir(join(repoRoot, 'tests'), { recursive: true });
  const runGit = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
  runGit('init', '-q');
  runGit('config', 'user.email', 'test@test');
  runGit('config', 'user.name', 'test');
  runGit('commit', '--allow-empty', '-qm', 'init');
  const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));

  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  insertNode(db, { id: 'target', type: 'Function', label: 'ensureFresh', file_path: 'src/orchestrator.js' });
  // Twenty distinct test files, each with a TESTS edge onto the target. groupByFile keys
  // on the file, so twenty files really are twenty groups — not one group seen twenty
  // times, which would make the fixture prove nothing.
  for (let i = 0; i < TEST_FILES; i += 1) {
    insertNode(db, { id: `t${i}`, type: 'Function', label: `spec${i}`, file_path: `tests/spec_${i}.test.js` });
    db.run(
      `INSERT INTO edges (from_id, to_id, relation, confidence) VALUES ($f, 'target', 'TESTS', 1)`,
      { f: `t${i}` },
    );
  }
  db.close();
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

const asText = (o) => (typeof o === 'string' ? o : JSON.stringify(o));

describe('change_plan reports the population, not the display budget', () => {
  it('★★ SIGNALS states the true test-file count, disclosing the sample', async () => {
    // Before the fix this read "6 test file(s)" for a symbol with twenty.
    const text = asText(await graphChangePlan({ repoRoot, symbol: 'ensureFresh' }));

    expect(text, 'harness sanity: the plan must reach the SIGNALS line').toMatch(/SIGNALS/);
    expect(text, 'the total must survive the cap').toMatch(/6 of 20 test file\(s\)/);
    expect(text, 'and the bare capped number must not be presented as the count')
      .not.toMatch(/(?<!of )\b6 test file\(s\)/);
  }, 30_000);

  it('★ says nothing about sampling when nothing was sampled', async () => {
    // A disclosure that always fires is noise, and noise is what makes real disclosures
    // ignorable. With top_k above the population there is no sample to declare.
    const text = asText(await graphChangePlan({ repoRoot, symbol: 'ensureFresh', top_k: 50 }));

    expect(text).toMatch(/20 test file\(s\)/);
    expect(text, 'nothing was cut, so nothing may claim to have been').not.toMatch(/of 20 test file\(s\)/);
  }, 30_000);
});
