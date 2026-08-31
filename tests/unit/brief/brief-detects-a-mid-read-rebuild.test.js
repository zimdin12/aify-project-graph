// ⛔ DETECTION THAT DOES NOT GATE PUBLICATION IS A LABEL ON A BAD ARTIFACT.
//
// generateBrief is the one authority reader the single-capture shape does not reach, and the reason
// is a substrate cycle rather than an ordering nobody found:
//
//   docPaths            <- the DATABASE
//   documentRecency()   <- SHELLS OUT TO GIT for exactly those paths
//   linkedDocumentCandidates / readFirst <- the DATABASE AGAIN, using that recency
//
// DB -> git -> DB cannot be wrapped in one snapshot without holding a WAL reader open across a
// subprocess, which is the cost captureExistingSnapshot exists to avoid.
//
// ⛔ MY FIRST ANSWER WAS WRONG AND REVIEW CAUGHT IT. It detected the straddle correctly and then
// WROTE THE MIXED BRIEF into `.aify-graph` with a warning in its trust line. That publishes a
// known-invalid artifact into the directory every other tool treats as authoritative, and delegates
// the fix to whoever next reads the prose carefully enough to notice it. "It says so in the output"
// is not a gate.
//
// ⇒ Assemble, validate, publish only if the generation held. A straddled attempt is DISCARDED whole
// and retried once — the retry runs AFTER the commit that spoiled the first pass, so one rebuild
// stabilises it. Straddle twice and NOTHING is written: an existing brief stays byte-for-byte as it
// was, and if there was none there still is none. A stale brief that honestly describes an earlier
// graph beats a fresh one that describes no graph.
//
// ⚠ WHY THE COMMIT IS INDUCED FROM documentRecency AND NOT FROM A TIMER. A timer makes the test's
// own scheduling the thing under test — it passes or fails on whether setTimeout landed inside the
// window, which is not a property of the code. Standing in for the git call puts the commit at the
// exact seam the straddle exists for: after the first DB reads, before the second.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// How many further assembly passes should commit a new generation. Set per test: 1 induces a single
// straddle (which the retry must absorb), a large number induces one on every attempt.
let straddlesRemaining = 0;
let commitInto = null;
let crossings = 0;

vi.mock('../../../mcp/stdio/brief/extract.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    documentRecency: (repoRoot, paths) => {
      crossings += 1;
      if (commitInto && straddlesRemaining > 0) {
        straddlesRemaining -= 1;
        const writer = openDb(join(commitInto, '.aify-graph', 'graph.sqlite'));
        try { writer.run('UPDATE graph_generation SET generation = generation + 1'); }
        finally { writer.close(); }
      }
      return real.documentRecency(repoRoot, paths);
    },
  };
});

let repo;
const ARTIFACTS = ['brief.md', 'brief.agent.md', 'brief.onboard.md', 'brief.plan.md', 'brief.json'];
const graphDir = () => join(repo, '.aify-graph');
const snapshotArtifacts = () => Object.fromEntries(ARTIFACTS
  .filter((n) => existsSync(join(graphDir(), n)))
  .map((n) => [n, readFileSync(join(graphDir(), n), 'utf8')]));
const removeArtifacts = () => {
  for (const n of ARTIFACTS) rmSync(join(graphDir(), n), { force: true });
};

beforeEach(async () => {
  commitInto = null;
  straddlesRemaining = 0;
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

const generate = async () => {
  const { generateBrief } = await import('../../../mcp/stdio/brief/generator.js');
  return generateBrief({ repoRoot: repo });
};

const publishedGeneration = () => {
  const db = openDb(join(graphDir(), 'graph.sqlite'));
  try { return db.get('SELECT generation FROM graph_generation').generation; } finally { db.close(); }
};

describe('a brief is published only if it describes one graph', () => {
  it('the stand-in is actually on the path the brief takes', async () => {
    // ⛔ THE INSTRUMENT CONTROL, AND IT COMES FIRST. If generateBrief stopped calling
    // documentRecency — or called it through a binding this mock does not intercept — every case
    // below would pass by never inducing anything, and a clean publish would stand as proof that
    // nothing straddled. A mock nobody reaches is a test that cannot fail.
    await generate();
    expect(crossings, 'the brief never crossed the git seam this test induces from')
      .toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL: an undisturbed brief publishes on the first attempt', async () => {
    // ⛔ Without this the refusal could be permanent, and a gate whose open path is unreachable is
    // off rather than fail-closed. It also pins the ordinary cost at ONE assembly: a retry loop
    // that quietly assembled twice every time would pass every other case here.
    const out = await generate();
    expect(out.published).toBe(true);
    expect(out.attempts, 'the undisturbed path must not reassemble').toBe(1);
    expect(out.files_changed).toBeGreaterThan(0);
    expect(Object.keys(snapshotArtifacts()).sort()).toEqual([...ARTIFACTS].sort());
  });

  it('⛔ ONE induced straddle is absorbed by the retry, and what lands is clean', async () => {
    commitInto = repo;
    straddlesRemaining = 1;
    const out = await generate();

    expect(straddlesRemaining, 'the stand-in never fired, so nothing was induced').toBe(0);
    expect(out.published, 'a single rebuild must not cost the brief').toBe(true);
    expect(out.attempts, 'the first pass straddled and must have been discarded and redone').toBe(2);
    expect(publishedGeneration(), 'the induced commit must really have moved the generation')
      .toBeGreaterThan(1);

    // ⛔ WHAT LANDED MUST BE THE CLEAN SECOND PASS, NOT THE MIXED FIRST ONE. This is the assertion
    // the previous design could not make: it published the mixed output and merely described it.
    const files = snapshotArtifacts();
    expectAbsentWithLiveMatcher(
      /straddled_rebuild|read from two different graphs/,
      {
        forbidden: 'publication straddled_rebuild — a rebuild committed while this brief was being assembled',
        allowed: '- Trust: **strong**',
      },
      Object.values(files).join('\n'),
      'a mixed brief reached the canonical directory',
    );
  });

  it('⛔ REPEATED straddles publish nothing and leave a prior brief byte-for-byte', async () => {
    // The condition the retry cannot fix: a graph being rebuilt continuously. Refusing to overwrite
    // is the honest result, and "unchanged" has to mean unchanged — not rewritten with the same
    // content, and not truncated.
    // ⚠ ensureFresh DOES NOT WRITE BRIEFS, so the fixture starts with none — publish one first.
    // The guard below caught this: without it the comparison would have been {} against {}, passing
    // while proving nothing about preservation. An empty baseline is the classic vacuous verify.
    await generate();
    const before = snapshotArtifacts();
    expect(Object.keys(before).length, 'seed a prior brief, or this proves nothing').toBeGreaterThan(0);

    commitInto = repo;
    straddlesRemaining = 99;
    const out = await generate();

    expect(out.published).toBe(false);
    expect(out.straddledRebuild).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.files_changed).toBe(0);
    expect(out.reason, 'the refusal must say nothing was written').toMatch(/Nothing was written/);
    expect(snapshotArtifacts(), 'a prior brief must survive a refused regeneration untouched')
      .toEqual(before);
  });

  it('⛔ with NO prior brief, repeated straddles leave no canonical artifact at all', async () => {
    // The other half of "unchanged": absent must stay absent. A half-written or placeholder brief
    // would be worse than none, because everything downstream treats this directory as authoritative.
    removeArtifacts();
    expect(Object.keys(snapshotArtifacts()), 'the removal itself must have worked').toEqual([]);

    commitInto = repo;
    straddlesRemaining = 99;
    const out = await generate();

    expect(out.published).toBe(false);
    expect(Object.keys(snapshotArtifacts()), 'a refused assembly must not create anything')
      .toEqual([]);
  });

  it('the receipt carries the generations it saw, so a caller can say WHY', async () => {
    // ⛔ `files_changed: 0` alone is indistinguishable from "already up to date", which is exactly
    // the reading that would make a refusal invisible.
    commitInto = repo;
    straddlesRemaining = 99;
    const out = await generate();
    expect(Array.isArray(out.generations)).toBe(true);
    expect(out.generations.length, 'one pair per discarded attempt').toBe(2);
    for (const [start, end] of out.generations) {
      expect(start, 'a discarded attempt must have seen two different generations').not.toBe(end);
    }
  });
});

// ⛔ THE RECEIPT HAS TO REACH THE READER, OR IT IS COMPUTED AND DISCARDED AGAIN.
//
// generateBrief's refusal lands in `result.artifacts.briefs`, which is true and invisible: a reader
// scanning the top of a graph_index response sees that the call succeeded — and it did, the GRAPH
// is fine. What is not fine is that the brief on disk still describes an older graph while looking
// freshly regenerated. graph_index is also the ONE caller where this is likely, because a rebuild is
// exactly what makes an assembly straddle.
describe('graph_index surfaces a refused brief where it can be seen', () => {
  it('⛔ a refusal reaches nextAction, not only the artifacts sub-object', async () => {
    commitInto = repo;
    straddlesRemaining = 99;
    const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
    const out = await graphIndex({ repoRoot: repo });
    expect(out.artifacts.briefs.published, 'the fixture must actually have refused').toBe(false);
    expect(String(out.nextAction ?? ''), 'the refusal must be surfaced where a scanner looks')
      .toMatch(/brief was NOT regenerated/);
  });

  it('POSITIVE CONTROL: an undisturbed index adds no such note', async () => {
    // ⛔ Without this the note could be unconditional, and a warning on every index is one nobody
    // reads — which is the failure this note exists to avoid.
    const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
    const out = await graphIndex({ repoRoot: repo });
    expect(out.artifacts.briefs.published).toBe(true);
    expectAbsentWithLiveMatcher(
      /brief was NOT regenerated/,
      {
        forbidden: 'the brief was NOT regenerated — a rebuild committed during each assembly attempt',
        allowed: 'run graph_collect_code_intel — this rebuild dropped the [lsp✓] trust spine',
      },
      String(out.nextAction ?? ''),
      'a successful index warned about a refusal that never happened',
    );
  });
});
