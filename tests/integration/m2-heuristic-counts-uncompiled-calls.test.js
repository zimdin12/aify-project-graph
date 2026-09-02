// ★ THE OVERCOUNT HALF, WHICH IS OURS — and which corrected a claim already shipped.
//
// The construct-coverage caveat first said an inactive `#ifdef` branch was "invisible to BOTH
// tiers". That was DERIVED from the compile-database model and shipped without being observed.
// Measured on this fixture with a generated compile DB:
//
//     driver -> visibleCall   conf=0.95 [lsp✓]   clangd resolved it
//     driver -> hiddenCall    conf=0.60          heuristic only, NO lsp marker
//
// clangd omits the uncompiled call — that half held. But tree-sitter parses TEXT and never
// evaluates the preprocessor, so it reports a call that CAN NEVER EXECUTE. The tiers fail in
// opposite directions, and the heuristic direction is an OVERCOUNT.
//
// ⛔ WHAT THIS FILE LOCKS, AND WHY IT NEEDS NO clangd. The clangd half is third-party behaviour;
// the overcount is OURS, produced by our own extractor, and it is the half that can silently rot
// into a false claim in shipped output. Indexing alone reproduces it, so this costs no LSP time.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphIndex } from '../../mcp/stdio/query/verbs/index.js';
import { graphCallers } from '../../mcp/stdio/query/verbs/callers.js';
import { expectAbsentWithLiveMatcher } from '../helpers/live-matcher.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/conditional-compilation', import.meta.url));
let repo;

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-condcomp-'));
  fs.cpSync(FIXTURE, repo, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'i');
  await graphIndex({ repoRoot: repo });
}, 600000);

afterAll(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* handle */ } });

const callersOf = async (symbol) => String(await graphCallers({ repoRoot: repo, symbol, top_k: 20, depth: 1 }));

// `driver` must appear as a CALLER, not merely somewhere in the prose — the TRUST caveat and the
// LOCATIONS note both contain words that a naive substring match would trip on. (My own probe was
// fooled exactly once by the caveat's phrase `before any "no callers"`.)
const driverIsListed = (text) => text
  .split('\n')
  .some((l) => /^EDGE\s+driver→/.test(l.trim()));

describe('M2 — the heuristic tier reports calls that never compile', () => {
  it('POSITIVE CONTROL: the always-compiled call is attributed to driver', async () => {
    // Without this, "hiddenCall has a caller" could just as easily mean the extractor attributes
    // every call in the file to everything, and the assertion below would prove nothing.
    expect(driverIsListed(await callersOf('demo::visibleCall')),
      'the control call must be attributed, or indexing did not work').toBe(true);
  });

  it('★ the call inside an INACTIVE #ifdef branch is reported as a caller anyway', async () => {
    // This is the overcount, stated in the shipped caveat. `hiddenCall()` can never execute under
    // any compile command in this fixture, and the heuristic graph lists it regardless.
    expect(driverIsListed(await callersOf('demo::hiddenCall'))).toBe(true);
  });

  it('⛔ and that edge is NOT compiler-verified — the tier is visible in the output', async () => {
    // An agent must be able to tell the overcounted edge from a verified one. Without a collection
    // there is no lsp marker at all, and the trust line says heuristic — so the distinction the
    // caveat draws is one the reader can actually act on.
    const text = await callersOf('demo::hiddenCall');
    expect(text).toMatch(/TRUST: heuristic only/);
    expectAbsentWithLiveMatcher(
      /lsp✓/,
      { forbidden: 'EDGE driver→demo::hiddenCall CALLS src/lib.cpp:5 conf=0.95 [lsp✓]',
        allowed: 'EDGE driver→demo::hiddenCall CALLS src/lib.cpp:5 conf=0.60' },
      text,
      'no compiler evidence can exist for a branch that never compiles',
    );
  });
});
