// ★ M1's C++ ARM: same-name symbols in two namespaces, caller sets proven DISJOINT.
//
// The JS arm closed at `m1-caller-sets-do-not-merge.test.js`. This is the C++ half, and it went
// untested for the same reason the JS half nearly did: **the fixture was unconfigured**.
//
// ⛔ TWO FIXTURES, ONE ROOT CAUSE. `identity-callers-js` shipped with no package.json/tsconfig.json,
// so tsserver treated each file as an isolated script — 0 CALLS edges. `identity-callers` ships with
// no compile_commands.json, so clangd has no index, `w.render()` lands on an External stub, and the
// caller sets are empty. Both times the missing PROJECT CONFIG made the feature look structurally
// impossible, and both times that was recorded as a fact about the system.
//
// ⚠ THE COMPILE DB IS GENERATED HERE, NOT TRACKED. Its `directory`/`file` entries are absolute, so a
// committed one would be wrong on every other machine. `-nostdinc++` keeps clangd off the system
// headers: the fixture includes nothing, and a missing include path is enough to make a TU fail to
// compile while background indexing still reports idle.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphIndex } from '../../mcp/stdio/query/verbs/index.js';
import { graphCallers } from '../../mcp/stdio/query/verbs/callers.js';
import { graphCollectCodeIntel } from '../../mcp/stdio/query/verbs/collect_code_intel.js';
// FOURTH ratchet catch this session. Three prior corrections did not change the habit; the
// mechanical gate is what enforces this rule, not me.
import { expectAbsentWithLiveMatcher } from '../helpers/live-matcher.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/identity-callers', import.meta.url));
let repo;
let collected;

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-m1-cpp-'));
  fs.cpSync(FIXTURE, repo, { recursive: true });
  const posix = (p) => p.split(path.sep).join('/');
  const db = ['src/widgets.cpp', 'src/callers.cpp'].map((f) => ({
    directory: posix(repo),
    file: posix(path.join(repo, f)),
    command: `clang++ -std=c++17 -nostdinc++ -c ${f}`,
  }));
  fs.writeFileSync(path.join(repo, 'compile_commands.json'), JSON.stringify(db, null, 1), 'utf8');
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'i');
  await graphIndex({ repoRoot: repo });
  collected = await graphCollectCodeIntel({ repoRoot: repo, language: 'cpp', scope: 'all' });
}, 600000);

afterAll(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* handle */ } });

const callersOf = async (symbol) => {
  const text = String(await graphCallers({ repoRoot: repo, symbol, top_k: 20, depth: 1 }));
  const lines = text.split('\n').filter((l) => !/AMBIGUOUS|Retry|candidates|TRUST|SCOPE/.test(l));
  return {
    text,
    found: ['alphaCaller', 'betaCaller'].filter((c) => lines.some((l) =>
      new RegExp(`(^|[^A-Za-z0-9_])${c}([^A-Za-z0-9_]|$)`).test(l))),
  };
};

describe('M1 C++ arm — caller sets for same-named symbols do not merge', () => {
  // ⛔ THIS ASSERTION MUST COME FIRST. Without a live clangd spine every set below is empty, and two
  // EMPTY sets trivially "do not merge" — the vacuous pass this repo has produced before.
  it('POSITIVE CONTROL: clangd indexed the fixture and produced CALLS edges', () => {
    expect(collected?.status, 'the collection must succeed').toBe('ok');
    expect(collected?.imported?.recordsImported ?? 0,
      'records must be imported, or every absence below is about the collection').toBeGreaterThan(0);
    expect(collected?.imported?.edgesCreated ?? 0,
      'CALLS edges must exist, or a disjoint result below is vacuous').toBeGreaterThan(0);
  });

  it('IDENTITY CONTROL: a qualified C++ query resolves to ONE candidate, not a refusal', async () => {
    // The decl/def collapse (6372aae). If this refuses, the run never reaches the caller-set
    // question and any set below would be an artefact of the refusal.
    const { text } = await callersOf('alpha::Widget::render');
    expectAbsentWithLiveMatcher(
      /AMBIGUOUS MATCH/,
      { forbidden: 'AMBIGUOUS MATCH for "alpha::Widget::render". 2 concrete candidates found:',
        allowed: 'CALLERS for "alpha::Widget::render" (1 total)' },
      text,
      'the decl/def pair must resolve as ONE identity, not a refusal',
    );
  });

  it("★ alpha's caller set is exactly alphaCaller", async () => {
    expect((await callersOf('alpha::Widget::render')).found).toEqual(['alphaCaller']);
  });

  it("★ beta's caller set is exactly betaCaller", async () => {
    expect((await callersOf('beta::Widget::render')).found).toEqual(['betaCaller']);
  });

  it('⛔ the two sets are DISJOINT — the property M1 claims, in C++', async () => {
    const a = (await callersOf('alpha::Widget::render')).found;
    const b = (await callersOf('beta::Widget::render')).found;
    expect(a.length, 'alpha set must be non-empty').toBeGreaterThan(0);
    expect(b.length, 'beta set must be non-empty').toBeGreaterThan(0);
    expect(a.filter((c) => b.includes(c)),
      'a caller in both sets is symbol identity failing').toEqual([]);
  });
});
