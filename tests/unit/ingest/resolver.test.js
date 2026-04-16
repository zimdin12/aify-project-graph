import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';

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
  });
});
