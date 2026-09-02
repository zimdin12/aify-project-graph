// The two things in the linkage-scope runner most likely to break SILENTLY.
//
// ⚠ CEILING, stated first because this file is easy to over-read: it tests WIRING. The runner's own
// claim ceiling applies — "wiring proves the harness can carry the experiment, it proves nothing
// about the product". A green run here is not a result about anything.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScratchRepo } from '../../../scripts/lib/linkage-scratch-repo.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const KEY = JSON.parse(readFileSync(join(REPO, 'tests/fixtures/linkage-scope/ground-truth.json'), 'utf8'));

let repo = null;
afterEach(() => { repo?.dispose(); repo = null; });

describe('the corpus lands where the PROMPTS say it is', () => {
  it('★ corpus/<f> materialises to src/<f> — the path the prompt names', () => {
    // Every prompt names src/ ("Is it safe to delete computeWeight from src/weights.cpp?") while the
    // corpus lives under corpus/. Materialising to the corpus path would point the agent at a file
    // that does not exist, and it would score as a routing failure that was really a harness bug.
    const klass = KEY.classes.find((c) => c.id === 'C2-no-header-external-declaration');
    repo = new ScratchRepo(klass).materialise();
    for (const rel of klass.files) {
      const base = rel.split('/').pop();
      expect(existsSync(join(repo.dir, 'src', base)), `${base} must exist at src/`).toBe(true);
    }
  }, 30_000);

  it('POSITIVE CONTROL: the prompts really do name src/, so the rule above is load-bearing', () => {
    // Without this, someone could "fix" the path contract by changing it to corpus/ and this file
    // would still pass — the test would be pinning whatever the code happens to do.
    const prompts = JSON.parse(readFileSync(join(REPO, 'tests/fixtures/linkage-scope/prompts.json'), 'utf8'));
    const naming = prompts.prompts.filter((p) => p.text.includes('src/'));
    expect(naming.length, 'no prompt names src/ — the path contract would be arbitrary').toBeGreaterThan(0);
  });

  it('NEGATIVE CONTROL: a class naming a missing corpus file REFUSES rather than running short', () => {
    // An unrunnable class must be reported, never skipped quietly: a dropped class shrinks the
    // population without shrinking the claim.
    const bogus = { id: 'C0-not-real', files: ['corpus/definitely-not-here.cpp'] };
    expect(() => { new ScratchRepo(bogus).materialise(); }).toThrow(/missing/i);
  });
});

describe('the report never averages tier A with tier B', () => {
  it('⛔ tiers stay separate — the key forbids one "X% better" headline', async () => {
    process.env.APG_LINKAGE_RUNNER_NO_MAIN = '1';
    const { buildReport } = await import('../../../scripts/linkage-scope-runner.mjs');
    const rows = [
      { classId: 'C1', tier: 'A', arm: 'graph', runtime: 'claude-code', score: { unsafeAuthoritativeConclusion: true, gateReached: false, sourceVerified: false } },
      { classId: 'C4', tier: 'B', arm: 'graph', runtime: 'claude-code', score: { unsafeAuthoritativeConclusion: false, gateReached: true, sourceVerified: true } },
    ];
    const out = buildReport(rows);
    expect(Object.keys(out).sort()).toEqual(['A', 'B']);
    expect(out.A.C1['claude-code'].graph.unsafe).toBe(1);
    expect(out.B.C4['claude-code'].graph.refused).toBe(1);
    // The shape itself is the guarantee: there is no key that could hold a pooled figure.
    expect(out).not.toHaveProperty('all');
    expect(out).not.toHaveProperty('total');
  });

  it('⛔ two RUNTIMES are never pooled either — "Hermes and Claude Code reported separately"', async () => {
    // Pooling runtimes is the same defect as averaging tiers, one level down, and it is INVISIBLE in
    // the output: a pooled cell looks exactly like a single-runtime cell with more runs. Only the
    // shape can rule it out.
    process.env.APG_LINKAGE_RUNNER_NO_MAIN = '1';
    const { buildReport } = await import('../../../scripts/linkage-scope-runner.mjs');
    const out = buildReport([
      { classId: 'C4', tier: 'B', arm: 'graph', runtime: 'claude-code', score: { unsafeAuthoritativeConclusion: true, gateReached: true, sourceVerified: true } },
      { classId: 'C4', tier: 'B', arm: 'graph', runtime: 'hermes', score: { unsafeAuthoritativeConclusion: false, gateReached: false, sourceVerified: false } },
    ]);
    expect(Object.keys(out.B.C4).sort()).toEqual(['claude-code', 'hermes']);
    expect(out.B.C4['claude-code'].graph.runs).toBe(1);
    expect(out.B.C4.hermes.graph.runs).toBe(1);
    // The decisive assertion: neither cell absorbed the other's verdict.
    expect(out.B.C4['claude-code'].graph.unsafe).toBe(1);
    expect(out.B.C4.hermes.graph.unsafe).toBe(0);
  });

  it('POSITIVE CONTROL: an ambiguous verdict is counted, not dropped', async () => {
    // Three-valued on purpose. A report that silently discarded `ambiguous` would make every run
    // look decisive, which is the failure the rubric was built three-valued to avoid.
    process.env.APG_LINKAGE_RUNNER_NO_MAIN = '1';
    const { buildReport } = await import('../../../scripts/linkage-scope-runner.mjs');
    const out = buildReport([
      { classId: 'C3', tier: 'A', arm: 'grep', runtime: 'mock', score: { unsafeAuthoritativeConclusion: 'ambiguous', gateReached: false, sourceVerified: true } },
    ]);
    expect(out.A.C3.mock.grep.ambiguous).toBe(1);
    expect(out.A.C3.mock.grep.runs).toBe(1);
  });
});
