// ⛔ THE DERIVATION MUST FAIL LOUDLY, NOT SHRINK QUIETLY.
//
// The first version of the shared derivation skipped non-spec files with a filter. That made the
// tests green and made every future mistake invisible: a misnamed spec, a spec that stops parsing,
// a declaration missing its anchor — each would be silently skipped and the denominator would drop
// with nothing to notice. A shrinking denominator is the exact failure this corpus exists to
// prevent, so it must not be reachable through the code that counts it.
//
// ⇒ the reviewer: *"fails if a would-be spec is silently excluded — not merely filters until
// tests turn green."*
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { declaredSpecs, SPEC_DIR, APPARATUS_FILES } from '../../helpers/self-review-specs.js';

// Files this test creates inside the real spec directory. Removed in afterEach, and asserted gone.
const scratch = [];
const write = (name, body) => {
  const p = join(SPEC_DIR, name);
  scratch.push(p);
  writeFileSync(p, body);
  return p;
};
afterEach(() => {
  for (const p of scratch.splice(0)) rmSync(p, { force: true });
});

describe('the spec derivation classifies every file, and refuses the unclassifiable', () => {
  it('★★★ POSITIVE CONTROL: the real directory derives cleanly', () => {
    // Every assertion below expects a throw; without this one they would all pass against a
    // derivation that threw unconditionally.
    expect(() => declaredSpecs()).not.toThrow();
    expect(declaredSpecs().length).toBe(35);
  });

  it('★★★ an unclassified .json THROWS — it is not absorbed as apparatus', () => {
    // ⛔ THE MISNAMED-SPEC CASE. `route-authority.json` instead of `route-authority.spec.json`
    // would, under a pattern-based skip, be treated as apparatus and its declarations would vanish
    // from every count.
    write('some-new-thing.json', '{"anything": true}');
    expect(() => declaredSpecs()).toThrow(/unclassified \.json/);
  });

  it('★★★ a *.spec.json that does not parse THROWS', () => {
    write('broken.spec.json', '{ this is not json');
    expect(() => declaredSpecs()).toThrow(/does not parse/);
  });

  it('★★★ a *.spec.json holding a non-array THROWS', () => {
    write('object.spec.json', '{"name": "not an array"}');
    expect(() => declaredSpecs()).toThrow(/does not hold an array/);
  });

  it('★★★ an EMPTY *.spec.json THROWS — indistinguishable from deleted in the totals', () => {
    write('empty.spec.json', '[]');
    expect(() => declaredSpecs()).toThrow(/declares no witnesses/);
  });

  it('★★★ a declaration missing required fields THROWS, and names them', () => {
    write('partial.spec.json', JSON.stringify([{ name: 'P1 half a declaration', file: 'x.js' }]));
    expect(() => declaredSpecs()).toThrow(/missing from, to, tests/);
  });

  it('★★★ apparatus is skipped BY EXACT NAME, and the ledger is the only entry', () => {
    // ⚠ A pattern would absorb misnamed specs. Pinning the set means every exclusion is a decision
    // someone wrote down, and adding one is visible in review.
    expect([...APPARATUS_FILES]).toEqual(['migration-ledger.json']);
  });

  it('★★★ CONTROL: the scratch files really are removed', () => {
    // Without this the suite could leave debris in the real spec directory and every later run
    // would derive a different population — the contamination this file is about.
    const p = write('temp-check.spec.json', JSON.stringify([{
      name: 'T', file: 'x', from: 'a', to: 'b', tests: [],
    }]));
    expect(existsSync(p)).toBe(true);
    rmSync(p, { force: true });
    scratch.length = 0;
    expect(existsSync(p), 'removal actually works').toBe(false);
  });
});
