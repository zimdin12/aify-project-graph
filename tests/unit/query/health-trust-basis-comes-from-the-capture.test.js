// ⛔ A SURVIVING MUTANT WROTE THIS FILE.
//
// Folding the unresolved-ref read into graph_health's pinned capture was committed with parity
// tests proving the projection classifies identically, and a mutant that reverted health to
// `storedRefs = null` — sending it back to the manifest SAMPLE — passed every one of them.
//
// The reason is the shape this session keeps producing: the fixture had no unresolved refs, so the
// captured path returned explainTrustExclusions([]) === null and the fallback path returned null
// too. Both answers were null, so nothing discriminated, and "wired" stood in for "tested" again.
//
// ⭐ SO THIS FIXTURE MAKES THE TWO SOURCES DISAGREE ON PURPOSE. The table holds a population the
// manifest sample does not, and the assertion is on the number only one of them can produce —
// proof by discrimination rather than by agreement.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { replaceUnresolvedRefs } from '../../../mcp/stdio/storage/unresolved-refs.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repo;
const graphDir = () => join(repo, '.aify-graph');
const dbPath = () => join(graphDir(), 'graph.sqlite');

// Trust-RELEVANT refs: a relation the exclusion policy does not exclude, so they reach the
// denominator rather than being filtered before it.
// ⚠ from_id IS REQUIRED, and the schema said so rather than letting it through. The CHECK enforces
// one source identity and one destination identity; my first fixture had neither source field and
// every insert failed with "CHECK constraint failed: from_id IS NOT NULL OR from_target IS NOT
// NULL". The constraint doing its job on a test is the constraint working.
const tableRefs = (n) => Array.from({ length: n }, (_, i) => ({
  from_id: `src/gen${i}.js::caller${i}`,
  relation: 'CALLS',
  source_file: `src/gen${i}.js`,
  target: `unresolvedTarget${i}`,
  source_line: i + 1,
  extractor: 'tree-sitter',
}));

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-trustbasis-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.js'),
    'export function target() { return 1; }\nexport function caller() { return target(); }\n');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
  await ensureFresh({ repoRoot: repo });
});

afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

/**
 * Put 7 refs in the TABLE and a 2-ref sample in the manifest, so the two possible sources of the
 * trust basis produce different, checkable numbers.
 *
 * ⚠ The manifest's `generation` is preserved. Rewriting it without one would make the graph read as
 * unattested and change what health reports for reasons unrelated to this test.
 */
function divergeTableFromManifest() {
  const db = openDb(dbPath());
  try { replaceUnresolvedRefs(db, tableRefs(7)); } finally { db.close(); }

  const p = join(graphDir(), 'manifest.json');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  m.dirtyEdges = tableRefs(2);
  m.dirtyEdgeCount = 2;
  writeFileSync(p, JSON.stringify(m));
}

describe("graph_health's trust basis comes from the captured table, not the manifest sample", () => {
  it('⛔ the basis counts the TABLE population, not the manifest sample', async () => {
    divergeTableFromManifest();
    const { graphHealth } = await import('../../../mcp/stdio/query/verbs/health.js');
    const out = await graphHealth({ repoRoot: repo });

    expect(out.trustBasis, 'a diverged fixture must produce a basis at all').toBeTruthy();
    expect(out.trustBasis.total_unresolved,
      'health explained its denominator from the manifest sample, not the captured table')
      .toBe(7);
  });

  it('⛔ and it does not describe itself as computed over a SAMPLE', async () => {
    // The fallback path stamps `computed_over: 'SAMPLE'` and a sample_warning saying the graph has
    // no unresolved_refs table. On a graph that HAS one, both are false statements.
    divergeTableFromManifest();
    const { graphHealth } = await import('../../../mcp/stdio/query/verbs/health.js');
    const out = await graphHealth({ repoRoot: repo });

    expect(out.trustBasis.computed_over).toBeUndefined();
    expectAbsentWithLiveMatcher(
      /has no unresolved_refs table|computed over the manifest/,
      {
        forbidden: "this graph has no unresolved_refs table (indexed before it existed), so this breakdown was computed over the manifest's 2-edge SAMPLE",
        allowed: 'trust_relevant: 7',
      },
      JSON.stringify(out.trustBasis),
      'a graph WITH the table was told it predates the table',
    );
  });

  it('POSITIVE CONTROL: a graph with NO table really does fall back, and says so', async () => {
    // ⛔ Without this the assertions above could pass against a fallback path that is simply dead —
    // a branch nothing can reach proves nothing about the branch that replaced it. Dropping the
    // table must still produce the sample wording, so the discrimination above is real.
    const db = openDb(dbPath());
    try { db.exec('DROP TABLE unresolved_refs'); } finally { db.close(); }
    const p = join(graphDir(), 'manifest.json');
    const m = JSON.parse(readFileSync(p, 'utf8'));
    m.dirtyEdges = tableRefs(2);
    m.dirtyEdgeCount = 2;
    writeFileSync(p, JSON.stringify(m));

    const { graphHealth } = await import('../../../mcp/stdio/query/verbs/health.js');
    const out = await graphHealth({ repoRoot: repo });
    expect(out.trustBasis?.computed_over, 'the legacy fallback is unreachable, so nothing above discriminates')
      .toBe('SAMPLE');
    expect(out.trustBasis.total_unresolved).toBe(2);
  });

  it('⛔ a table that EXISTS but cannot be read says so under its own wording', async () => {
    // ⛔ UNKNOWN MUST NOT WEAR THE KNOWN CASE'S CLOTHES. My first version of the capture caught the
    // read failure and returned null — and null means "no table, a legacy graph", so a corrupt
    // table would have been reported with the sample wording above, telling the reader this graph
    // was indexed before a table it demonstrably has.
    //
    // Renaming the column makes the projection fail while the table plainly exists.
    divergeTableFromManifest();
    const db = openDb(dbPath());
    try { db.exec('ALTER TABLE unresolved_refs RENAME COLUMN relation TO relation_x'); }
    finally { db.close(); }

    const { graphHealth } = await import('../../../mcp/stdio/query/verbs/health.js');
    const out = await graphHealth({ repoRoot: repo });

    expect(out.trustBasis?.classification).toBe('UNREADABLE');
    expect(out.trustBasis.consequence).toMatch(/EXISTS but could not be read/);
    expect(out.trustBasis.consequence).toMatch(/NOT the same as a graph indexed before the table/);
    expectAbsentWithLiveMatcher(
      /computed over the manifest|indexed before it existed/,
      {
        forbidden: "this graph has no unresolved_refs table (indexed before it existed)",
        allowed: 'the unresolved_refs table EXISTS but could not be read',
      },
      JSON.stringify(out.trustBasis),
      'a read failure was reported as a legacy graph',
    );
  });
});
