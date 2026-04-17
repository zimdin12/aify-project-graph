import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import cpp from '../../../mcp/stdio/ingest/languages/cpp.js';

describe('cross-file resolver', () => {
  let dir;
  let db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-resolver-'));
    db = openDb(join(dir, 'graph.sqlite'));

    upsertNode(db, {
      id: 'fn:helper',
      type: 'Function',
      label: 'helper',
      file_path: 'src/helpers.py',
      start_line: 1,
      end_line: 3,
      language: 'python',
      confidence: 1.0,
      structural_fp: 's1',
      dependency_fp: 'd1',
      extra: { qname: 'src.helpers.helper' },
    });

    upsertNode(db, {
      id: 'method:index',
      type: 'Method',
      label: 'index',
      file_path: 'app/Http/Controllers/HomeController.php',
      start_line: 5,
      end_line: 10,
      language: 'php',
      confidence: 1.0,
      structural_fp: 's2',
      dependency_fp: 'd2',
      extra: { qname: 'app.Http.Controllers.HomeController.index' },
    });

    upsertNode(db, {
      id: 'doc:readme',
      type: 'Document',
      label: 'README.md',
      file_path: 'README.md',
      start_line: 1,
      end_line: 3,
      language: '',
      confidence: 1.0,
      structural_fp: 's3',
      dependency_fp: 'd3',
      extra: { qname: 'README.md' },
    });
  });

  afterEach(() => {
    db.close();
  });

  it('resolves exact labels, qname suffixes, and leaves external refs dirty', () => {
    const refs = [
      {
        from_id: 'fn:run',
        from_label: 'run',
        relation: 'CALLS',
        target: 'helper',
        source_file: 'src/run.py',
        source_line: 2,
        confidence: 0.95,
        extractor: 'python',
      },
      {
        from_id: 'route:get-home',
        from_label: 'GET /',
        relation: 'INVOKES',
        target: 'HomeController.index',
        source_file: 'routes/web.php',
        source_line: 1,
        confidence: 0.75,
        extractor: 'laravel',
      },
      {
        from_id: 'doc:readme',
        from_label: 'README.md',
        relation: 'MENTIONS',
        target: 'helper',
        source_file: 'README.md',
        source_line: 2,
        confidence: 0.6,
        extractor: 'docs',
      },
      {
        from_id: 'file:worker',
        from_label: 'worker.py',
        relation: 'IMPORTS',
        target: 'os',
        source_file: 'src/worker.py',
        source_line: 1,
        confidence: 0.95,
        extractor: 'python',
      },
      {
        from_id: 'route:imported-helper',
        from_label: 'imported-helper',
        relation: 'IMPORTS',
        target: 'src.helpers.helper',
        source_file: 'src/run.py',
        source_line: 1,
        confidence: 0.95,
        extractor: 'python',
      },
      {
        from_id: 'php:route',
        from_label: 'route',
        relation: 'IMPORTS',
        target: 'app\\Http\\Controllers\\HomeController.index',
        source_file: 'routes/web.php',
        source_line: 1,
        confidence: 0.75,
        extractor: 'php',
      },
    ];

    const result = resolveRefs({ db, refs });

    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from_id: 'fn:run', to_id: 'fn:helper', relation: 'CALLS' }),
      expect.objectContaining({ from_id: 'route:get-home', to_id: 'method:index', relation: 'INVOKES' }),
      expect.objectContaining({ from_id: 'doc:readme', to_id: 'fn:helper', relation: 'MENTIONS' }),
      expect.objectContaining({ from_id: 'route:imported-helper', to_id: 'fn:helper', relation: 'IMPORTS' }),
      expect.objectContaining({ from_id: 'php:route', to_id: 'method:index', relation: 'IMPORTS' }),
    ]));

    expect(result.unresolved).toEqual([
      expect.objectContaining({ relation: 'IMPORTS', target: 'os' }),
    ]);
    expect(result.nodes).toEqual([]);
  });

  it('materializes unresolved USES_TYPE as External terminal node', () => {
    const refs = [
      {
        from_id: 'cls:UserController',
        from_label: 'UserController',
        relation: 'USES_TYPE',
        target: 'Illuminate\\Http\\Request',
        source_file: 'app/Http/Controllers/UserController.php',
        source_line: 14,
        confidence: 0.8,
        extractor: 'php',
      },
    ];
    const result = resolveRefs({ db, refs });
    expect(result.nodes).toEqual([
      expect.objectContaining({ type: 'External', label: 'Illuminate\\Http\\Request' }),
    ]);
    expect(result.edges).toEqual([
      expect.objectContaining({ from_id: 'cls:UserController', relation: 'USES_TYPE' }),
    ]);
  });

  it('materializes qualified REFERENCES as External, leaves bare-name REFERENCES dirty', () => {
    const refs = [
      {
        from_id: 'file:foo',
        from_label: 'Foo.php',
        relation: 'REFERENCES',
        target: 'Illuminate\\Cache\\CacheManager',
        source_file: 'app/Foo.php',
        source_line: 5,
        confidence: 0.65,
        extractor: 'php',
      },
      {
        from_id: 'file:foo',
        from_label: 'Foo.php',
        relation: 'REFERENCES',
        target: 'something_lowercase',
        source_file: 'app/Foo.php',
        source_line: 6,
        confidence: 0.6,
        extractor: 'php',
      },
    ];
    const result = resolveRefs({ db, refs });
    expect(result.nodes).toEqual([
      expect.objectContaining({ type: 'External', label: 'Illuminate\\Cache\\CacheManager' }),
    ]);
    expect(result.unresolved).toEqual([
      expect.objectContaining({ relation: 'REFERENCES', target: 'something_lowercase' }),
    ]);
  });

  it('materializes unresolved CALLS as External terminal nodes', () => {
    const refs = [
      {
        from_id: 'fn:run',
        from_label: 'run',
        relation: 'CALLS',
        target: 'SDL_GetKeyboardState',
        source_file: 'src/run.cpp',
        source_line: 7,
        confidence: 0.8,
        extractor: 'cpp',
      },
    ];

    const result = resolveRefs({ db, refs });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        type: 'External',
        label: 'SDL_GetKeyboardState',
        file_path: '',
      }),
    ]);
    expect(result.edges).toEqual([
      expect.objectContaining({
        from_id: 'fn:run',
        to_id: result.nodes[0].id,
        relation: 'CALLS',
      }),
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('does not resolve PHP CALLS to a CSS class_selector of the same name', () => {
    // Regression: DB::table('users') in PHP was falsely resolving to a CSS
    // .table selector in a stylesheet. CALLS is hard-gated to same language
    // family, so with no PHP 'table' method present the ref should be
    // unresolved rather than crossing into CSS.
    upsertNode(db, {
      id: 'css:table-selector',
      type: 'Class',
      label: 'table',
      file_path: 'public/css/app.css',
      start_line: 10,
      end_line: 10,
      language: 'css',
      confidence: 0.7,
      structural_fp: 'scss',
      dependency_fp: 'dcss',
      extra: { qname: 'public.css.app.table' },
    });

    const refs = [
      {
        from_id: 'php:caller',
        from_label: 'SomeService',
        relation: 'CALLS',
        target: 'table',
        source_file: 'app/Service.php',
        source_line: 42,
        confidence: 0.75,
        extractor: 'php',
      },
    ];

    const result = resolveRefs({ db, refs });
    expect(result.nodes).toEqual([
      expect.objectContaining({ type: 'External', label: 'table' }),
    ]);
    expect(result.edges).toEqual([
      expect.objectContaining({ from_id: 'php:caller', to_id: result.nodes[0].id, relation: 'CALLS' }),
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('resolves PHP CALLS to a PHP method even when a CSS selector of the same name exists', () => {
    // When a real PHP candidate exists it wins — cross-family CSS noise
    // should not preempt the same-family match.
    upsertNode(db, {
      id: 'css:table-selector',
      type: 'Class',
      label: 'table',
      file_path: 'public/css/app.css',
      start_line: 10,
      end_line: 10,
      language: 'css',
      confidence: 0.7,
      structural_fp: 'scss',
      dependency_fp: 'dcss',
      extra: { qname: 'public.css.app.table' },
    });
    upsertNode(db, {
      id: 'php:table-method',
      type: 'Method',
      label: 'table',
      file_path: 'app/QueryBuilder.php',
      start_line: 20,
      end_line: 30,
      language: 'php',
      confidence: 1.0,
      structural_fp: 'sphp',
      dependency_fp: 'dphp',
      extra: { qname: 'app.QueryBuilder.table', parent_class: 'QueryBuilder' },
    });

    const refs = [
      {
        from_id: 'php:caller2',
        from_label: 'Svc',
        relation: 'CALLS',
        target: 'table',
        source_file: 'app/OtherService.php',
        source_line: 1,
        confidence: 0.75,
        extractor: 'php',
      },
    ];

    const result = resolveRefs({ db, refs });
    expect(result.edges).toEqual([
      expect.objectContaining({ from_id: 'php:caller2', to_id: 'php:table-method', relation: 'CALLS' }),
    ]);
  });

  it('resolves against a large node table without any full-table node load', () => {
    for (let i = 0; i < 10000; i += 1) {
      upsertNode(db, {
        id: `fn:bulk:${i}`,
        type: 'Function',
        label: `bulk_${i}`,
        file_path: `src/bulk/${i}.py`,
        start_line: 1,
        end_line: 2,
        language: 'python',
        confidence: 1.0,
        structural_fp: `s:${i}`,
        dependency_fp: `d:${i}`,
        extra: { qname: `src.bulk.bulk_${i}` },
      });
    }

    const allSpy = vi.spyOn(db, 'all');
    const refs = [
      {
        from_id: 'fn:worker',
        from_label: 'worker',
        relation: 'CALLS',
        target: 'bulk_9999',
        source_file: 'src/worker.py',
        source_line: 10,
        confidence: 0.95,
        extractor: 'python',
      },
    ];

    const result = resolveRefs({ db, refs });

    expect(result.edges).toEqual([
      expect.objectContaining({ from_id: 'fn:worker', to_id: 'fn:bulk:9999', relation: 'CALLS' }),
    ]);
    expect(result.unresolved).toEqual([]);
    expect(allSpy).not.toHaveBeenCalledWith('SELECT * FROM nodes');
  });

  it('links a C++ out-of-class method back to its owning class via CONTAINS', async () => {
    const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'ingest', 'tiny-cpp-methods');
    const headerSource = await readFile(join(fixtureDir, 'Foo.h'), 'utf8');
    const cppSource = await readFile(join(fixtureDir, 'Foo.cpp'), 'utf8');

    const headerResult = extractFile({
      filePath: 'src/Foo.h',
      source: headerSource,
      config: cpp,
    });
    const cppResult = extractFile({
      filePath: 'src/Foo.cpp',
      source: cppSource,
      config: cpp,
    });

    for (const node of [...headerResult.nodes, ...cppResult.nodes]) {
      upsertNode(db, node);
    }

    const result = resolveRefs({ db, refs: [...headerResult.refs, ...cppResult.refs] });
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: 'CONTAINS',
          from_id: headerResult.nodes.find((node) => node.type === 'Class' && node.label === 'Foo').id,
          to_id: cppResult.nodes.find((node) => node.type === 'Method' && node.label === 'bar').id,
        }),
      ]),
    );
  });
});
