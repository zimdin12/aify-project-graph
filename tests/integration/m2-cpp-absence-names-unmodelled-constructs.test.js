// ⛔ THE CONSUMER HALF, AND IT IS THE THIRD TIME THIS GAP APPEARED IN ONE ARC.
//
// The unit tests call `buildAbsenceTrustLine` directly and prove the clause is correct. They say
// NOTHING about whether `graph_callers` passes the language that triggers it. Mutant C-7 — replacing
// `language: targets[0]?.language` with `language: null` — SURVIVED the entire unit file.
//
// The same shape survived twice before in this arc: a mutant deleting `structural_coverage` from
// graph_consequences, and `graph_callers` no longer handing over its db for caller sets. Each time
// the helper had tests and the verb meant to call it did not.
//
// ⇒ A helper's correctness is not evidence that anything reaches it. This file asserts the clause
// through the REAL verb, on a REAL indexed C++ fixture.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphIndex } from '../../mcp/stdio/query/verbs/index.js';
import { graphCallers } from '../../mcp/stdio/query/verbs/callers.js';
import { graphCallees } from '../../mcp/stdio/query/verbs/callees.js';
import { graphImpact } from '../../mcp/stdio/query/verbs/impact.js';
import { graphTrace } from '../../mcp/stdio/query/verbs/trace.js';
import { expectAbsentWithLiveMatcher } from '../helpers/live-matcher.js';

const CPP = fileURLToPath(new URL('../fixtures/identity-hostile', import.meta.url));
const JS = fileURLToPath(new URL('../fixtures/identity-callers-js', import.meta.url));

async function indexed(fixture, prefix) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(fixture, repo, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'i');
  await graphIndex({ repoRoot: repo });
  return repo;
}

let cppRepo;
let jsRepo;

beforeAll(async () => {
  cppRepo = await indexed(CPP, 'apg-m2-cpp-');
  jsRepo = await indexed(JS, 'apg-m2-js-');
}, 600000);

afterAll(() => {
  for (const r of [cppRepo, jsRepo]) {
    try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* handle */ }
  }
});

describe('M2 — a real C++ absence names what was not modelled', () => {
  it('POSITIVE CONTROL: the query actually reaches an absence, not a refusal', async () => {
    // If this returned AMBIGUOUS the run would never reach the absence path, and every assertion
    // below would be about a message that was never produced.
    const text = String(await graphCallers({ repoRoot: cppRepo, symbol: 'alpha::Widget::render', top_k: 10, depth: 1 }));
    expect(text).toMatch(/NO CALLERS for "alpha::Widget::render"/);
  });

  it('★ graph_callers passes the language through — the clause reaches the agent', async () => {
    const text = String(await graphCallers({ repoRoot: cppRepo, symbol: 'alpha::Widget::render', top_k: 10, depth: 1 }));
    expect(text).toMatch(/NOT MODELLED/);
    expect(text).toMatch(/function pointers or std::function/);
    expect(text).toMatch(/excluded by conditional compilation/);
    expect(text).toMatch(/invisible to BOTH tiers/);
  });

  it('⛔ a JavaScript repo pays ZERO bytes for it, through the same verb', async () => {
    const text = String(await graphCallers({ repoRoot: jsRepo, symbol: 'alpha.Widget.render', top_k: 10, depth: 1 }));
    expectAbsentWithLiveMatcher(
      /NOT MODELLED/,
      { forbidden: 'NOT MODELLED: calls through function pointers or std::function',
        allowed: 'absence is from the heuristic graph and is NOT exhaustive' },
      text,
      'the construct clause is C/C++ only; a JS repo must not carry it',
    );
  });

  it('★ THE SWEEP: graph_callees and graph_impact carry it too, not just graph_callers', async () => {
    // The clause shipped on graph_callers alone. Four other verbs answer absence through the same
    // helper, and graph_impact is the one an agent asks BEFORE CHANGING SOMETHING — the highest-
    // stakes absence in the tool. A structural guard proves `language:` is written at each call
    // site; this proves the clause actually reaches an agent.
    const callees = String(await graphCallees({ repoRoot: cppRepo, symbol: 'alpha::Widget::render', top_k: 10 }));
    expect(callees, 'this must be the absence path or the assertion is vacuous').toMatch(/NO CALLEES/);
    expect(callees).toMatch(/NOT MODELLED/);

    const impact = String(await graphImpact({ repoRoot: cppRepo, symbol: 'alpha::Widget::render', top_k: 10 }));
    expect(impact, 'this must be the absence path or the assertion is vacuous').toMatch(/NO IMPACT/);
    expect(impact).toMatch(/NOT MODELLED/);
  });

  it('★ graph_trace carries it on NO STATIC PATH — the absence a "safe to remove" call leans on', async () => {
    // A path can exist through a function pointer the analysis never modelled, so "no static path"
    // is exactly the absence that needs the caveat.
    const text = String(await graphTrace({ repoRoot: cppRepo, from: 'alpha::Widget::render', to: 'beta::Widget::render' }));
    expect(text, 'must be the no-path branch or this asserts nothing').toMatch(/NO STATIC PATH/);
    expect(text).toMatch(/NOT MODELLED/);
  });

  // ⚠ graph_neighbors is covered STRUCTURALLY only (the call-site gate), not behaviourally: every
  // symbol in this fixture has edges, so the fixture cannot reach its absence branch. Stated rather
  // than implied by a passing file.
});
