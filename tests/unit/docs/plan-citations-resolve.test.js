// ⛔ EVERY FILE THE PLAN CITES MUST RESOLVE TO EXACTLY ONE FILE. This gate exists because the plan
// cited its own evidence by AMBIGUOUS BARE NAME — the M1 defect, in the document that defines it.
//
// Measured 2026-09-02: 18 backticked file citations in `docs/PLAN-agent-knowledge-system.md`, and 5
// did not resolve. Two were not typos but AMBIGUITY:
//
//     `FINDING.md`          -> 9 candidates under docs/evidence/
//     `PREREGISTRATION.md`  -> 7 candidates
//
// An agent following either gets exactly the AMBIGUOUS MATCH `graph_callers` refuses to guess at.
// Name is not identity — the plan's own thesis — and the plan forgot it about itself.
//
// ⛔ WHY THIS IS A GATE AND NOT A HABIT. Nine documentation defects were found in this arc, every
// one of them because someone went looking. Every CODE defect was caught by a mutant or the suite.
// Prose has no gates, which is how the plan came to invite a false caveat that the tests would have
// refused. This closes one narrow slice of that asymmetry mechanically.
//
// ⚠ A pointer that needs a search is not a pointer (CLAUDE.md). For an AGENT audience — the stated
// audience of this entire document — an under-qualified path costs a search and an ambiguous one
// costs a guess.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PLAN = join(REPO, 'docs/PLAN-agent-knowledge-system.md');

// Backticked tokens that look like a repo file: a slash-or-not path ending in a known extension.
// Prose like `graph_callers` or `--pch-storage=memory` has no extension and is not a citation.
function citations() {
  const text = readFileSync(PLAN, 'utf8');
  return [...new Set(
    [...text.matchAll(/`([A-Za-z0-9_@./-]+\.(?:md|js|mjs|json))`/g)].map((m) => m[1]),
  )];
}

// Every file in the repo with this basename, ignoring build/vcs noise. Used to tell an
// UNDER-QUALIFIED citation (one match, findable) from an AMBIGUOUS one (several).
function candidatesFor(name) {
  const target = basename(name);
  const hits = [];
  const skip = new Set(['node_modules', '.git', '.aify-graph', 'dist', 'coverage']);
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (skip.has(entry)) continue;
      const path = join(dir, entry);
      let st;
      try { st = statSync(path); } catch { continue; }
      if (st.isDirectory()) walk(path);
      else if (entry === target) hits.push(path);
    }
  };
  walk(REPO);
  return hits;
}

describe('every file the plan cites resolves to exactly one file', () => {
  it('POSITIVE CONTROL: the scan finds citations at all', () => {
    // "No broken citations" is trivially true of an empty scan, and a wrong zero here agrees with
    // exactly what we hope to see.
    expect(citations().length, 'no citations parsed — the matcher is blind, not satisfied')
      .toBeGreaterThan(5);
  });

  it('NEGATIVE CONTROL: the resolver can say NO', () => {
    // Without this, a resolver that returned "found" for everything would pass the gate below.
    expect(existsSync(join(REPO, 'docs/evidence/definitely-not-here.md'))).toBe(false);
    expect(candidatesFor('definitely-not-here.md').length).toBe(0);
  });

  it('★ every citation resolves as written', () => {
    const broken = citations().filter((c) => !existsSync(join(REPO, c)));
    expect(broken, 'a citation that does not resolve is a claim nobody can check').toEqual([]);
  });

  it('⛔ and none is an AMBIGUOUS bare name — the defect this gate was built for', () => {
    // The plan's own thesis is that a name is not an identity. `FINDING.md` had NINE candidates.
    const ambiguous = citations()
      .filter((c) => !c.includes('/'))
      .map((c) => ({ c, n: candidatesFor(c).length }))
      .filter((x) => x.n > 1)
      .map((x) => `${x.c} (${x.n} candidates)`);
    expect(ambiguous, 'cite the path, not the basename — name is not identity')
      .toEqual([]);
  });
});
