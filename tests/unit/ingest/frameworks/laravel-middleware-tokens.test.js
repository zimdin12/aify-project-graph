import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { laravelRoutesPlugin } from '../../../../mcp/stdio/ingest/frameworks/laravel.js';

// ⛔ THE `::class` SUFFIX IS THE ONLY THING SEPARATING A CLASS TOKEN FROM AN ALIAS STRING.
//
// `parseMiddlewareTokens` collected both kinds into one flat list and STRIPPED the suffix. So
// `Route::middleware([Authenticate::class])` — the ordinary Laravel idiom, with the class imported
// at the top of the file — reached `normalizeMiddlewareTarget` as plain `Authenticate`. That
// function recognises a class only by a backslash or a `::class` suffix, matched neither, fell
// through to `[]`, and the ENTIRE middleware chain was dropped for that route.
//
// ⭐ HOW IT WAS FOUND, AND THE POINT IS THE METHOD. The framework-language guard had a DECLARED
// uncovered site: laravel's middleware `PASSES_THROUGH`, where a mutant deleting the language
// SURVIVED. Every fixture form I tried reached only the INVOKES site. Rather than leave it as a
// noted gap, chasing why the fixture could not reach it turned up this defect.
// ⇒ A declared gap is a lead. A hidden one is nothing.
//
// ⚠ THE CONTROL IS WHAT MAKES THE ZERO A DEFECT. A string alias with no Kernel alias map ALSO
// produces zero chain refs — and that is CORRECT, because `'auth'` is genuinely unresolvable
// without the map. Two zeros, two different causes; only measuring both distinguishes them.

const COMPOSER = '{"require":{"laravel/framework":"^11.0"}}';
const KERNEL = `<?php
class Kernel extends HttpKernel
{
    protected $middlewareAliases = [
        'auth' => \\App\\Http\\Middleware\\Authenticate::class,
        'throttle' => \\App\\Http\\Middleware\\ThrottleRequests::class,
    ];
}
`;
const routesWith = (middlewareExpr) => `<?php
Route::middleware(${middlewareExpr})->group(function () {
    Route::get('/admin', [AdminController::class, 'index']);
});
`;

describe('laravel middleware tokens — a class token must survive tokenisation', () => {
  let root;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apg-lv-mw-')); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

  const run = async (files) => {
    for (const [rel, content] of Object.entries({ 'composer.json': COMPOSER, ...files })) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    const out = await laravelRoutesPlugin.enrich({ repoRoot: root, result: { nodes: [], edges: [], refs: [] } });
    const refs = out.refs ?? [];
    return { refs, chain: refs.filter((r) => r.relation === 'PASSES_THROUGH') };
  };

  it('⛔ a BARE `Foo::class` token builds the middleware chain', async () => {
    // The defect: this produced zero chain refs, because the suffix was stripped before the only
    // function that could recognise it ever saw the token.
    const { chain } = await run({ 'routes/web.php': routesWith('[Authenticate::class, ThrottleRequests::class]') });
    expect(chain.length, 'a bare Foo::class token must resolve without a Kernel alias map').toBe(3);
    expect(chain.map((r) => r.target)).toContain('Authenticate.handle');
    expect(chain.map((r) => r.target)).toContain('ThrottleRequests.handle');
  });

  it('⭐ a FULLY-QUALIFIED class token still works — the path that always did', async () => {
    // Positive control on the branch that was never broken. If this regresses, the change to
    // tokenisation broke something it was not meant to touch.
    const { chain } = await run({
      'routes/web.php': routesWith('[\\App\\Http\\Middleware\\Authenticate::class, \\App\\Http\\Middleware\\ThrottleRequests::class]'),
    });
    expect(chain).toHaveLength(3);
  });

  it('⭐ a STRING alias resolves through the Kernel alias map', async () => {
    const { chain } = await run({
      'routes/web.php': routesWith("['auth', 'throttle']"),
      'app/Http/Kernel.php': KERNEL,
    });
    expect(chain).toHaveLength(3);
    expect(chain.map((r) => r.target)).toContain('Authenticate.handle');
  });

  it('⛔ NEGATIVE CONTROL: a string alias with NO Kernel map is still dropped', async () => {
    // ⚠ THIS ZERO IS CORRECT AND MUST STAY ZERO. Without an alias map `'auth'` names nothing the
    // extractor can see, and inventing `auth.handle` would be a fabricated edge. It is also the
    // reason the defect above was hard to spot: both cases produced zero.
    const { refs, chain } = await run({ 'routes/web.php': routesWith("['auth', 'throttle']") });
    expect(chain).toHaveLength(0);
    // The route itself is still discovered — the drop is scoped to the unresolvable middleware.
    expect(refs.filter((r) => r.relation === 'INVOKES')).toHaveLength(1);
  });

  it('⭐ IT DISCRIMINATES: three resolvable forms build the chain, the unresolvable one does not', async () => {
    // Each case above passes individually for an extractor that resolves everything, or nothing.
    const forms = [
      { files: { 'routes/web.php': routesWith('[Authenticate::class]') }, expect: true },
      { files: { 'routes/web.php': routesWith('[\\App\\Http\\Middleware\\Authenticate::class]') }, expect: true },
      { files: { 'routes/web.php': routesWith("['auth']"), 'app/Http/Kernel.php': KERNEL }, expect: true },
      { files: { 'routes/web.php': routesWith("['auth']") }, expect: false },
    ];
    const built = [];
    for (const form of forms) {
      rmSync(root, { recursive: true, force: true });
      root = mkdtempSync(join(tmpdir(), 'apg-lv-mw-'));
      built.push((await run(form.files)).chain.length > 0);
    }
    expect(built).toEqual(forms.map((f) => f.expect));
  });
});
