// ⛔ ONE CAPTURE IS NOT ACHIEVABLE HERE, AND SAYING SO IS NOT THE SAME AS FIXING IT.
//
// Every other authority reader in this unit was closed the same way: read the manifest, open ONE
// pinned snapshot, take every fact from it. Reviewer prescribed the same shape for the brief —
// capture all graph data, close, then do git and filesystem work. It does not apply, and the reason
// is a substrate cycle rather than an ordering I failed to find:
//
//   docPaths            <- the DATABASE
//   documentRecency()   <- SHELLS OUT TO GIT for exactly those paths
//   linkedDocumentCandidates / readFirst <- the DATABASE AGAIN, using that recency
//
// DB -> git -> DB cannot be wrapped in one snapshot without holding a WAL read open across a
// subprocess, which is the cost captureExistingSnapshot exists to avoid — and this is the ONE
// caller where the git call is unavoidably in the middle. Two captures would put the commit window
// back exactly where it was.
//
// ⭐ SO THE BRIEF DOES NOT CLAIM CONSISTENCY IT DOES NOT HAVE. It records the published generation
// at both ends of its graph reads and reports a straddle when they differ. That is a WEAKER
// guarantee than atomicity and a STRONGER one than silence, and the difference between those two
// is the whole point of this unit.
//
// ⚠ WHY THE COMMIT IS INDUCED FROM documentRecency AND NOT FROM A TIMER. A timer makes the test's
// own scheduling the thing under test — it passes or fails on whether setTimeout landed inside the
// window, which is not a property of the code. Standing in for the git call means the commit lands
// at the exact seam the straddle exists for: after the first DB reads, before the second.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// Set per-test. When it holds a path, the stand-in commits a new generation into that graph the
// first time the brief crosses the git seam.
let commitInto = null;
let crossings = 0;

vi.mock('../../../mcp/stdio/brief/extract.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    documentRecency: (repoRoot, paths) => {
      crossings += 1;
      if (commitInto) {
        const target = commitInto;
        commitInto = null;                       // once, so the second half reads a stable graph
        const writer = openDb(join(target, '.aify-graph', 'graph.sqlite'));
        try { writer.run('UPDATE graph_generation SET generation = generation + 1'); }
        finally { writer.close(); }
      }
      return real.documentRecency(repoRoot, paths);
    },
  };
});

let repo;

beforeEach(async () => {
  commitInto = null;
  crossings = 0;
  repo = mkdtempSync(join(tmpdir(), 'apg-straddle-'));
  mkdirSync(join(repo, 'docs'), { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  writeFileSync(join(repo, 'src', 'a.js'),
    'export function target() { return 1; }\nexport function caller() { return target(); }\n');
  writeFileSync(join(repo, 'docs', 'design.md'), '# Design\n\nThe `target` function returns one.\n');
  writeFileSync(join(repo, 'README.md'), '# Fixture\n\nA repository with a document layer.\n');
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
  await ensureFresh({ repoRoot: repo });
});

afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

const brief = async () => {
  const { generateBrief } = await import('../../../mcp/stdio/brief/generator.js');
  generateBrief({ repoRoot: repo });
  const g = join(repo, '.aify-graph');
  return {
    json: JSON.parse(readFileSync(join(g, 'brief.json'), 'utf8')),
    md: readFileSync(join(g, 'brief.md'), 'utf8'),
    agent: readFileSync(join(g, 'brief.agent.md'), 'utf8'),
  };
};

describe('a brief assembled across a rebuild says so', () => {
  it('the stand-in is actually on the path the brief takes', async () => {
    // ⛔ THE INSTRUMENT CONTROL, AND IT COMES FIRST. If generateBrief stopped calling
    // documentRecency — or called it through a binding this mock does not intercept — every
    // assertion below would pass by never inducing anything, and the straddle case would report a
    // clean brief as proof that nothing straddled. A mock nobody reaches is a test that cannot fail.
    await brief();
    expect(crossings, 'the brief never crossed the git seam this test induces from')
      .toBeGreaterThan(0);
  });

  it('⛔ a generation committed MID-BRIEF is reported, not absorbed', async () => {
    commitInto = repo;
    const out = await brief();

    expect(commitInto, 'the stand-in never fired, so nothing was induced').toBeNull();
    expect(out.json.repo.trust.publication,
      'the brief read two different graphs and presented them as one')
      .toBe('straddled_rebuild');
    expect(out.md, 'the human surface must carry it too').toMatch(/straddled_rebuild/);
    expect(out.agent, 'and the agent surface, which is the one that gets acted on')
      .toMatch(/straddled_rebuild/);
  });

  it('⛔ the straddle is described as a READ problem, not as a broken graph', async () => {
    // ⚠ A DIFFERENT FACT DESERVES DIFFERENT WORDS. The graph here is perfectly attested — its
    // manifest and its database agree, before and after. What went wrong is that the brief read
    // across the boundary. Telling the reader to force a rebuild would be advice for the wrong
    // problem: rebuilding is what caused this, and regenerating is what fixes it.
    commitInto = repo;
    const out = await brief();
    expect(out.md).toMatch(/a rebuild committed while this brief was being assembled/);
    // ⚠ THE TIP LIVES ON THE AGENT SURFACE, NOT ON brief.md — asserted where it actually renders
    // rather than where I first assumed. brief.md prints `Trust: **level** (publication=…) — issues`
    // and has never carried a tip; the agent, plan and onboard renderers print `TRUST level: issues
    // → tip`. My first version asserted the tip against brief.md and failed, which is the correct
    // outcome for an assertion aimed at the wrong surface.
    expect(out.agent).toMatch(/regenerate the brief/);
    expectAbsentWithLiveMatcher(
      /graph_index\(\{ force: true \}\)/,
      {
        forbidden: 'graph_index({ force: true }) to publish a generation this brief can be checked against',
        allowed: 'regenerate the brief; the graph itself may be fine',
      },
      out.agent,
      'a straddled read was blamed on the graph instead of on the read',
    );
  });

  it('POSITIVE CONTROL: an undisturbed brief carries no straddle and no warning', async () => {
    // ⛔ Without this the wording could be unconditional. A qualifier printed on every brief is one
    // nobody reads, which would bury the case that matters — and this unit has shipped exactly that
    // failure before, in a gate whose closed state was permanent.
    const out = await brief();
    expect(out.json.repo.trust.publication ?? 'attested').toBe('attested');
    expectAbsentWithLiveMatcher(
      /straddled_rebuild|being assembled/,
      {
        forbidden: 'publication straddled_rebuild — a rebuild committed while this brief was being assembled',
        allowed: 'trust: 0.8 — heuristic, verify with code_intel_references',
      },
      out.md + out.agent + JSON.stringify(out.json),
      'an undisturbed brief warned about a rebuild that never happened',
    );
  });

  it('the generations either side of the read are what decides it, not the final state', async () => {
    // After the induced commit the graph is at generation 2 and entirely self-consistent: a brief
    // regenerated now must come back clean. If it did not, the straddle would be sticky — a state
    // the reader could never clear, which is the same as a permanently-closed gate.
    commitInto = repo;
    await brief();
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    let gen;
    try { gen = db.get('SELECT generation FROM graph_generation').generation; } finally { db.close(); }
    expect(gen, 'the induced commit must really have moved the generation').toBeGreaterThan(1);

    // ⚠ The manifest still names the PREVIOUS generation, because the commit above bypassed the
    // orchestrator — so the honest answer for a clean re-read is a mismatch, not attestation. What
    // must NOT survive is the straddle: that was a property of one read, and the read is over.
    const out = await brief();
    expectAbsentWithLiveMatcher(
      /straddled_rebuild/,
      {
        forbidden: 'publication straddled_rebuild — a rebuild committed while this brief was being assembled',
        allowed: 'publication generation_mismatch — this graph\'s contents could not be verified',
      },
      out.md,
      'the straddle outlived the read it describes',
    );
  });
});
