// ⛔ A CONSTANT MAINTAINED IN TWO PLACES WILL DISAGREE WITH ITSELF IN ONE OF THEM.
//
// `packet-input.js` named the token-estimation heuristic `CHAR_PER_TOKEN_EST = 4`. `packet-lists.js`
// carried its own `Math.ceil(t.length / 4)` with the 4 written as a LITERAL — invisible to any
// rename, any search for the name, and any reviewer reading the named definition. The copy nobody
// remembers is the one that decides a budget.
//
// graph-senior-dev flagged it while I was chasing a surviving mutant: changing CHAR_PER_TOKEN_EST
// from 4 to 2 left the guard green, because the only consumer of the NAMED constant was the legacy
// text-budget path that production does not use.
//
// ⚠⚠ AND THE TWO FUNCTIONS ARE NOT THE SAME FUNCTION. This is the part that makes the obvious fix
// wrong:
//
//     packet-input.js   esTokens(s) => Math.ceil((s || '').length / CHAR_PER_TOKEN_EST)   null-safe
//     packet-lists.js   esTokens(t) => Math.ceil(t.length / CHAR_PER_TOKEN_EST)           throws
//
// Unifying the bodies would change behaviour on null input from a throw to 0 — **a behaviour change
// wearing a de-duplication's clothes**. Only the CONSTANT is shared. The difference is preserved
// deliberately and pinned below, so a later "tidy-up" has to argue with a test rather than a
// comment.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHAR_PER_TOKEN_EST, esTokens } from '../../../mcp/stdio/query/verbs/packet-input.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../../mcp/stdio/query/verbs/${rel}`, import.meta.url)), 'utf8');

describe('the token-estimation heuristic has exactly one definition', () => {
  it('★★★ the constant is a real exported number', () => {
    // ⛔ POSITIVE CONTROL FIRST: a source scan for "no stray literals" is trivially satisfied by a
    // constant that does not exist.
    expect(typeof CHAR_PER_TOKEN_EST).toBe('number');
    expect(CHAR_PER_TOKEN_EST).toBeGreaterThan(0);
  });

  it('★★★ packet-lists.js divides by the NAMED constant, not a literal', () => {
    // The arm that was red before this slice.
    const src = read('packet-lists.js');
    expect(src, 'it imports the shared constant').toMatch(/import \{ CHAR_PER_TOKEN_EST \}/);
    expect(src.split('length / 4').length - 1, 'no bare /4 token estimate remains').toBe(0);
  });

  it('★★★ CONTROL: the literal scan can FAIL — it detects a bare divisor', () => {
    // Without this, "0 occurrences" is satisfied by a search that never matches anything.
    const synthetic = 'const esTokens = (t) => Math.ceil(t.length / 4);';
    expect(synthetic.split('length / 4').length - 1, 'the scan finds a real literal').toBe(1);
  });

  it('★★★ the two esTokens differ on NULL, and that is deliberate', () => {
    // ⛔ THE REASON THE BODIES WERE NOT UNIFIED. If someone later "finishes the job" by importing
    // packet-input's esTokens into packet-lists, this reddens — which is the point. The difference
    // is a decision, not an oversight, and the test is where that decision is enforced.
    expect(esTokens(null), 'packet-input tolerates null').toBe(0);
    expect(esTokens(''), 'and empty').toBe(0);
    expect(esTokens('abcd'), 'and divides by the constant').toBe(Math.ceil(4 / CHAR_PER_TOKEN_EST));

    // packet-lists' local copy is not exported, so its behaviour is asserted through its shape:
    // no null guard. Reading the source is the only route to a private function, and the claim is
    // narrow enough that a source read carries it.
    const src = read('packet-lists.js');
    expect(src, "packet-lists' esTokens has no null guard").toMatch(/const esTokens = \(t\) => Math\.ceil\(t\.length \/ CHAR_PER_TOKEN_EST\);/);
  });

  it('★★★ changing the constant moves the estimate — it is not decoration', () => {
    // A constant nothing reads is a constant that can be wrong forever. This binds the exported
    // function to the exported value rather than to the number 4.
    expect(esTokens('a'.repeat(CHAR_PER_TOKEN_EST * 3))).toBe(3);
  });
});
