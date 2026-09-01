// ⛔ A CONVERGED LEDGER LEFT NO WORK — AND THAT IS NOT THE SAME AS "COMPLETE".
//
// The C++ provider used to answer a converged resume with `already_collected`, `complete: true`,
// `status: 'ok'` and a message saying the graph still holds their evidence. The witness behind
// that sentence is `verifiedEdges > 0 && intelRecords > 0` over GLOBAL counts, so one unrelated
// surviving edge licensed a ledger claiming hundreds of other files. Sand Castle, 2026-08-20:
// `recordsImported 0 · resumedFrom 200` while the graph held zero LSP edges — "every field a
// caller could check read as success".
//
// It now refuses: partial status, `complete: false`, NO authoritative note, which is what makes
// the summary emit ZERO_FILES_CAUSE_UNKNOWN with authority `none`.
//
// ⚠ NO REAL CLANGD. The refusal returns BEFORE the language server starts, which is the whole
// point of where it sits — so this asserts the startup seam was never reached instead of waiting
// on a toolchain. The positive control below proves the seam is still reachable, so a permanently
// broken spawn cannot make these pass.
//
// ⚠ THIS DOES NOT VALIDATE THE LEDGER'S DECISION. Unrelated global evidence can still make it skip
// work that should have been recollected — an OPEN defect, recorded in
// docs/evidence/typed-zero-reason/OPEN-DEFECT-ledger-witness-is-global.md. These tests assert only
// that the resulting zero does not masquerade as completion.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCppClangdProvider } from '../../../mcp/stdio/code-intel/providers/cpp-clangd.js';
import { prepareCompileDb, enumerateFirstParty } from '../../../mcp/stdio/code-intel/compile-db.js';
import { writeLedger, readLedger, graphEvidenceWitness } from '../../../mcp/stdio/code-intel/collect-ledger.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { ensureCodeIntelRecordsTable } from '../../../mcp/stdio/storage/schema.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repoRoot;
let startupCount;

/**
 * A spawn seam that COUNTS invocations and then refuses, instead of launching clangd.
 *
 * ⛔ IT THROWS ON PURPOSE, AND THE SENTINEL MATTERS. `await client.start()` (cpp-clangd.js:362) is
 * NOT wrapped in a try/catch, so a dummy process that exits immediately would surface as some
 * unrelated startup exception — and a positive control that "passes" by catching an arbitrary
 * error proves nothing about which seam was reached. Counting first and then throwing a named
 * sentinel makes the control's own mechanism explicit: the test asserts it saw THIS error, not
 * merely that something failed.
 *
 * The refusal tests never reach this function at all, which is itself part of what they assert.
 */
const SPAWN_SENTINEL = 'APG_TEST_SPAWN_SEAM_REACHED';
const countingSpawn = () => {
  startupCount += 1;
  const err = new Error(SPAWN_SENTINEL);
  err.code = SPAWN_SENTINEL;
  throw err;
};

beforeEach(() => {
  startupCount = 0;
  repoRoot = mkdtempSync(join(tmpdir(), 'apg-converged-'));
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, 'src', 'a.cpp'), 'int alpha(int x) { return x + 1; }\n');
  const posix = repoRoot.replace(/\\/g, '/');
  writeFileSync(join(repoRoot, 'compile_commands.json'), JSON.stringify(
    [{ directory: posix, file: `${posix}/src/a.cpp`, command: 'clang++ -std=c++17 -c src/a.cpp' }], null, 2));
  for (const args of [['init', '-q'], ['config', 'user.email', 'c@c'], ['config', 'user.name', 'c'], ['add', '-A'], ['commit', '-qm', 'x']]) {
    execFileSync('git', args, { cwd: repoRoot });
  }
});

afterEach(() => {
  if (repoRoot) { try { rmSync(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

/** Write a ledger claiming every enumerated file, under the REAL compile-DB hash. */
function convergeLedger() {
  // ⚠ THE REAL FIELDS, read from the provider rather than guessed. My first draft invented
  // `compileCommandsPath ?? dbPath` and a `collectCpp` export; the provider actually enumerates
  // from `compileDb.normalizedPath` (cpp-clangd.js:183) and hashes as `prep.dbHash`. A fixture
  // built on an imagined API tests nothing, and would have failed for a reason unrelated to the
  // property under test.
  const prepared = prepareCompileDb({ projectRoot: repoRoot });
  const enumerated = enumerateFirstParty(prepared.normalizedPath, repoRoot, { maxFiles: 200 });
  // The enumeration must actually have found the corpus file, or every later assertion is about
  // an empty population and passes vacuously.
  expect(enumerated.files.length, 'the fixture corpus must enumerate at least one file').toBeGreaterThan(0);
  // ⛔ writeLedger SWALLOWS ITS ERRORS and returns a boolean. Ignoring it — which my first version
  // did — means a failed write leaves no ledger, the resume finds nothing to skip, and the
  // precondition fails for a reason that has nothing to do with the property under test. The same
  // unchecked-return class as everything else corrected during this pause.
  // `version` is supplied by writeLedger itself (LEDGER_VERSION), so it is deliberately not passed.
  const wrote = writeLedger(repoRoot, { dbHash: prepared.dbHash, collected: new Set(enumerated.files) }, new Date().toISOString());
  expect(wrote, 'the ledger must actually have been written').toBe(true);
  return { prepared, enumerated };
}

const collect = () => createCppClangdProvider({ spawn: countingSpawn })
  .collect({ projectRoot: repoRoot, scope: 'all', operations: ['definitions'] });

/**
 * ⛔ PROVE THE DISPUTED MECHANISM WAS ACTUALLY ENGAGED, before asserting anything about the result.
 *
 * `startupCount === 0` plus a partial envelope is a strong signal and still not proof: the provider
 * has other early returns (`compile_db_all_filtered`, `no_files`) that could produce a similar
 * shape for an entirely different reason. Without these checks the test could pass while the
 * converged-resume branch was never involved — which is the failure mode of every fixture I have
 * had corrected during this pause.
 *
 * @returns the enumerated claimed population, captured rather than retyped.
 */
function assertConvergedPrecondition(prepared, enumerated) {
  const witness = graphEvidenceWitness(repoRoot);
  expect(witness, 'the global witness must exist, or the ledger resets for the wrong reason').toBeTruthy();
  expect(witness.verifiedEdges).toBeGreaterThan(0);
  expect(witness.intelRecords).toBeGreaterThan(0);

  const ledger = readLedger(repoRoot, prepared.dbHash, witness);
  const claimed = [...ledger.collected];
  expect(claimed.length, 'the ledger must be UPHELD by the unrelated residue, not reset').toBe(enumerated.files.length);
  expect(claimed.length).toBeGreaterThan(0);
  // The residue is unrelated BY CONSTRUCTION, asserted against the real member rather than a
  // literal path this fixture invents.
  expect(claimed).not.toContain('vendor/unrelated.cpp');
  return claimed;
}

/**
 * Seed the GLOBAL residue the current witness asks for: at least one LSP_VERIFIED edge and at
 * least one code-intel record, anywhere in the graph.
 *
 * ⛔ MY FIRST VERSION OF THIS FUNCTION SEEDED NOTHING. It created `.aify-graph/` and returned a
 * path, never opening a database or inserting a row, so `graphEvidenceWitness()` returned null,
 * the ledger reset, the remainder was non-empty and the branch under test was never reached. Every
 * assertion below would have failed for a reason unrelated to the property. Review caught it by
 * reading; I could not have caught it by running, because running is paused.
 *
 * ⚠ THE EVIDENCE IS DELIBERATELY UNRELATED to the enumerated compile-DB member the ledger claims.
 * That member's REPRESENTATION is owned by `enumerateFirstParty` and the normalized compile DB —
 * it may be absolute — so this fixture never retypes it as a literal. `assertConvergedPrecondition`
 * captures the real value and asserts the residue is not in it. Retyping a path here would drag
 * the path-normalization trap into the fixture prose. The residue lives in
 * `vendor/unrelated.cpp`. That is not sloppiness — it is the
 * OPEN DEFECT in fixture form: unrelated global residue is *sufficient* for the current witness,
 * which is exactly why a converged resume cannot be trusted to mean "complete".
 * See docs/evidence/typed-zero-reason/OPEN-DEFECT-ledger-witness-is-global.md
 */
function seedUnrelatedGlobalResidue() {
  mkdirSync(join(repoRoot, '.aify-graph', 'code-intel'), { recursive: true });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  for (const id of ['u1', 'u2']) {
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('${id}','Function','f${id}','vendor/unrelated.cpp',1,1,'cpp',1,'{}')`);
  }
  db.run(`INSERT OR IGNORE INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
          VALUES ('u1','u2','CALLS','vendor/unrelated.cpp',1,1,'LSP_VERIFIED','clangd')`);
  ensureCodeIntelRecordsTable(db);
  db.run(`INSERT INTO code_intel_records (collection_id,kind,language,symbol_id,qname,file,raw)
          VALUES ('c1','references','cpp','s1','q1','vendor/unrelated.cpp','{}')`);
  db.close();
}

describe('a converged C++ resume refuses to claim completion', () => {
  it('⛔ it does NOT start a language server', async () => {
    const { prepared, enumerated } = convergeLedger();
    seedUnrelatedGlobalResidue();
    assertConvergedPrecondition(prepared, enumerated);
    await collect();
    expect(startupCount, 'the refusal must return before clangd starts').toBe(0);
  });

  it('⛔ POSITIVE CONTROL: a NONEMPTY remainder DOES reach the startup seam', async () => {
    // Without this, a permanently broken or disabled spawn would satisfy the assertion above while
    // proving nothing. The seam must be live for its silence to mean anything.
    //
    // The rejection is EXPECTED and NAMED: reaching the seam is the property, and collection
    // completing is not. Asserting the sentinel specifically stops an unrelated failure — a broken
    // fixture, a missing compile DB — from being read as "the seam was reached".
    await expect(collect()).rejects.toThrow(SPAWN_SENTINEL);
    expect(startupCount, 'a real remainder must still spawn').toBeGreaterThan(0);
  });

  it('⛔ the envelope is PARTIAL, never ok', async () => {
    const { prepared, enumerated } = convergeLedger();
    seedUnrelatedGlobalResidue();
    assertConvergedPrecondition(prepared, enumerated);
    const res = await collect();
    expect(res.status).toBe('partial');
  });

  it('⛔ complete is FALSE and present — omission would let a consumer default it to true', async () => {
    const { prepared, enumerated } = convergeLedger();
    seedUnrelatedGlobalResidue();
    assertConvergedPrecondition(prepared, enumerated);
    const res = await collect();
    expect(res.session).toHaveProperty('complete');
    expect(res.session.complete).toBe(false);
  });

  it('⛔ NO authoritative note is emitted — silence is what produces UNKNOWN', async () => {
    // `already_collected` would claim what the witness cannot authorize; `no_files` would be a
    // different wrong object, since the requested scope was not empty — the ledger emptied it.
    const { prepared, enumerated } = convergeLedger();
    seedUnrelatedGlobalResidue();
    assertConvergedPrecondition(prepared, enumerated);
    const res = await collect();
    const codes = (res.notes ?? []).map((n) => n.code);
    expect(codes).not.toContain('already_collected');
    expect(codes).not.toContain('no_files');
  });

  it('⛔ NEGATIVE CONTROL: with the residue ABSENT the ledger resets and the seam IS reached', async () => {
    // The refusal must be GATED on the witness, not unconditional. Same converged ledger, no
    // surviving evidence at all: `graphEvidenceWitness()` returns null, `readLedger` resets, the
    // remainder is non-empty again, and collection proceeds to the startup seam.
    //
    // ⚠ This is also the honest shape of the OPEN defect. The ledger resets here because NOTHING
    // survived — not because anything checked whether *these* files' evidence survived. One
    // unrelated edge (the case above) is enough to stop the reset.
    convergeLedger();
    await expect(collect()).rejects.toThrow(SPAWN_SENTINEL);
    expect(startupCount, 'no surviving evidence must reset the ledger and reach the seam').toBeGreaterThan(0);
  });

  it('⛔ the denominators travel with the refusal', async () => {
    const { prepared, enumerated } = convergeLedger();
    seedUnrelatedGlobalResidue();
    assertConvergedPrecondition(prepared, enumerated);
    const res = await collect();
    expect(res.session.filesProcessed).toBe(0);
    expect(res.session.remaining).toBe(0);
    expect(res.session.resumedFrom).toBeGreaterThan(0);
  });
});

// ⛔ THE WRAPPER LEVEL — where an agent actually meets this.
//
// Everything above tests the PROVIDER. These two assertions were owed separately by review,
// because the provider getting it right does not establish that the summary a caller receives says
// the same thing. No clangd starts: the provider's refusal returns before spawn, so the real
// wrapper can be driven here without a language server.
describe('the wrapper reports the refusal as UNKNOWN, with its denominator', () => {
  it('⛔ index.zeroFilesProcessed is ZERO_FILES_CAUSE_UNKNOWN with authority none', async () => {
    const { graphCollectCodeIntel } = await import('../../../mcp/stdio/query/verbs/collect_code_intel.js');
    const { prepared, enumerated } = convergeLedger();
    seedUnrelatedGlobalResidue();
    assertConvergedPrecondition(prepared, enumerated);

    const res = await graphCollectCodeIntel({
      repoRoot, language: 'cpp', scope: 'all', operations: ['definitions'],
    });
    expect(res.index, 'the index block must exist or this asserts on nothing').toBeTruthy();
    expect(res.index.zeroFilesProcessed).toBeTruthy();
    expect(res.index.zeroFilesProcessed.reason).toBe('ZERO_FILES_CAUSE_UNKNOWN');
    expect(res.index.zeroFilesProcessed.authority).toBe('none');
    // The denominator travels with the reason — a cause without a population is half an answer.
    expect(res.index.filesProcessed).toBe(0);
  });

  it('⛔ the response carries NO "already converged" prose reasserting completion', async () => {
    // `invalidationSkipped` is gated on status === 'ok' (importer.js:677), so `partial` suppresses
    // it by construction TODAY. Review's point: reading that gate establishes present structure,
    // not a durable contract — a future importer refactor could reintroduce the contradiction while
    // every provider test stayed green. So the absence is asserted at the wrapper, with a live
    // matcher proving the pattern can fire.
    const { graphCollectCodeIntel } = await import('../../../mcp/stdio/query/verbs/collect_code_intel.js');
    const { prepared, enumerated } = convergeLedger();
    seedUnrelatedGlobalResidue();
    assertConvergedPrecondition(prepared, enumerated);

    const res = await graphCollectCodeIntel({
      repoRoot, language: 'cpp', scope: 'all', operations: ['definitions'],
    });
    expectAbsentWithLiveMatcher(
      /already converged/i,
      {
        forbidden: 'collection walked no files (already converged)',
        allowed: 'collection walked no files; cause unknown',
      },
      JSON.stringify(res),
      'no field may reassert completion once the provider has refused to claim it',
    );
  });
});
