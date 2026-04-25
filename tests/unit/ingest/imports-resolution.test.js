// Regression tests for the 2026-04-21 IMPORTS extractor bug: JS/TS named
// imports produced only `source.member` compound targets that the resolver
// couldn't match to a file node, so IMPORTS edges were silently dropped for
// ~99% of real files. The fix always emits the source as a target in addition
// to any member-qualified ones.
//
// Guards against regressions in the extractor pipeline end-to-end: extractor
// emits refs → resolver turns them into edges → nodes/edges persist.

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';

const FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'ingest');

async function extract(fixtureDir, filePath) {
  const config = getLanguageConfig(filePath);
  const source = await readFile(join(FIXTURE_ROOT, fixtureDir, filePath), 'utf8');
  return extractFile({ filePath: `fixture/${filePath}`, source, config });
}

describe('IMPORTS extraction — source is always emitted as a target', () => {
  it('JS named imports emit both the source and the source.member compound', async () => {
    const result = await extract('tiny-javascript', 'app.js');
    const imports = result.refs.filter((r) => r.relation === 'IMPORTS');
    const targets = imports.map((r) => r.target);

    // Source-only targets — must be present so resolver can match to file nodes
    expect(targets).toContain('node:path');
    expect(targets).toContain('fixture/helper.js');
    expect(targets).toContain('fixture/default.js');

    // Member-qualified targets — additional fine-grained matches
    expect(targets).toContain('node:path.join');
    expect(targets).toContain('fixture/helper.js.helper');
  });

  it('JS default-only import still emits the source', async () => {
    const result = await extract('tiny-javascript', 'app.js');
    const defaultImport = result.refs.find(
      (r) => r.relation === 'IMPORTS' && r.target === 'fixture/default.js'
    );
    expect(defaultImport).toBeTruthy();
  });

  it('JS import_statement produces >= 1 target per named import', async () => {
    // Hard floor: per-import-statement target count. If this drops to zero
    // we've regressed the bug. `import { a, b } from 'x'` must yield at least
    // the source `x` (1) plus optionally `x.a`, `x.b` (3 total).
    const result = await extract('tiny-javascript', 'app.js');
    const imports = result.refs.filter((r) => r.relation === 'IMPORTS');
    // 3 import statements in app.js, each should emit >= 1 target.
    // Named imports emit source + N members, default emits just source.
    expect(imports.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves deep relative JS imports against the importer path instead of flattening them', async () => {
    const config = getLanguageConfig('tests/unit/query/query.test.js');
    const source = "import { expandClassRollupTargets } from '../../../mcp/stdio/query/verbs/target_rollup.js';\n";
    const result = extractFile({
      filePath: 'tests/unit/query/query.test.js',
      source,
      config,
    });
    const imports = result.refs.filter((r) => r.relation === 'IMPORTS').map((r) => r.target);

    expect(imports).toContain('mcp/stdio/query/verbs/target_rollup.js');
    expect(imports).not.toContain('mcp.stdio.query.verbs.target_rollup.js');
  });
});
