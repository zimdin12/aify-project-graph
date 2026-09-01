// ★ M1's STOP CONDITION, as a test: a same-name-different-symbol fixture proves the caller sets
// DO NOT MERGE.
//
// This is the one thing grep structurally cannot do. Two classes named `Widget`, each with a
// `render` method, each called from a different function. `grep -n render` returns both call sites
// with nothing to say which belongs to which class. A graph that cannot separate them is not
// buying an agent anything over grep.
//
// ⛔ THE SPINE IS NOT OPTIONAL. graphIndex alone leaves caller sets HEURISTIC-ONLY — its own
// nextAction says so. The tree-sitter resolver emits the bare target `render` with no receiver, so
// the method call cannot be attributed by name and lands on an External stub. Attribution comes
// from the LSP layer, so this test collects it.
//
// ⛔ AND THE FIXTURE'S MANIFEST IS LOAD-BEARING. Without package.json/tsconfig.json tsserver
// resolves nothing across files: 0 CALLS edges instead of 10. See FIXTURE-NOTES.md. A previous
// conclusion that attribution was "structurally unavailable" came from measuring the
// manifest-less fixture.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphIndex } from '../../mcp/stdio/query/verbs/index.js';
import { graphCallers } from '../../mcp/stdio/query/verbs/callers.js';
import { graphCollectCodeIntel } from '../../mcp/stdio/query/verbs/collect_code_intel.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/identity-callers-js', import.meta.url));

let repoRoot;
let collected;

beforeAll(async () => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-m1-'));
  fs.cpSync(FIXTURE, repoRoot, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: repoRoot, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'i');
  await graphIndex({ repoRoot });
  collected = await graphCollectCodeIntel({ repoRoot, language: 'typescript', scope: 'all' });
}, 300000);

afterAll(() => { try { fs.rmSync(repoRoot, { recursive: true, force: true }); } catch { /* handle */ } });

const callersOf = async (symbol) => {
  const text = String(await graphCallers({ repoRoot, symbol, top_k: 20, depth: 1 }));
  const lines = text.split('\n').filter((l) => !/AMBIGUOUS|Retry|candidates/.test(l));
  return ['alphaCaller', 'betaCaller'].filter((c) => lines.some((l) =>
    new RegExp(`(^|[^A-Za-z0-9_])${c}([^A-Za-z0-9_]|$)`).test(l)));
};

describe('M1 — caller sets for same-named symbols do not merge', () => {
  // ⛔ THIS ASSERTION MUST COME FIRST. Without it, "the sets did not merge" would also pass when
  // the collection produced nothing at all — two EMPTY sets trivially do not merge. That vacuous
  // pass is exactly what a manifest-less fixture produces, and it read as a working guard.
  it('POSITIVE CONTROL: the LSP import created caller edges', () => {
    expect(collected?.status, 'collection must succeed').toBe('ok');
    expect(collected?.imported?.recordsImported ?? 0,
      'records must be imported, or every absence below is about the collection').toBeGreaterThan(0);
    expect(collected?.imported?.edgesCreated ?? 0,
      'CALLS edges must exist, or a disjoint result below is vacuous').toBeGreaterThan(0);
  });

  it("★ alpha's caller set contains alphaCaller and NOT betaCaller", async () => {
    for (const symbol of ['alpha.Widget.render', 'alpha::Widget::render']) {
      expect(await callersOf(symbol), `${symbol} must resolve to alpha's caller only`)
        .toEqual(['alphaCaller']);
    }
  });

  it("★ beta's caller set contains betaCaller and NOT alphaCaller", async () => {
    for (const symbol of ['beta.Widget.render', 'beta::Widget::render']) {
      expect(await callersOf(symbol), `${symbol} must resolve to beta's caller only`)
        .toEqual(['betaCaller']);
    }
  });

  it('the two sets are DISJOINT — the property M1 actually claims', async () => {
    const alpha = await callersOf('alpha.Widget.render');
    const beta = await callersOf('beta.Widget.render');
    expect(alpha.length, 'alpha set must be non-empty').toBeGreaterThan(0);
    expect(beta.length, 'beta set must be non-empty').toBeGreaterThan(0);
    expect(alpha.filter((c) => beta.includes(c)),
      'no caller may appear in both sets — that is symbol identity failing').toEqual([]);
  });

  it('a BARE ambiguous name still refuses, and names the qualified candidates to retry with', async () => {
    const text = String(await graphCallers({ repoRoot, symbol: 'render', top_k: 20, depth: 1 }));
    expect(text, 'a bare ambiguous name must not silently pick one').toMatch(/AMBIGUOUS MATCH/);
    // The refusal must be a route forward, not a dead end — M1's actual complaint.
    expect(text).toMatch(/Widget\.render|Widget::render/);
  });
});
