// ⛔ THE DENOMINATOR COUNTED FILES THE CORPUS EXCLUDES — AND I TOLD the field test IT WOULD FIX ITSELF.
//
// They flagged `files_eligible: 579` as counting excluded trees. I replied it would "become correct
// as a side effect" of fixing the collector's enumeration, and would be "re-derived rather than
// adjusted". THAT WAS WRONG. The enumerator decides what to WALK; this number counts what is
// already in `nodes`. Two populations, two routes, and fixing one does nothing to the other.
//
// ⚠ THE SURVIVING ROUTE IS RESOLUTION, NOT ENUMERATION. A language server resolves a first-party
// reference to a declaration living in `node_modules/typescript/lib/lib.es5.d.ts`, and the record
// names where the declaration actually is. Measured at 80fd7bf: 15 collected files outside the
// corpus, every one a `.d.ts` — lib.es5, lib.dom, ajv/dist/core, vitest/dist/node.
//
// ⇒ Those nodes are HONEST. You cannot describe a reference to `Array.prototype.map` without naming
// the file that declares it. They are simply not part of the population a coverage claim is about,
// and counting them inflates the denominator in the safe-looking direction: coverage reads LOWER
// than it is, so nothing ever collides with the error.
//
// After the fix, on this repo: 594 -> 556 — and 556 is exactly what the file enumerator reports
// independently. Two instruments, two routes, same number.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eligibleFileCount } from '../../../mcp/stdio/query/verbs/collect_code_intel.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

const TS = ['.ts', '.js'];
let root;
afterEach(async () => {
  if (root) { try { await rm(root, { recursive: true, force: true }); } catch { /* win lock */ } }
  root = undefined;
});

/** A graph holding first-party files plus resolution targets outside the corpus. */
async function graphWith(paths, { gitignore = 'reference/\n' } = {}) {
  root = await mkdtemp(join(tmpdir(), 'apg-denom-'));
  await mkdir(join(root, '.aify-graph'), { recursive: true });
  await writeFile(join(root, '.gitignore'), gitignore);
  const db = openDb(join(root, '.aify-graph', 'graph.sqlite'));
  paths.forEach((p, i) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,'Function',$id,$f,1,1,'typescript',1,'{}')`, { id: `n${i}`, f: p }));
  return db;
}

describe('the coverage denominator counts the corpus, not the graph', () => {
  it('★★★ excludes resolution targets, keeps first-party — both halves from one graph', async () => {
    // ⛔ BOTH DIRECTIONS FROM ONE INPUT. A function returning 0 satisfies "excluded files are not
    // counted", and a function returning everything satisfies nothing at all. Asserting the exact
    // number is what distinguishes them.
    const db = await graphWith([
      'src/a.ts', 'src/b.ts', 'mcp/c.js',                       // corpus
      'node_modules/typescript/lib/lib.es5.d.ts',               // resolution target
      'node_modules/vitest/dist/node.d.ts',                     // resolution target
      'reference/agent-code-intel/bin/bootstrap.js',            // gitignored tree
    ]);
    expect(eligibleFileCount(db, { exts: TS, repoRoot: root }), 'only the three first-party files')
      .toBe(3);
    db.close();
  }, 30_000);

  it('★★★ the exclusion is DERIVED from the repo, not a list in this codebase', async () => {
    // The discriminating case: the same `reference/` path, with and without the .gitignore entry
    // that excludes it. A hardcoded rule gives one answer to both.
    const files = ['src/a.ts', 'reference/vendored/x.ts'];
    const db1 = await graphWith(files);
    expect(eligibleFileCount(db1, { exts: TS, repoRoot: root }), 'gitignored -> excluded').toBe(1);
    db1.close();

    const db2 = await graphWith(files, { gitignore: '# nothing ignored\n' });
    expect(eligibleFileCount(db2, { exts: TS, repoRoot: root }), 'not ignored -> first-party').toBe(2);
    db2.close();
  }, 30_000);

  it('★★★ NULL when nothing is eligible, never 0', async () => {
    // ⛔ A ZERO DENOMINATOR MAKES ANY RATIO READ AS TOTAL COVERAGE. That is the failure this whole
    // number exists to prevent, so the empty case must be UNKNOWN rather than a number that
    // divides. Health tests `complete !== true`, so null warns; 0 would silently assert.
    const db = await graphWith(['node_modules/only/x.ts']);
    expect(eligibleFileCount(db, { exts: TS, repoRoot: root })).toBeNull();
    db.close();
  }, 30_000);

  it('★★★ an unknown language yields null rather than a confident wrong count', async () => {
    const db = await graphWith(['src/a.ts']);
    expect(eligibleFileCount(db, { exts: [], repoRoot: root })).toBeNull();
    expect(eligibleFileCount(db, { exts: undefined, repoRoot: root })).toBeNull();
    db.close();
  }, 30_000);
});
