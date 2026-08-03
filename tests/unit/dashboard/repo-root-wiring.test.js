// ★ THE DASHBOARD SHOWED ANOTHER REPO'S FEATURES OVER YOUR CODE.
//
// startDashboard({ db, port, repoRoot }) defaults repoRoot to process.cwd(). The
// verb called it as startDashboard({ db, port }) — so repoRoot became the MCP
// SERVER'S launch directory, not the repo being inspected.
//
// Measured consequence: opening the dashboard for a game engine rendered the
// engine's code graph (correct — that comes from the db) with aify-project-graph's
// OWN features overlaid on it: `graph-ingest`, `freshness`, `storage`. And
// /api/source resolved every path against the wrong tree, so the inline source
// viewer returned read_failed for every node.
//
// Invisible on a single-repo setup where cwd happens to equal the target. Wrong the
// moment one server serves a second repo — which is the normal case, since the MCP
// server is long-lived and agents point it at whatever repo they are working in.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const verb = readFileSync(join(root, 'mcp/stdio/query/verbs/dashboard.js'), 'utf8');
const server = readFileSync(join(root, 'mcp/stdio/dashboard/server.js'), 'utf8');

describe('the dashboard is wired to the repo it is inspecting', () => {
  it('passes repoRoot explicitly rather than inheriting process.cwd()', () => {
    expect(verb).toMatch(/startDashboard\(\{[^}]*repoRoot[^}]*\}\)/);
  });

  it('never calls startDashboard with only db and port', () => {
    // The exact shape of the bug.
    expect(verb).not.toMatch(/startDashboard\(\{\s*db,\s*port:[^,}]*\}\)/);
  });

  it('the overlay + source paths still derive from repoRoot, so the wiring matters', () => {
    // If these stop using repoRoot the test above becomes vacuous — pin the reason.
    expect(server).toMatch(/loadOverlayJson\(repoRoot/);
    expect(server).toMatch(/resolve\(repoRoot, rel\)/);
  });
});
