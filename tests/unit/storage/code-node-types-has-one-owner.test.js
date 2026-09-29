// ⛔⛔ THE SEVEN CODE-NODE TYPES MAY BE SPELLED IN EXACTLY ONE PLACE.
//
// `CODE_NODE_TYPES` decides whether the graph holds any code at all: `graph_health`'s primary language
// and integrity check, `ScratchRepo.isIndexed()` (the guard that stops an A/B arm being mislabelled), and
// `testbed.mjs`'s index verdict. It carried the comment "ONE OWNER ... two copies would drift and the
// integrity check would quietly stop firing" while living MODULE-PRIVATE in `query/verbs/health.js`, so
// the claim was false the day it was written — `testbed.mjs` already had a copy, and on 2026-09-29 I
// added a third while agreeing out loud that a duplicated predicate is two options, not documentation.
//
// ⇒ dashboard-manager's generalisation, which is why this file exists rather than a fourth comment:
// THE FIX FOR "THE KNOWLEDGE DID NOT TRAVEL" IS NOT PROPAGATION, IT IS MAKING THE WRONG SPELLING
// UNSPELLABLE. Propagation fixes today's call sites and leaves the next one to whoever writes it next
// month; the cheap local spelling wins every time somebody is in a hurry, which is exactly what the
// "isIndexed() is one existsSync, there is no reason not to measure both" comment recorded happening.
//
// ⛔ THE WEAKNESS OF THIS INSTRUMENT, NAMED RATHER THAN DISCOVERED LATER. This is a SOURCE SCAN, and
// `type-lists-are-subsets-of-the-taxonomy.test.js` already records the ruling that a source parse is
// intentionally weaker than structural ownership: a rename or a reformat makes the pattern vacuous and
// the arm goes quietly green. It cannot be an import check, because the property is about TEXT — a
// duplicated literal is invisible to a runtime object. So the matcher is controlled three ways below,
// and the one that matters is that it is proven able to FIND a copy.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_NODE_TYPES } from '../../../mcp/stdio/storage/taxonomy.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OWNER = 'mcp/stdio/storage/taxonomy.js';
const SCAN_ROOTS = ['mcp', 'scripts', 'tests'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.aify-graph', 'fixtures', 'corpus']);

// The pattern is BUILT FROM THE IMPORTED LIST, never hand-written: a hand-written pattern could drift
// from the constant it polices, which is the very defect under test one level out.
const SEQUENCE = new RegExp(
  CODE_NODE_TYPES.map((t) => `'${t}'`).join(String.raw`\s*,\s*`),
);

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (/\.(?:js|mjs|cjs)$/u.test(entry.name)) {
        out.push(join(dir, entry.name));
      }
    }
  };
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO, root);
    if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) walk(abs);
  }
  return out;
}

describe('CODE_NODE_TYPES has exactly one owner', () => {
  it('★★★ the matcher can FIND a copy — without this, "no copies" is the verdict of a broken regex', () => {
    // ⛔ THE CONTROL THAT DECIDES THIS FILE. A regex that matches nothing and a tree with no duplicates
    // produce the identical green. Two spellings are fed to it, because the real defect appeared in both
    // forms: compact (the SQL literal) and spaced (the JS array).
    const compact = CODE_NODE_TYPES.map((t) => `'${t}'`).join(',');
    const spaced = CODE_NODE_TYPES.map((t) => `'${t}'`).join(', ');
    expect(SEQUENCE.test(compact), 'compact spelling must be detected').toBe(true);
    expect(SEQUENCE.test(spaced), 'spaced spelling must be detected').toBe(true);
    // And it must be able to say NO, or a match proves nothing either.
    expect(SEQUENCE.test("'Function','Method','Class'"), 'a SHORTER list is not this list').toBe(false);
  });

  it('★★★ the population is real and non-empty', () => {
    // A walk that returned nothing would report "one owner" over zero files, forever.
    const files = sourceFiles();
    expect(files.length, 'the source walk must find files').toBeGreaterThan(200);
    const rels = files.map((f) => relative(REPO, f).replace(/\\/g, '/'));
    expect(rels, 'and it must reach the owner itself').toContain(OWNER);
  });

  it('★★★ no file outside the owner spells the full seven-type sequence', () => {
    const offenders = [];
    for (const file of sourceFiles()) {
      const rel = relative(REPO, file).replace(/\\/g, '/');
      if (rel === OWNER) continue;
      // This test necessarily contains the sequence in its own controls above; exclude only itself, by
      // exact path, so the exclusion cannot quietly cover anything else.
      if (rel === 'tests/unit/storage/code-node-types-has-one-owner.test.js') continue;
      if (SEQUENCE.test(readFileSync(file, 'utf8'))) offenders.push(rel);
    }
    expect(offenders, `import CODE_NODE_TYPES from ${OWNER} instead of spelling it — a second copy of `
      + 'this list stops the integrity check firing, and nothing would say so').toEqual([]);
  });

  it('★★★ the owner declares it exactly once', () => {
    const src = readFileSync(join(REPO, OWNER), 'utf8');
    const matches = src.match(new RegExp(SEQUENCE.source, 'gu')) ?? [];
    expect(matches.length, 'one declaration in the owning module, not two').toBe(1);
  });
});
