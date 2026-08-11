// ★ graph_trace INLINES THE MOST SOURCE AND WAS VERIFYING THE LEAST.
//
// graph-senior-dev's review, 2026-08-11, reproduced live against a real C++ graph:
//
//   1. The no-path branch renders endpoint bodies with `symbol: "FROM: ${label}"` /
//      `"TO: ${label}"`. Those strings cannot occur in source, so the drift proof fired
//      on EVERY correct trace — a guaranteed false ⛔ WRONG BODY.
//   2. None of trace's three renderSourceBlock call sites passed `indexedAtMs`, so the
//      staleness check was disabled throughout. The verb that inlines the most source
//      verified the least.
//
// (1) is the second instance of one mistake in a day — file blocks were drift-proved
// against their own filename, this against a decorated label. Both pass a PRESENTATION
// string to a check that needs an IDENTIFIER. The fix separates the two roles
// (`symbol` verifies, `displayAs` is shown) rather than special-casing callers, so a
// third caller cannot repeat it without noticing the parameter.
//
// A false loud warning on a correct repo is worse than no warning: it teaches readers to
// ignore the one signal that matters.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { graphTrace } from '../../../mcp/stdio/query/verbs/trace.js';

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-trace-verify-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
  await writeFile(join(repoRoot, 'src', 'b.js'), 'export function beta() { return 2; }\n');
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repoRoot });
  execFileSync('git', ['add', '-A'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoRoot });
  await ensureFresh({ repoRoot });
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

const asText = (out) => (typeof out === 'string' ? out : JSON.stringify(out));

describe('graph_trace source verification', () => {
  it('★★ the no-path branch does NOT cry wolf on a clean, fresh index', async () => {
    const text = asText(await graphTrace({ repoRoot, from: 'alpha', to: 'beta' }));

    // Sanity FIRST: without this the case passes vacuously whenever the branch changes
    // shape or the fixture stops producing a no-path result, which is exactly how the
    // decorated-label bug survived — nothing proved the branch had run.
    expect(text, 'fixture must actually exercise the FROM/TO endpoint branch').toMatch(/FROM: alpha/);
    expect(text).toMatch(/TO: beta/);

    expect(text, 'a correct trace on a fresh index must not claim a wrong body').not.toMatch(/WRONG BODY/);
    expect(text).not.toMatch(/UNVERIFIED BODY/);
  });

  it('★ but it DOES report an unverified body once the file changes after indexing', async () => {
    // The other half. Silence is only meaningful if the check still fires when it
    // should — otherwise "no warning" would just mean the wiring is dead, which was
    // the actual state before this commit.
    const file = join(repoRoot, 'src', 'a.js');
    await writeFile(file, 'export function alpha() { return 1; }\n');
    const later = new Date(Date.now() + 120_000);
    await utimes(file, later, later);

    const text = asText(await graphTrace({ repoRoot, from: 'alpha', to: 'beta' }));

    expect(text, 'trace must pass indexedAtMs, or its staleness check is disabled')
      .toMatch(/UNVERIFIED BODY/);
  });
});
