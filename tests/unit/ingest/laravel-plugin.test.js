import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { applyFrameworkPlugins } from '../../../mcp/stdio/ingest/extractors/base.js';
import { laravelRoutesPlugin } from '../../../mcp/stdio/ingest/frameworks/laravel.js';

const FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'ingest', 'tiny-laravel');

describe('laravel routes plugin', () => {
  it('detects Laravel and emits route invoke refs', async () => {
    const result = await applyFrameworkPlugins({
      repoRoot: FIXTURE_ROOT,
      result: { nodes: [], edges: [], refs: [] },
      plugins: [laravelRoutesPlugin],
    });

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'Route',
        file_path: 'routes/web.php',
        label: 'GET /',
      }),
    ]));

    expect(result.refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relation: 'INVOKES',
        from_label: 'GET /',
        target: 'HomeController.index',
        confidence: 0.75,
        extractor: 'laravel',
      }),
    ]));
  });
});
