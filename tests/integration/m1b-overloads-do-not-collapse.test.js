// ★ M1b's OPEN HALF: two overloads must not be answered as one symbol.
//
// The plan's M1b stop condition is stricter than M1a's and warns why:
//
//   > a same-name-different-symbol fixture passes while a renderer still collapses overloads
//   > and forks decl/def.
//
// `tests/fixtures/identity-hostile` exists for exactly that, and its ground truth states
// *"alpha::clamp(int) vs alpha::clamp(double) must NOT merge"*. Before this, `clamp` returned
// NO CALLERS with ZERO candidates — a false SPECIFIC answer, which is worse than a refusal
// because an agent cannot tell it from a true one.
//
// ⛔ SPLITTING IS ONLY HALF THE BAR. The first working version made the two candidates render
// IDENTICALLY (same qualified name, differing only by line) while telling the agent to "add more
// namespace qualification" — advice no C++ program can follow for an overload set. M1's own words
// are that a refusal must not be a DEAD END, so the discriminator and the hint are asserted here,
// not just the group count.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphIndex } from '../../mcp/stdio/query/verbs/index.js';
import { graphCallers } from '../../mcp/stdio/query/verbs/callers.js';
import { expectAbsentWithLiveMatcher } from '../helpers/live-matcher.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/identity-hostile', import.meta.url));
let repo;

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-m1b-'));
  fs.cpSync(FIXTURE, repo, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'i');
  await graphIndex({ repoRoot: repo });
}, 600000);

afterAll(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* handle */ } });

const ask = async (symbol) => {
  const text = String(await graphCallers({ repoRoot: repo, symbol, top_k: 20, depth: 1 }));
  return { text, lines: text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')) };
};

describe('M1b — an overload set is not one identity', () => {
  // ⛔ THIS RUNS FIRST. Every assertion below is about how ambiguity is REPORTED, and the whole
  // file would pass vacuously against a resolver that had simply stopped resolving anything.
  it('POSITIVE CONTROL: the property that already worked still works', async () => {
    const { lines } = await ask('render');
    expect(lines.length, 'alpha::Widget::render and beta::Widget::render must both appear').toBe(2);
    expect(lines.some((l) => l.includes('alpha::Widget::render'))).toBe(true);
    expect(lines.some((l) => l.includes('beta::Widget::render'))).toBe(true);
  });

  it('POSITIVE CONTROL: the decl/def pair still resolves to ONE identity (6372aae)', async () => {
    const { text } = await ask('alpha::Widget::render');
    expectAbsentWithLiveMatcher(
      /AMBIGUOUS MATCH/,
      { forbidden: 'AMBIGUOUS MATCH for "alpha::Widget::render". 2 concrete candidates found:',
        allowed: 'NO CALLERS for "alpha::Widget::render"' },
      text,
      'splitting overloads must not re-fork the decl/def pair',
    );
  });

  it('★ the two clamp overloads are reported as TWO candidates, not answered as one', async () => {
    const { text, lines } = await ask('clamp');
    expect(text).toMatch(/AMBIGUOUS MATCH/);
    expect(lines.length, 'ground truth: clamp(int) and clamp(double) must not merge').toBe(2);
  });

  it('⛔ NOT A DEAD END: the two candidates are DISTINGUISHABLE from each other', async () => {
    // Two identical bullets would be a refusal an agent cannot act on. This is the assertion the
    // first working version of the change would have failed.
    const { lines } = await ask('clamp');
    const withoutLocation = lines.map((l) => l.replace(/\s+\S+:\d+$/, ''));
    expect(new Set(withoutLocation).size, 'candidates must differ by more than a line number').toBe(2);
    expect(withoutLocation.some((l) => l.endsWith('(int)'))).toBe(true);
    expect(withoutLocation.some((l) => l.endsWith('(double)'))).toBe(true);
  });

  it('⛔ the retry hint does NOT tell the agent to qualify harder — nothing would separate them', async () => {
    const { text } = await ask('clamp');
    expectAbsentWithLiveMatcher(
      /Add more namespace qualification/,
      { forbidden: 'class qualification did not disambiguate. Add more namespace qualification (Namespace::Class::method) or query one file',
        allowed: 'These are an OVERLOAD SET — same qualified name, DIFFERENT PARAMETER TYPES' },
      text,
      'an overload set is the one ambiguity more qualification cannot resolve',
    );
    expect(text).toMatch(/OVERLOAD SET/);
  });

  it('qualifying the name does not silence the overload ambiguity', async () => {
    // `alpha::clamp` is the retry an agent would naturally attempt. It must still refuse — a
    // qualifier that appears to resolve an overload set would be the false-specific answer back.
    const { text, lines } = await ask('alpha::clamp');
    expect(text).toMatch(/AMBIGUOUS MATCH/);
    expect(lines.length).toBe(2);
  });
});
