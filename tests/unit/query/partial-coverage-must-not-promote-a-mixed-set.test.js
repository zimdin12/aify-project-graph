// ⛔ I REPAIRED THE MIXED-SET BRANCH AND AN EARLIER RETURN REACHED THE SAME FALSE CONCLUSION FIRST.
//
// 3a3ea33d stopped the TRUST banner calling a MIXED caller set a FLOOR — a floor is a LOWER BOUND,
// and heuristic edges resolve BY NAME, so a mixed set can be too LARGE as well as too small. That
// repair is real, and it is UNREACHABLE whenever compile-DB coverage is incomplete: the coverage
// branch returns "caller set is a FLOOR" before `allVerified` is ever computed.
//
// ⛔ AND PYTHON TAKES THAT PATH INTRINSICALLY. `pythonCoverage()` is `partial: true` by
// construction — duck typing and dynamic dispatch mean call resolution is never provably exhaustive
// — so every Python caller query hit the unrepaired branch. Its reason string then appends a SECOND
// floor instruction ("Treat the caller set as a FLOOR"), so the same false claim arrived twice.
//
// ⭐ THE MISS IS THE ONE I WAS WARNED TO EXPECT. Four earlier repairs of mine dropped a second
// property of what they fixed; the reviewer said to assume a fifth and this is it. I changed the
// branch I was looking at and never asked whether an EARLIER RETURN reached the same conclusion —
// "is the population you changed the population you named", applied to control flow rather than data.
//
// ⚠ AND MY OWN TESTS COULD NOT SEE IT, BECAUSE THEY MOCKED COVERAGE AS COMPLETE. A fixture that
// cannot enter the branch cannot test it. This file drives the REAL coverage provider by giving the
// collection a language whose coverage is genuinely partial.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { buildTrustLine } from '../../../mcp/stdio/query/lsp-evidence.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const verified = { provenance: 'LSP_VERIFIED', extractor: 'pyright#deadbeef' };
const heuristic = { provenance: 'EXTRACTED', extractor: 'tree-sitter' };
const git = (r, ...a) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8' }).trim();

/** A collection in `language`, index-ready and otherwise healthy. */
function insertCollection(db, commit, language) {
  db.run(
    `INSERT INTO code_intel_collections
       (collection_id, provider, provider_version, project_root, language, status,
        freshness_basis, freshness_value, compile_db_hash, indexed_commit,
        operations_json, collected_at)
     VALUES ('col-1',$provider,'0.1.0','/x',$language,'ok',
        'compile_db_hash','hash-A','hash-A',$commit,$ops,'2026-06-19T01:02:14.438Z')`,
    {
      commit, language, provider: language === 'python' ? 'py-pyright' : 'cpp-clangd',
      ops: JSON.stringify({
        references: { status: 'ok', count: 10 },
        _session: { indexReady: true, refsFoundSymbols: 6643, refsNotFoundSymbols: 0 },
      }),
    },
  );
}

describe('incomplete coverage does not promote a mixed caller set to a floor', () => {
  let repoRoot; let dbPath;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-cov-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
    git(repoRoot, 'init', '-q');
    git(repoRoot, 'config', 'user.email', 't@t');
    git(repoRoot, 'config', 'user.name', 'T');
    await writeFile(join(repoRoot, 'a.txt'), 'a');
    git(repoRoot, 'add', '.');
    git(repoRoot, 'commit', '-qm', 'one');
  });
  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win */ } });

  const line = async (language, edges) => {
    const head = git(repoRoot, 'rev-parse', 'HEAD');
    const db = openDb(dbPath);
    insertCollection(db, head, language);
    const out = String(await buildTrustLine({ edges, db, repoRoot }));
    db.close();
    return out;
  };

  it('★★★ THE REAL CASE: partial coverage + a MIXED set is not a floor', async () => {
    const out = await line('python', [verified, ...Array.from({ length: 10 }, () => heuristic)]);

    // ⛔ THE SUBJECT MUST BE IN THE STATE THE PROHIBITION IS ABOUT. Without this the assertion below
    // passes on any fixture that never enters the coverage branch — which is exactly how the
    // earlier tests missed this.
    expect(out, 'the coverage branch must actually have fired').toMatch(/coverage incomplete/i);
    expectAbsentWithLiveMatcher(
      /caller set is a FLOOR/,
      { forbidden: 'index coverage incomplete — caller set is a FLOOR, verify with rg',
        allowed: 'index coverage incomplete AND the result mixes 1 verified + 10 heuristic edges' },
      out,
      'a mixed set is not a lower bound, however incomplete the index is',
    );
  }, 60_000);

  it('★★★ AND THE SECOND FLOOR INSTRUCTION DOES NOT ARRIVE EITHER', async () => {
    // The Python coverage reason ends "Treat the caller set as a FLOOR", so embedding it verbatim
    // reintroduced the claim the sentence before it had just withdrawn. Two contradictory
    // instructions in one banner is what this whole arc keeps finding.
    const out = await line('python', [verified, ...Array.from({ length: 10 }, () => heuristic)]);

    expectAbsentWithLiveMatcher(
      /Treat the caller set as a FLOOR/,
      { forbidden: 'python_dynamic; Treat the caller set as a FLOOR; verify with rg',
        allowed: 'coverage incomplete: python_dynamic' },
      out,
      'the coverage note’s floor advice must not be quoted where it is false',
    );
  }, 60_000);

  it('★★★ THE DISCRIMINATING CONTROL: partial coverage + ALL VERIFIED is STILL a floor', async () => {
    // ⛔ THE ASSERTION THAT STOPS AN OVER-CORRECTION. Every edge here was compiler-resolved, so every
    // one is a real caller and only completeness is open — which is exactly what FLOOR means. A
    // repair that deleted every floor claim would pass both tests above and be wrong.
    const out = await line('python', [verified, verified]);

    expect(out).toMatch(/FLOOR/);
  }, 60_000);

  it('★★ THE INCOMPLETENESS IS STILL DISCLOSED — this is not a caveat deletion', async () => {
    // The easy way to remove a contradiction is to drop one side. Coverage being incomplete is TRUE
    // and load-bearing; only the floor promotion was wrong.
    const out = await line('python', [verified, ...Array.from({ length: 10 }, () => heuristic)]);

    expect(out).toMatch(/coverage incomplete/i);
    expect(out).toMatch(/verify/i);
  }, 60_000);

  it('★★ AND THE COMPLETE-COVERAGE PATH STILL REACHES THE REPAIRED BRANCH', async () => {
    // cpp with no compile DB present resolves complete-enough that the later branch runs; this is
    // the control proving 3a3ea33d's repair is still live and was not superseded by the fix above.
    const out = await line('cpp', [verified, ...Array.from({ length: 10 }, () => heuristic)]);

    expect(out).toMatch(/NEITHER direction|coverage incomplete/i);
  }, 60_000);
});
