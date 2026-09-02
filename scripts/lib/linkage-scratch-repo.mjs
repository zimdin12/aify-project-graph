// A scratch repository holding one class's corpus — materialise, index, tear, dispose.
//
// An object because it has identity and state (a directory on disk, a graph, a publication state).
// The scoring and reporting around it stay pure functions.
//
// ⛔ PATH CONTRACT. The corpus lives at `corpus/weights.cpp`, and every prompt names `src/weights.cpp`
// ("Is it safe to delete computeWeight from src/weights.cpp?"). Materialising to the corpus path
// would point the agent at a file that does not exist and would score as a routing failure that was
// really a harness bug. Files land under `src/`.
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const FIXTURE = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../tests/fixtures/linkage-scope');

export class ScratchRepo {
  #dir = null;

  constructor(groundTruthClass) {
    this.klass = groundTruthClass;
  }

  get dir() { return this.#dir; }

  /** Copy this class's corpus files into a fresh git repo under src/. */
  materialise() {
    this.#dir = mkdtempSync(join(tmpdir(), `apg-linkage-${this.klass.id.slice(0, 2)}-`));
    mkdirSync(join(this.#dir, 'src'), { recursive: true });
    const missing = [];
    for (const rel of this.klass.files ?? []) {
      const from = join(FIXTURE, rel);
      if (!existsSync(from)) { missing.push(rel); continue; }
      copyFileSync(from, join(this.#dir, 'src', basename(rel)));
    }
    // An unrunnable class is REPORTED, never skipped quietly: a dropped class shrinks the population
    // without shrinking the claim.
    if (missing.length) throw new Error(`corpus files missing for ${this.klass.id}: ${missing.join(', ')}`);

    const git = (...a) => execFileSync('git', ['-C', this.#dir, ...a], { encoding: 'utf8', stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 'linkage@fixture');
    git('config', 'user.name', 'linkage fixture');
    git('add', '-A');
    git('commit', '-qm', `corpus for ${this.klass.id}`);
    return this;
  }

  /** Build the graph. Only the graph arm pays this; the grep arm never sees an index. */
  async index() {
    const { ensureFresh } = await import('../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot: this.#dir });
    return this;
  }

  /**
   * Tear the publication state: move the manifest's generation away from the database's, which
   * classifyAttestation (publication-schema.js:224) reports as GENERATION_MISMATCH.
   *
   * ⚠ MEASURED, NOT ASSUMED (tests/unit/ab/tearing-changes-verb-output.test.js): this moves
   * graph_health and leaves graph_callers BYTE-IDENTICAL. The key's C6 estimand says the same. So a
   * torn graph is not a treatment that changes the caller answer — C6 asks whether a natural task
   * REACHES a gate-carrying route at all.
   */
  async tear() {
    const manifestPath = join(this.#dir, '.aify-graph', 'manifest.json');
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    m.generation = (typeof m.generation === 'number' ? m.generation : 0) + 41;
    writeFileSync(manifestPath, JSON.stringify(m, null, 2), 'utf8');

    // ⛔ VERIFY THE TREATMENT APPLIED, AND CARRY THE PROOF. A C6 cell that was never actually torn is
    // byte-identical to C4 and scores as a result — an inert mutation is the same green. So the
    // attestation is read back through the product's own classifier and returned, and a row without
    // this fact is visibly invalid rather than quietly wrong.
    const { openExistingDb } = await import('../../mcp/stdio/storage/db.js');
    const { readGraphGeneration, classifyAttestation } = await import('../../mcp/stdio/storage/publication-schema.js');
    const db = openExistingDb(join(this.#dir, '.aify-graph', 'graph.sqlite'));
    const dbGeneration = readGraphGeneration(db);
    db.close?.();
    const attestation = classifyAttestation({ dbGeneration, manifestGeneration: m.generation });
    if (attestation !== 'generation_mismatch') {
      throw new Error(`tear did not take: attestation is ${attestation}, expected generation_mismatch`);
    }
    return attestation;
  }

  /** Did indexing actually produce a graph? An unindexed "graph arm" is a mislabelled grep arm. */
  isIndexed() {
    return existsSync(join(this.#dir, '.aify-graph', 'graph.sqlite'));
  }

  dispose() {
    if (this.#dir) rmSync(this.#dir, { recursive: true, force: true });
    this.#dir = null;
  }
}
