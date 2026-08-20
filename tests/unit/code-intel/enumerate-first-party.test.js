// ⛔ THE COLLECTOR WALKED A GITIGNORED TREE AND PUT 1,196 NODES IN IT.
//
// `reference/` is `.gitignore:12` on this project. The sweep excludes it — a92a66a had taken it
// to ZERO nodes two hours before. Then a code-intel collection re-created them, because the
// collector never asked the sweep's question. Measured at 67bfffe:
//
//     1,196 nodes under reference/     1,172 Symbol + 24 File, ALL language "typescript"
//     1,370 of 4,487 LSP edges (30.5%) point into reference/
//       205 of 4,487 (4.6%) into node_modules/
//     → 35.1% of the trust spine was compiler-verified evidence about EXCLUDED files
//
// Each provider carried its own hardcoded list, and the two did not agree with each other:
// `vendor` was excluded from TypeScript collection and included in Python collection. Nobody
// decided that. It is what a list maintained in four places converges to.
//
// ★ MEMBERSHIP IN THE CORPUS IS ONE QUESTION WITH ONE ANSWER, derived from the repository's own
// configuration rather than re-listed per consumer.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enumerateFirstPartyFiles } from '../../../mcp/stdio/code-intel/enumerate-first-party.js';

const TS_EXTS = new Set(['.ts', '.js']);

let root;
afterEach(async () => {
  if (root) { try { await rm(root, { recursive: true, force: true }); } catch { /* win lock */ } }
  root = undefined;
});

/** A repo with real sources, a vendored tree, and a .gitignore that names it. */
async function repo({ gitignore = 'reference/\n' } = {}) {
  root = await mkdtemp(join(tmpdir(), 'apg-enum-'));
  for (const d of ['src', 'reference/vendored/deep', 'node_modules/pkg', 'build']) {
    await mkdir(join(root, d), { recursive: true });
  }
  await writeFile(join(root, '.gitignore'), gitignore);
  await writeFile(join(root, 'src', 'real.ts'), 'export const a = 1;');
  await writeFile(join(root, 'src', 'also-real.js'), 'module.exports = 1;');
  await writeFile(join(root, 'reference', 'vendored', 'deep', 'borrowed.ts'), 'export const b = 2;');
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = 2;');
  await writeFile(join(root, 'build', 'out.js'), 'module.exports = 3;');
  return root;
}

describe('one first-party walk, derived from the repo', () => {
  it('★★★ excludes a gitignored tree AND still finds real sources', async () => {
    // ⛔ BOTH HALVES IN ONE CALL. An enumerator that returns nothing passes any exclusion
    // assertion, and "reference/ is absent" is trivially true of a walk that found no files at
    // all. That failure mode has produced a false ALL-CLEAR in this repo more than once, so the
    // positive control is asserted first and from the same result object.
    await repo();
    const { files } = enumerateFirstPartyFiles(root, { exts: TS_EXTS, maxFiles: 1000 });

    expect(files.filter((f) => f.startsWith('src/')).sort(), 'the instrument finds real files')
      .toEqual(['src/also-real.js', 'src/real.ts']);
    expect(files.filter((f) => f.startsWith('reference/')), 'a gitignored tree is not the corpus')
      .toEqual([]);
    expect(files.filter((f) => f.includes('node_modules/'))).toEqual([]);
    expect(files.filter((f) => f.startsWith('build/'))).toEqual([]);
  }, 30_000);

  it('★★★ the exclusion comes from THE REPO, not from a list in this codebase', async () => {
    // ⛔ THE DISCRIMINATING TEST. If `reference` were merely added to a hardcoded set, this passes
    // identically to the case above — so the same directory is checked with and WITHOUT the
    // .gitignore entry that excludes it. Only a derived rule can produce both answers.
    await repo({ gitignore: '# nothing ignored here\n' });
    const { files } = enumerateFirstPartyFiles(root, { exts: TS_EXTS, maxFiles: 1000 });

    expect(files.some((f) => f.startsWith('reference/')),
      'without a gitignore entry, reference/ IS first-party and must be collected').toBe(true);
    // ...while node_modules stays out, because that one is a built-in, not a repo opinion.
    expect(files.filter((f) => f.includes('node_modules/'))).toEqual([]);
  }, 30_000);

  it('★★★ language extras ADD to the derived set, never replace it', async () => {
    // Python legitimately needs `site-packages`. The regression risk is a provider passing its
    // own list and quietly losing the repo's — which is the shape that produced this file.
    await repo();
    await mkdir(join(root, 'site-packages'), { recursive: true });
    await writeFile(join(root, 'site-packages', 'dep.ts'), 'export const c = 3;');

    const { files } = enumerateFirstPartyFiles(root, {
      exts: TS_EXTS, maxFiles: 1000, extraSkipDirs: ['site-packages'],
    });
    expect(files.filter((f) => f.startsWith('site-packages/')), 'the extra applies').toEqual([]);
    expect(files.filter((f) => f.startsWith('reference/')), 'and the derived set SURVIVES it')
      .toEqual([]);
    expect(files.some((f) => f.startsWith('src/')), 'and real sources are still found').toBe(true);
  }, 30_000);

  it('★★★ what it skipped is REPORTED, not silently dropped', async () => {
    // A collection that walks past a third of the repo reports the same shape as one with nothing
    // to walk past. Coverage numbers computed over a silently-narrowed population are how
    // `files_eligible: 579` came to count files the graph excludes.
    await repo();
    const { stats } = enumerateFirstPartyFiles(root, { exts: TS_EXTS, maxFiles: 1000 });
    expect(stats.excluded_dirs, 'the count is visible').toBeGreaterThan(0);
    expect(stats.excluded_dir_sample, 'and it names them').toContain('reference');
  }, 30_000);

  it('★★★ skipFile rejects per file without touching directory logic', async () => {
    await repo();
    await writeFile(join(root, 'src', 'types.d.ts'), 'export declare const d: number;');
    const { files } = enumerateFirstPartyFiles(root, {
      exts: TS_EXTS, maxFiles: 1000, skipFile: (n) => n.endsWith('.d.ts'),
    });
    expect(files).not.toContain('src/types.d.ts');
    expect(files, 'the control: ordinary sources are untouched').toContain('src/real.ts');
  }, 30_000);
});
