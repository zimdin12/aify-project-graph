// ⛔ A SUBSTRING IS NOT A MENTION.
//
// The relevance gate shipped earlier today with `text.includes(name)`. Measured on this repo's own
// labels: 1870 of 3942 relevance decisions — 47.4% — were names occurring only INSIDE longer
// identifiers, and the graph holds several single-character labels that match essentially every
// file. The clause would then tell an agent that a file mentions a symbol it does not contain.
// docs/evidence/m2-contract/FINDING-relevance-gate-fires-on-substrings.md
//
// ⛔ AND THE TRUST LINE PRINTED BESIDE THE CLAUSE ALREADY WARNED ABOUT IT — "a common name (has,
// get, writeFile) OVERCOUNTS with unrelated same-named calls". Adjacent knowledge does not stop the
// defect it describes, which is why this is a test and not a comment.
import { describe, it, expect } from 'vitest';
import { mentionsIdentifier } from '../../../mcp/stdio/query/verbs/read_freshness.js';

describe('mentionsIdentifier requires a whole identifier, not a substring', () => {
  it('⛔ POSITIVE CONTROL: a real mention matches — else every rejection below is vacuous', () => {
    expect(mentionsIdentifier('return target();', 'target')).toBe(true);
    expect(mentionsIdentifier('import { target } from "./b.js";', 'target')).toBe(true);
    expect(mentionsIdentifier('target', 'target'), 'whole file is the name').toBe(true);
    expect(mentionsIdentifier('  target  ', 'target'), 'surrounded by whitespace').toBe(true);
  });

  it('★★★ a name occurring ONLY inside a longer identifier is NOT a mention', () => {
    // The measured failure, in miniature.
    expect(mentionsIdentifier('const retargeted = 1;', 'target')).toBe(false);
    expect(mentionsIdentifier('let budget = 2;', 'get')).toBe(false);
    expect(mentionsIdentifier('widgetFactory()', 'get')).toBe(false);
    expect(mentionsIdentifier('const a_target_b = 1;', 'target'), 'underscores are identifier chars').toBe(false);
    expect(mentionsIdentifier('const target9 = 1;', 'target'), 'digits are identifier chars').toBe(false);
    expect(mentionsIdentifier('const $target = 1;', 'target'), '$ is an identifier char in JS').toBe(false);
  });

  it('★★★ it finds a LATER whole-identifier occurrence after earlier substring ones', () => {
    // The scan must not stop at the first hit. A file that mentions `retarget` before it mentions
    // `target` is exactly the case a naive first-match check gets wrong, in the SAFE-looking
    // direction: it would report no mention and stay silent when it should speak.
    expect(mentionsIdentifier('retarget(); widget; target();', 'target')).toBe(true);
  });

  it('⛔ names carrying non-identifier characters still work — the reason this is not a regex', () => {
    // \b would be wrong or unbuildable for these, and a regex would need the name escaped. C++
    // graphs this product indexes carry all three shapes.
    expect(mentionsIdentifier('Engine::start();', 'Engine::start')).toBe(true);
    expect(mentionsIdentifier('~Engine();', '~Engine')).toBe(true);
    expect(mentionsIdentifier('operator<<(os, v);', 'operator<<')).toBe(true);
    // and a longer identifier around a `::` name is still rejected
    expect(mentionsIdentifier('xEngine::startY();', 'Engine::start')).toBe(false);
  });

  it('⛔ degenerate inputs return false rather than throwing or matching everything', () => {
    expect(mentionsIdentifier('anything', '')).toBe(false);
    expect(mentionsIdentifier('', 'target')).toBe(false);
    expect(mentionsIdentifier(null, 'target')).toBe(false);
    expect(mentionsIdentifier('text', null)).toBe(false);
  });
});
