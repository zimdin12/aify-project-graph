// #5: Laravel routes are read from the route file's syntax tree, so every common registration form is a route.
//
// The regex this replaced matched one shape. On BookStack 0b6b667 it found 72 of 342 routes, missing every controller
// named through a namespace alias and every route inside `Route::middleware(...)->group(function () { ... })` after a
// nested closure. The fixture holds each form once; `GET /users/{id}` is the form the regex always handled (control).
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { laravelRoutesPlugin } from '../../../../mcp/stdio/ingest/frameworks/laravel.js';

const ROOT = join(process.cwd(), 'tests', 'fixtures', 'ingest', 'tiny-laravel-routes');
const out = await laravelRoutesPlugin.enrich({ repoRoot: ROOT, result: { nodes: [], edges: [], refs: [] } });
const routes = out.nodes.filter((n) => n.type === 'Route').map((n) => n.label);
const invokes = Object.fromEntries(out.refs.filter((r) => r.relation === 'INVOKES').map((r) => [r.from_label, r.target]));

describe('every registration form is a route with the right controller', () => {
  it('★★★ plain, fully qualified, C@m, invokable, controller group, namespace alias and match forms', () => {
    expect(invokes).toMatchObject({
      'GET /users/{id}': 'UserController.show',
      'GET /fq': 'UserController.index',
      'GET /legacy': 'LegacyController.index',
      'POST /d': 'InvokableController.__invoke',
      'GET /me': 'UserController.profile',
      'GET admin/dash': 'DashboardController.index',
      'GET|POST /search': 'UserController.search',
    });
  });

  it('★★★ a resource expands to its actions, honouring only()', () => {
    expect(invokes['GET photos']).toBe('PhotoController.index');
    expect(invokes['GET photos/{id}']).toBe('PhotoController.show');
    expect(routes.filter((r) => r.includes('photos'))).toHaveLength(2);
  });

  it('★★★ a route after a closure inside a group keeps the group prefix and middleware', () => {
    expect(invokes['GET admin/after']).toBe('ReportController.list');
    const after = out.nodes.find((n) => n.label === 'GET admin/after');
    const chain = out.refs.filter((r) => r.relation === 'PASSES_THROUGH' && r.from_id === after.id).map((r) => r.target);
    expect(chain).toEqual(['Audit.handle']);
  });

  it('★★★ closure and view routes are routes with NO controller target', () => {
    for (const label of ['GET /closure', 'GET admin/inline', 'GET /about']) {
      expect(routes, label).toContain(label);
      expect(invokes[label], label).toBeUndefined();
    }
  });
});
