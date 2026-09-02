// ★ THE TWO NEGATIVE CLAIMS IN THE SHIPPED CAVEAT, AND WHY THEY GET A TEST.
//
// Saying "we cannot see X" is the dangerous direction: an agent that believes it will go looking
// elsewhere, and if the claim rots into being false we have taught it to distrust a correct result.
// Both claims below were WRONG once already — an earlier caveat asserted function-pointer and
// macro calls were unmodelled outright, which is false for clangd on the pointer case.
//
// What is asserted here is the HEURISTIC tier only: it is our own extractor, it needs no LLVM
// install, and it is the half that can silently drift. The clangd column lives in
// scripts/m2-conditional-compilation-probe.mjs and the fixture notes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphIndex } from '../../mcp/stdio/query/verbs/index.js';
import { graphCallers } from '../../mcp/stdio/query/verbs/callers.js';
import { expectAbsentWithLiveMatcher } from '../helpers/live-matcher.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/indirection-and-macros', import.meta.url));
let repo;

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-indir-'));
  fs.cpSync(FIXTURE, repo, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'i');
  await graphIndex({ repoRoot: repo });
}, 600000);

afterAll(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* handle */ } });

// EDGE lines only. The TRUST caveat contains the phrase `no callers`, which fooled one of my own
// probes into reading a listed caller set as an absence.
const edgesFor = async (symbol) => String(await graphCallers({ repoRoot: repo, symbol, top_k: 20, depth: 1 }))
  .split('\n').map((l) => l.trim()).filter((l) => l.startsWith('EDGE '));

describe('M2 — what the heuristic tier genuinely cannot see', () => {
  it('POSITIVE CONTROL: a plain call in the same function IS attributed', async () => {
    // Without this, both absences below would be indistinguishable from "the fixture never indexed".
    const edges = await edgesFor('demo::directTarget');
    expect(edges.length, 'the plain-call control must produce an edge').toBeGreaterThan(0);
    expect(edges.join('\n')).toMatch(/caller→demo::directTarget/);
  });

  it('★ a call reached only through a FUNCTION POINTER produces no heuristic edge', async () => {
    const text = String(await graphCallers({ repoRoot: repo, symbol: 'demo::ptrTarget', top_k: 20, depth: 1 }));
    expectAbsentWithLiveMatcher(
      /EDGE .*→demo::ptrTarget/,
      { forbidden: 'EDGE caller→demo::ptrTarget CALLS src/main.cpp:7 conf=0.60',
        allowed: 'NO CALLERS for "demo::ptrTarget".' },
      text,
      'tree-sitter cannot follow a pointer — clangd can, and the caveat says so',
    );
  });

  it('★ a MACRO-generated call produces no heuristic edge either', async () => {
    // The one construct measured blind in BOTH tiers, which is why the caveat singles it out.
    const text = String(await graphCallers({ repoRoot: repo, symbol: 'demo::macroTarget', top_k: 20, depth: 1 }));
    expectAbsentWithLiveMatcher(
      /EDGE .*→demo::macroTarget/,
      { forbidden: 'EDGE caller→demo::macroTarget CALLS src/main.cpp:7 conf=0.60',
        allowed: 'NO CALLERS for "demo::macroTarget".' },
      text,
      'the call exists only after macro expansion, which tree-sitter never performs',
    );
  });
});
