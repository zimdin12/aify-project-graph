import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { railsPlugin } from '../../../../mcp/stdio/ingest/frameworks/rails.js';
import { COMMON_NAMES } from '../../../../mcp/stdio/ingest/denylist.js';

// ⛔ A BARE ACTION NAME CANNOT RESOLVE, AND THE COMMENT IN THE PLUGIN USED TO PROMISE IT WOULD.
//
// It read: "We emit the action identifier alone (the resolver will match it against Method nodes by
// label)." Label matching is exactly what the COMMON_NAMES denylist blocks — and `index`, `create`
// and `update` are ON that list, being three of the seven standard Rails actions and among the most
// common method names in any codebase.
//
// ⭐ MEASURED on a real Rails fixture indexed by the real pipeline: `resources :articles` produced
// EIGHT route nodes and exactly ONE bound edge (`show`). `index` was defined in the controller and
// still did not bind. After qualifying the target: 2 bound — `index` and `show`, the two the
// fixture actually defines — which was the prediction registered before the change.
//
// ⇒ The plugin already HAD the controller in `r.controller`. `laravel.js` emits
// `${controller}.${action}` for exactly this reason; rails discarded it and hoped.
//
// ⚠ THE DENYLIST IS NOT THE BUG. It exists so a bare `CALLS get` ref cannot match hundreds of
// unrelated `get` methods. A route ref is not a guess — it knows its controller — so the fix is to
// stop throwing that away, not to weaken the guard.

const GEMFILE = "gem 'rails'";
const routes = (body) => `Rails.application.routes.draw do\n${body}\nend\n`;

describe('rails route targets are controller-qualified, not bare action names', () => {
  let root;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apg-rails-')); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

  const run = async (files) => {
    for (const [rel, content] of Object.entries({ Gemfile: GEMFILE, ...files })) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    const out = await railsPlugin.enrich({ repoRoot: root, result: { nodes: [], edges: [], refs: [] } });
    return out.refs ?? [];
  };

  it('⭐ THE PREMISE, PINNED: the actions at issue really are denylisted', () => {
    // If this ever stops being true the defect changes shape, and the rest of this file would be
    // asserting against a problem that no longer exists for the stated reason.
    expect(COMMON_NAMES.has('index')).toBe(true);
    expect(COMMON_NAMES.has('create')).toBe(true);
    expect(COMMON_NAMES.has('update')).toBe(true);
    // And the control: not every action is denylisted, which is why `show` bound while `index` did not.
    expect(COMMON_NAMES.has('show')).toBe(false);
  });

  it('⛔ every target is qualified with the controller class', async () => {
    const refs = await run({ 'config/routes.rb': routes('  resources :articles') });
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(r.target, 'a bare action name cannot survive the denylist').toContain('ArticlesController.');
    }
    expect(refs.map((r) => r.target)).toContain('ArticlesController.index');
  });

  it('⛔ the denylisted actions are exactly the ones a bare name would lose', async () => {
    // Names the harm precisely: without qualification these three refs are discarded by the
    // resolver, and they are the create/read/update of a standard resource.
    const refs = await run({ 'config/routes.rb': routes('  resources :articles') });
    const qualified = refs.map((r) => r.target);
    for (const action of ['index', 'create', 'update']) {
      expect(qualified).toContain(`ArticlesController.${action}`);
      expect(qualified, 'the bare form is what the denylist eats').not.toContain(action);
    }
  });

  it('⛔ an explicit `to:` route is qualified from ITS controller, not the resource', async () => {
    const refs = await run({ 'config/routes.rb': routes("  get 'dashboard', to: 'admin_reports#index'") });
    expect(refs.map((r) => r.target)).toContain('AdminReportsController.index');
  });

  it('⛔ a namespaced controller still yields a usable class name', async () => {
    // The namespace segment is dropped deliberately — the resolver matches a qname SUFFIX, and
    // `UsersController.index` is already specific enough to clear the denylist.
    const refs = await run({ 'config/routes.rb': routes("  get 'u', to: 'admin/users#index'") });
    expect(refs.map((r) => r.target)).toContain('UsersController.index');
  });

  it('⭐ IT DISCRIMINATES: snake_case resources camelize, and nothing is left bare', async () => {
    const refs = await run({ 'config/routes.rb': routes('  resources :blog_posts') });
    expect(refs.map((r) => r.target)).toContain('BlogPostsController.index');
    expect(refs.every((r) => r.target.includes('.')), 'no target may be a bare identifier').toBe(true);
  });

  // ⛔ A THIRD DEFECT, FOUND BY THE TWO TESTS ABOVE FAILING. `#` is Ruby's comment marker AND the
  // controller/action separator in a route, and the line was pre-processed with
  // `rawLine.replace(/#.*$/, '')`. So `get 'x', to: 'admin_reports#index'` was truncated to
  // `get 'x', to: 'admin_reports` and matched nothing — EVERY explicit `to:` route produced no Route
  // node at all. `resources :articles` contains no `#`, which is the only reason anything worked.
  describe('a `#` inside a quoted string is not a comment', () => {
    it('⛔ an explicit route survives the comment stripper', async () => {
      const refs = await run({ 'config/routes.rb': routes("  get 'dashboard', to: 'reports#index'") });
      expect(refs, 'the whole route was being discarded').toHaveLength(1);
      expect(refs[0].target).toBe('ReportsController.index');
    });

    it('⭐ CONTROL: a REAL trailing comment is still stripped', async () => {
      // The fix must not simply stop stripping comments. A commented-out route must stay ignored,
      // or the extractor starts inventing endpoints that do not exist.
      const refs = await run({
        'config/routes.rb': routes("  get 'live', to: 'reports#show' # get 'dead', to: 'ghosts#index'"),
      });
      expect(refs).toHaveLength(1);
      expect(refs[0].target).toBe('ReportsController.show');
      expect(refs.map((r) => r.target), 'a commented-out route must not become an endpoint')
        .not.toContain('GhostsController.index');
    });

    it('⭐ CONTROL: a WHOLE-LINE comment is still ignored', async () => {
      const refs = await run({ 'config/routes.rb': routes("  # get 'dead', to: 'ghosts#index'") });
      expect(refs).toHaveLength(0);
    });

    it('⛔ A COMMENT MUST NOT SUPPLY THE `to:` FOR A LIVE LINE', async () => {
      // ⛔ THE CONTROL THAT ACTUALLY DISCRIMINATES, and the two above do NOT.
      //
      // A mutant that stops stripping comments ENTIRELY survived them both: the parsers anchor at
      // `^\s*`, so a line beginning with `#` never matches regardless, and on a trailing comment the
      // lazy `.*?` reaches the FIRST `to:` — the live one — either way.
      //
      // This is the shape where stripping genuinely decides the answer: the live part has NO `to:`,
      // so without stripping the regex reaches ACROSS the `#` and invents an endpoint that exists
      // only inside a comment.
      const refs = await run({ 'config/routes.rb': routes("  get 'a' # to: 'ghosts#index'") });
      expect(refs, 'a commented-out target must not be adopted by a live route').toHaveLength(0);
    });

    it('⭐ IT DISCRIMINATES: of three lines, exactly the two live routes are extracted', async () => {
      const refs = await run({
        'config/routes.rb': routes([
          "  get 'a', to: 'alpha#show'",
          "  # get 'b', to: 'beta#show'",
          "  get 'c', to: 'gamma#show' # trailing note",
        ].join('\n')),
      });
      expect(refs.map((r) => r.target).sort()).toEqual(['AlphaController.show', 'GammaController.show']);
    });
  });
});
