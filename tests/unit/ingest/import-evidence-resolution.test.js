// P3-1 / P3-2 — JS/TS import-resolution improvements.
//
// Covers:
//  - extension probing (relative `dir/foo` → `dir/foo.js` File node)
//  - tsconfig path-aliases (`@/foo` → `src/foo.ts`, incl. create-next-app
//    `"@/*": ["./*"]` leading-`./` strip)
//  - require() CJS extraction (tree-sitter misses it)
//  - import-evidence short-name CALLS resolution (unique-match only;
//    non-unique / COMMON_NAMES / doc-node → NOT resolved)
//
// These are exercised against synthetic graphs because this host repo uses
// explicit `.js` extensions and no aliases (so it can't exercise the probe
// paths). The synthetic graphs model the create-next-app / extensionless /
// CJS shapes the waves target.

import { describe, expect, it } from 'vitest';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';
import {
  buildImportContext,
  probeWithExtensions,
  resolveImportSpecifier,
  scanFileImports,
} from '../../../mcp/stdio/ingest/import-resolution.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'apg-import-'));
  const db = openDb(join(dir, 'graph.sqlite'));
  try {
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'typescript', confidence: 1, extra: '{}', ...node },
  );
}

describe('import-resolution — extension probing', () => {
  it('probes the extension ladder against the candidate fileset', () => {
    const fileSet = new Set(['src/foo.ts', 'src/bar/index.js', 'src/baz.jsx']);
    expect(probeWithExtensions('src/foo', fileSet)).toBe('src/foo.ts');
    expect(probeWithExtensions('src/bar', fileSet)).toBe('src/bar/index.js');
    expect(probeWithExtensions('src/baz', fileSet)).toBe('src/baz.jsx');
    expect(probeWithExtensions('src/nope', fileSet)).toBeNull();
  });

  it('resolves a relative IMPORTS target to the real .ts File node', () => {
    withTempDb((db) => {
      insertNode(db, { id: 'f-foo', type: 'File', label: 'foo.ts', file_path: 'src/lib/foo.ts' });
      insertNode(db, { id: 'f-caller', type: 'File', label: 'app.ts', file_path: 'src/app.ts' });
      const ctx = buildImportContext({
        repoRoot: '/x',
        fileSet: new Set(['src/lib/foo.ts', 'src/app.ts']),
      });
      // Extractor emits the relative import normalized to extensionless `src/lib/foo`.
      const { edges, unresolved } = resolveRefs({
        db,
        importContext: ctx,
        refs: [{
          from_id: 'f-caller',
          relation: 'IMPORTS',
          target: 'src/lib/foo',
          source_file: 'src/app.ts',
          source_line: 1,
          confidence: 0.9,
          extractor: 'typescript',
        }],
      });
      expect(unresolved).toHaveLength(0);
      expect(edges).toHaveLength(1);
      expect(edges[0].to_id).toBe('f-foo');
    });
  });
});

describe('import-resolution — tsconfig path-aliases', () => {
  it('resolves create-next-app "@/*": ["./*"] with the leading-./ strip', () => {
    const fileSet = new Set(['tsconfig.json', 'lib/utils.ts', 'app/page.tsx']);
    const ctx = buildImportContext({ repoRoot: '/x', fileSet });
    // Inject a parsed config equivalent to create-next-app default. Build via
    // loadTsConfigs by faking the file read is awkward in-unit, so assert the
    // resolver behavior using a hand-built ctx mirroring the parsed shape.
    ctx.tsconfigs = [{ dir: '', baseUrl: '.', paths: { '@/*': ['./*'] } }];
    expect(resolveImportSpecifier({ specifier: '@/lib/utils', importerFile: 'app/page.tsx', ctx }))
      .toBe('lib/utils.ts');
  });

  it('resolves "@/*": ["./src/*"] alias to the src tree', () => {
    const fileSet = new Set(['src/components/Button.tsx', 'src/app.ts']);
    const ctx = buildImportContext({ repoRoot: '/x', fileSet });
    ctx.tsconfigs = [{ dir: '', baseUrl: '.', paths: { '@/*': ['./src/*'] } }];
    expect(resolveImportSpecifier({ specifier: '@/components/Button', importerFile: 'src/app.ts', ctx }))
      .toBe('src/components/Button.tsx');
  });

  it('returns null for an alias that matches no real file (no invented edge)', () => {
    const fileSet = new Set(['src/app.ts']);
    const ctx = buildImportContext({ repoRoot: '/x', fileSet });
    ctx.tsconfigs = [{ dir: '', baseUrl: '.', paths: { '@/*': ['./src/*'] } }];
    expect(resolveImportSpecifier({ specifier: '@/missing', importerFile: 'src/app.ts', ctx }))
      .toBeNull();
  });

  it('resolves an aliased IMPORTS ref end-to-end through the resolver', () => {
    withTempDb((db) => {
      insertNode(db, { id: 'f-utils', type: 'File', label: 'utils.ts', file_path: 'lib/utils.ts' });
      insertNode(db, { id: 'f-page', type: 'File', label: 'page.tsx', file_path: 'app/page.tsx' });
      const ctx = buildImportContext({
        repoRoot: '/x',
        fileSet: new Set(['lib/utils.ts', 'app/page.tsx']),
      });
      ctx.tsconfigs = [{ dir: '', baseUrl: '.', paths: { '@/*': ['./*'] } }];
      const { edges, unresolved } = resolveRefs({
        db,
        importContext: ctx,
        refs: [{
          from_id: 'f-page',
          relation: 'IMPORTS',
          target: '@/lib/utils', // alias left raw by the extractor
          source_file: 'app/page.tsx',
          source_line: 1,
          confidence: 0.9,
          extractor: 'typescript',
        }],
      });
      expect(unresolved).toHaveLength(0);
      expect(edges[0]?.to_id).toBe('f-utils');
    });
  });
});

describe('import-resolution — require() CJS extraction', () => {
  it('scanFileImports captures require destructuring + default require + bare require', () => {
    const src = [
      "const Database = require('better-sqlite3');",
      "const { join, dirname } = require('node:path');",
      "require('./side-effect');",
    ].join('\n');
    const { localNames, requireSpecifiers } = scanFileImports(src);
    expect(requireSpecifiers).toContain('better-sqlite3');
    expect(requireSpecifiers).toContain('node:path');
    expect(requireSpecifiers).toContain('./side-effect');
    expect(localNames.get('Database')).toEqual({ source: 'better-sqlite3', exportedName: 'default' });
    expect(localNames.get('join')).toEqual({ source: 'node:path', exportedName: 'join' });
  });

  it('extractFile emits an IMPORTS ref for a require() the tree-sitter pass misses', () => {
    const config = getLanguageConfig('lib/cjs.js');
    const source = "const helper = require('./helper');\nfunction run() { return helper(); }\n";
    const result = extractFile({ filePath: 'lib/cjs.js', source, config });
    const importTargets = result.refs.filter((r) => r.relation === 'IMPORTS').map((r) => r.target);
    // require('./helper') normalized relative to lib/cjs.js → lib/helper
    expect(importTargets).toContain('lib/helper');
  });
});

describe('import-evidence — short-name CALLS resolution (P3-2)', () => {
  it('resolves a short-name call when it matches a unique imported symbol', () => {
    withTempDb((db) => {
      // The imported function lives in exactly one place.
      insertNode(db, {
        id: 'fn-format', type: 'Function', label: 'formatThing',
        file_path: 'src/util/format.ts', extra: '{"qname":"src.util.format.formatThing"}',
      });
      insertNode(db, { id: 'f-caller', type: 'File', label: 'app.ts', file_path: 'src/app.ts' });
      insertNode(db, {
        id: 'fn-caller', type: 'Function', label: 'render',
        file_path: 'src/app.ts', extra: '{"qname":"src.app.render"}',
      });
      const ctx = buildImportContext({
        repoRoot: '/x', fileSet: new Set(['src/util/format.ts', 'src/app.ts']),
      });
      const { edges, unresolved } = resolveRefs({
        db,
        importContext: ctx,
        refs: [{
          from_id: 'fn-caller',
          relation: 'CALLS',
          target: 'formatThing',
          source_file: 'src/app.ts',
          source_line: 5,
          confidence: 0.9,
          extractor: 'typescript',
          importMap: { formatThing: { source: './util/format', exportedName: 'formatThing' } },
        }],
      });
      const callEdge = edges.find((e) => e.relation === 'CALLS');
      expect(unresolved).toHaveLength(0);
      // Resolves to the imported function (whether via the generic unique-label
      // pass or import-evidence — both land on the single real definition).
      expect(callEdge?.to_id).toBe('fn-format');
    });
  });

  it('does NOT resolve when two symbols share the name (non-unique → unresolved)', () => {
    withTempDb((db) => {
      // Two different files both export `doThing`. The import source resolves to
      // NEITHER (alias points at a third file), so no unique in-file match and
      // no unique global match → must stay unresolved.
      insertNode(db, {
        id: 'fn-a', type: 'Function', label: 'doThing',
        file_path: 'src/a.ts', extra: '{"qname":"src.a.doThing"}',
      });
      insertNode(db, {
        id: 'fn-b', type: 'Function', label: 'doThing',
        file_path: 'src/b.ts', extra: '{"qname":"src.b.doThing"}',
      });
      insertNode(db, {
        id: 'fn-caller', type: 'Function', label: 'render',
        file_path: 'src/app.ts', extra: '{"qname":"src.app.render"}',
      });
      const ctx = buildImportContext({
        repoRoot: '/x', fileSet: new Set(['src/a.ts', 'src/b.ts', 'src/app.ts']),
      });
      const { edges } = resolveRefs({
        db,
        importContext: ctx,
        refs: [{
          from_id: 'fn-caller',
          relation: 'CALLS',
          target: 'doThing',
          source_file: 'src/app.ts',
          source_line: 5,
          confidence: 0.9,
          extractor: 'typescript',
          // import source resolves to neither a.ts nor b.ts
          importMap: { doThing: { source: 'src/c', exportedName: 'doThing' } },
        }],
      });
      // Must NOT pick either ambiguous candidate; falls through to an External
      // terminal (CALLS always materialize) instead of inventing a wrong edge.
      const callEdge = edges.find((e) => e.relation === 'CALLS');
      expect(callEdge?.to_id).not.toBe('fn-a');
      expect(callEdge?.to_id).not.toBe('fn-b');
      expect(String(callEdge?.to_id).startsWith('external:')).toBe(true);
    });
  });

  it('narrows duplicate names via the resolved import file', () => {
    withTempDb((db) => {
      insertNode(db, {
        id: 'fn-a', type: 'Function', label: 'doThing',
        file_path: 'src/a.ts', extra: '{"qname":"src.a.doThing"}',
      });
      insertNode(db, {
        id: 'fn-b', type: 'Function', label: 'doThing',
        file_path: 'src/b.ts', extra: '{"qname":"src.b.doThing"}',
      });
      insertNode(db, {
        id: 'fn-caller', type: 'Function', label: 'render',
        file_path: 'src/app.ts', extra: '{"qname":"src.app.render"}',
      });
      const ctx = buildImportContext({
        repoRoot: '/x', fileSet: new Set(['src/a.ts', 'src/b.ts', 'src/app.ts']),
      });
      const { edges } = resolveRefs({
        db,
        importContext: ctx,
        refs: [{
          from_id: 'fn-caller',
          relation: 'CALLS',
          target: 'doThing',
          source_file: 'src/app.ts',
          source_line: 5,
          confidence: 0.9,
          extractor: 'typescript',
          importMap: { doThing: { source: 'src/b', exportedName: 'doThing' } }, // points at b.ts
        }],
      });
      const callEdge = edges.find((e) => e.relation === 'CALLS');
      expect(callEdge?.to_id).toBe('fn-b'); // narrowed to the imported file
      expect(callEdge?.provenance).toBe('INFERRED');
    });
  });

  it('never lets a Document node satisfy a code call', () => {
    withTempDb((db) => {
      insertNode(db, {
        id: 'doc-thing', type: 'Document', label: 'guide', file_path: 'docs/guide.md',
        language: '', extra: '{"qname":"docs.guide"}',
      });
      insertNode(db, {
        id: 'fn-caller', type: 'Function', label: 'render',
        file_path: 'src/app.ts', extra: '{"qname":"src.app.render"}',
      });
      const ctx = buildImportContext({ repoRoot: '/x', fileSet: new Set(['src/app.ts']) });
      const { unresolved, edges } = resolveRefs({
        db,
        importContext: ctx,
        refs: [{
          from_id: 'fn-caller',
          relation: 'CALLS',
          target: 'guide',
          source_file: 'src/app.ts',
          source_line: 5,
          confidence: 0.9,
          extractor: 'typescript',
          importMap: { guide: { source: 'docs/guide', exportedName: 'guide' } },
        }],
      });
      // The doc node must NOT satisfy the code call. CALLS always materialize
      // as an External terminal when unresolved, so `guide` becomes an External
      // node — never an edge into the Document node.
      expect(edges.find((e) => e.relation === 'CALLS' && e.to_id === 'doc-thing')).toBeUndefined();
      const callEdge = edges.find((e) => e.relation === 'CALLS');
      const ext = (callEdge && callEdge.to_id) || '';
      expect(ext.startsWith('external:')).toBe(true);
    });
  });

  it('respects the COMMON_NAMES denylist (does not resolve `resolve`)', () => {
    withTempDb((db) => {
      insertNode(db, {
        id: 'fn-resolve', type: 'Function', label: 'resolve',
        file_path: 'src/util/p.ts', extra: '{"qname":"src.util.p.resolve"}',
      });
      insertNode(db, {
        id: 'fn-caller', type: 'Function', label: 'render',
        file_path: 'src/app.ts', extra: '{"qname":"src.app.render"}',
      });
      const ctx = buildImportContext({
        repoRoot: '/x', fileSet: new Set(['src/util/p.ts', 'src/app.ts']),
      });
      const { edges, unresolved } = resolveRefs({
        db,
        importContext: ctx,
        refs: [{
          from_id: 'fn-caller',
          relation: 'CALLS',
          target: 'resolve',
          source_file: 'src/app.ts',
          source_line: 5,
          confidence: 0.9,
          extractor: 'typescript',
          importMap: { resolve: { source: 'src/util/p', exportedName: 'resolve' } },
        }],
      });
      // COMMON_NAMES denylist blocks import-evidence AND external materialization
      // for `resolve` — must NOT resolve to the shadowing function; the ref is
      // left unresolved (no edge into fn-resolve).
      expect(edges.find((e) => e.relation === 'CALLS' && e.to_id === 'fn-resolve')).toBeUndefined();
      expect(unresolved.some((r) => r.target === 'resolve')).toBe(true);
    });
  });
});
