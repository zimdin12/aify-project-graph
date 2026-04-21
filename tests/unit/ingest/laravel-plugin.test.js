import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { applyFrameworkPlugins } from '../../../mcp/stdio/ingest/extractors/base.js';
import { laravelRoutesPlugin } from '../../../mcp/stdio/ingest/frameworks/laravel.js';

const FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'ingest', 'tiny-laravel');
const MIDDLEWARE_FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'ingest', 'tiny-laravel-middleware');
const CONFLICT_FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'ingest', 'tiny-laravel-middleware-conflict');

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

  it('expands middleware groups into a passthrough chain', async () => {
    const result = await applyFrameworkPlugins({
      repoRoot: MIDDLEWARE_FIXTURE_ROOT,
      result: {
        nodes: [],
        edges: [],
        refs: [],
      },
      plugins: [laravelRoutesPlugin],
    });

    const route = result.nodes.find((node) => node.type === 'Route' && node.label === 'GET /profile');
    expect(route).toBeTruthy();

    expect(result.refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from_id: route.id,
        relation: 'PASSES_THROUGH',
        target: 'RequireToken.handle',
      }),
      expect.objectContaining({
        from_target: 'RequireToken.handle',
        relation: 'PASSES_THROUGH',
        target: 'ThrottleNonIntrusive.handle',
      }),
      expect.objectContaining({
        from_target: 'ThrottleNonIntrusive.handle',
        relation: 'PASSES_THROUGH',
        target: 'ProfileController.show',
      }),
    ]));
  });

  it('honors route-declared inline middleware order even when Kernel group declares the reverse', async () => {
    // Kernel.php's 'allow-end-user' group declares middleware in the order
    // [throttle-non-intrusive, require-token]. The route inlines its own
    // middleware list [require-token, throttle-non-intrusive] — the reverse.
    // The route does not reference the group by name, so the plugin must emit
    // the chain in the route-declared inline order, not the Kernel group order.
    const result = await applyFrameworkPlugins({
      repoRoot: CONFLICT_FIXTURE_ROOT,
      result: { nodes: [], edges: [], refs: [] },
      plugins: [laravelRoutesPlugin],
    });

    const route = result.nodes.find((node) => node.type === 'Route' && node.label === 'GET /profile');
    expect(route).toBeTruthy();

    // Expected chain, in this exact order:
    //   Route -> RequireToken.handle
    //   RequireToken.handle -> ThrottleNonIntrusive.handle
    //   ThrottleNonIntrusive.handle -> ProfileController.show
    // NOT the reversed Kernel group order.

    const chainRefs = result.refs.filter((ref) => ref.relation === 'PASSES_THROUGH');

    // Step 1: Route → RequireToken (NOT Route → ThrottleNonIntrusive)
    const step1 = chainRefs.find((ref) => ref.from_id === route.id);
    expect(step1).toBeTruthy();
    expect(step1.target).toBe('RequireToken.handle');
    expect(step1.target).not.toBe('ThrottleNonIntrusive.handle');

    // Step 2: RequireToken → ThrottleNonIntrusive
    const step2 = chainRefs.find((ref) => ref.from_target === 'RequireToken.handle');
    expect(step2).toBeTruthy();
    expect(step2.target).toBe('ThrottleNonIntrusive.handle');

    // Step 3: ThrottleNonIntrusive → Controller
    const step3 = chainRefs.find((ref) => ref.from_target === 'ThrottleNonIntrusive.handle');
    expect(step3).toBeTruthy();
    expect(step3.target).toBe('ProfileController.show');

    // Negative assertion: no chain step should start from the Kernel group's
    // first middleware (throttle-non-intrusive) as the Route's immediate target.
    const kernelOrderStep1 = chainRefs.find(
      (ref) => ref.from_id === route.id && ref.target === 'ThrottleNonIntrusive.handle',
    );
    expect(kernelOrderStep1).toBeUndefined();
  });
});
