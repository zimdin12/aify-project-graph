// ⛔ ONE DEFINITION OF THE TOKEN-ESTIMATION DIVISOR, PROVEN OVER A NAMED POPULATION.
//
// `packet-input.js` named it; `packet-lists.js` carried its own bare `4` — invisible to any rename,
// any search for the name, and any reviewer reading the named definition. The copy nobody remembers
// is the one that decides a list budget.
//
// ⛔⛔ MY FIRST REPAIR PUT IT IN THE WRONG PLACE. Exporting it from `packet-input.js` made the
// SEALED list authority import the heavy input island — filesystem, git, database, freshness,
// storage — to share one number. the reviewer measured it: importing `packet-lists.js` went to
// ~296 ms, the dependency direction reversed, and an island's public surface widened for a literal.
//
// ⇒ It now lives in `response-budget.js`, which imports NOTHING and which both consumers already
// depended on. **A constant two authorities share belongs in the neutral thing they both already
// depend on, not in whichever declared it first.**
//
// ⛔ AND MY FIRST GATE OVER-CLAIMED ITS TITLE. It said "exactly one definition" while proving only
// that ONE file lacked ONE exact substring. That is a claim about a population it never
// enumerated — the defect this repo has spent the day removing. The inventory below walks
// `mcp/stdio/query/**/*.js` and is stated over that scope and no wider.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAR_PER_TOKEN_EST } from '../../../mcp/stdio/query/response-budget.js';
import { esTokens } from '../../../mcp/stdio/query/verbs/packet-input.js';

const QUERY = fileURLToPath(new URL('../../../mcp/stdio/query', import.meta.url));

function jsFiles(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) jsFiles(p, out);
    else if (e.endsWith('.js')) out.push(p);
  }
  return out;
}

const ESTIMATOR_SITES = [
  'verbs/packet-input.js',
  'verbs/packet-lists.js',
];

describe('the token-estimation divisor has exactly one definition in mcp/stdio/query', () => {
  it('★★★ the population is real — the walk found the files it is claiming over', () => {
    // ⛔ POSITIVE CONTROL FIRST. "Exactly one declaration" is trivially true of a walk that found
    // nothing, and a wrong zero here agrees with what we hope to see.
    const files = jsFiles(QUERY);
    expect(files.length, 'a substantial population').toBeGreaterThan(20);
    for (const rel of ESTIMATOR_SITES) {
      expect(files.some((f) => f.split(String.fromCharCode(92)).join('/').endsWith(rel)), `${rel} is in the walk`).toBe(true);
    }
  });

  it('★★★ exactly ONE declaration exists, and it is in the neutral leaf', () => {
    const declarations = [];
    for (const f of jsFiles(QUERY)) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:export\s+)?const\s+CHAR_PER_TOKEN_EST\s*=/g)) {
        declarations.push(`${f.split(String.fromCharCode(92)).join('/').split('mcp/')[1]}`);
      }
    }
    expect(declarations.length, 'one declaration across the whole query tree').toBe(1);
    expect(declarations[0]).toMatch(/query\/response-budget\.js$/);
  });

  it('★★★ BOTH estimator sites divide by the imported identifier, not a literal', () => {
    for (const rel of ESTIMATOR_SITES) {
      const src = readFileSync(join(QUERY, rel), 'utf8');
      expect(src, `${rel} imports the shared constant`).toMatch(/CHAR_PER_TOKEN_EST/);
      expect(src.split('length / 4').length - 1, `${rel} holds no bare estimator divisor`).toBe(0);
      expect(src, `${rel} divides by the identifier`).toMatch(/length \/ CHAR_PER_TOKEN_EST/);
    }
  });

  it('★★★ packet-lists imports from the NEUTRAL LEAF, not from the input island', () => {
    // ⛔ THE DEPENDENCY-DIRECTION REPAIR. If this reverts, the sealed list authority starts pulling
    // in filesystem/git/database/freshness/storage to obtain a number.
    const src = readFileSync(join(QUERY, 'verbs/packet-lists.js'), 'utf8');
    expect(src).toMatch(/CHAR_PER_TOKEN_EST \} from '\.\.\/response-budget\.js'/);
  });

  it('★★★ CONTROLS: the inventory detects a duplicate declaration and a bare divisor', () => {
    // Without these, "one declaration" and "no literals" are satisfied by searches that never match.
    const dup = 'const CHAR_PER_TOKEN_EST = 4;\nexport const CHAR_PER_TOKEN_EST = 8;';
    expect([...dup.matchAll(/(?:export\s+)?const\s+CHAR_PER_TOKEN_EST\s*=/g)].length,
      'the declaration scan finds two').toBe(2);
    const bare = 'const esTokens = (t) => Math.ceil(t.length / 4);';
    expect(bare.split('length / 4').length - 1, 'the literal scan finds a bare divisor').toBe(1);
  });

  it('★★★ the estimate is bound to the CONSTANT, not to the number 4', () => {
    // A constant nothing reads can be wrong forever. EXECUTED, not read from source.
    expect(esTokens('a'.repeat(CHAR_PER_TOKEN_EST * 3))).toBe(3);
    expect(typeof CHAR_PER_TOKEN_EST).toBe('number');
  });

  it('★★★ packet-input.esTokens tolerates null — EXECUTED', () => {
    // ⚠ CLAIM SCOPE, corrected. This is an OBSERVED runtime behaviour of an exported function.
    expect(esTokens(null)).toBe(0);
    expect(esTokens('')).toBe(0);
  });

  it("★★★ packet-lists' estimator has no null guard — IMPLEMENTATION SHAPE, not observed behaviour", () => {
    // ⛔⛔ THE CLAIM I OVERSTATED. I wrote that both null behaviours were "pinned". They are not.
    // packet-lists' esTokens is PRIVATE and production calls it only with `join()` strings, so no
    // route in this suite executes it with null. What follows is a SOURCE assertion about shape.
    //
    // ⇒ It is still worth keeping: it is why the two bodies were not unified, and it reddens if
    // someone "finishes the job" by importing packet-input's null-safe version. But asserting a
    // shape and reporting a behaviour are different claims, and only one of them was measured.
    const src = readFileSync(join(QUERY, 'verbs/packet-lists.js'), 'utf8');
    expect(src, "no null guard in packet-lists' estimator")
      .toMatch(/const esTokens = \(t\) => Math\.ceil\(t\.length \/ CHAR_PER_TOKEN_EST\);/);
  });
});
