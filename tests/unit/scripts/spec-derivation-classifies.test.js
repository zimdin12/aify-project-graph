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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declaredSpecs, SPEC_DIR, APPARATUS_FILES } from '../../helpers/self-review-specs.js';

// ⛔ PLANTED INTO A COPY, NEVER INTO tests/self-review. This file used to write its malformed specs into the real
// directory and remove them afterwards. Once the unit tier ran files in parallel (#10), anchor-addressability read
// the directory while a planted file sat in it and went red on object.spec.json and partial.spec.json (gate run of
// 2026-11-08). Each case below still derives the real population plus one planted file.
let dir;
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'apg-specs-')), 'self-review');
  cpSync(SPEC_DIR, dir, { recursive: true });
});
afterEach(() => { try { rmSync(join(dir, '..'), { recursive: true, force: true }); } catch { /* win lock */ } });
const write = (name, body) => writeFileSync(join(dir, name), body);
const derive = () => declaredSpecs(dir);

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
    expect(() => derive()).toThrow(/unclassified \.json/);
  });

  it('★★★ a *.spec.json that does not parse THROWS', () => {
    write('broken.spec.json', '{ this is not json');
    expect(() => derive()).toThrow(/does not parse/);
  });

  it('★★★ a *.spec.json holding a non-array THROWS', () => {
    write('object.spec.json', '{"name": "not an array"}');
    expect(() => derive()).toThrow(/does not hold an array/);
  });

  it('★★★ an EMPTY *.spec.json THROWS — indistinguishable from deleted in the totals', () => {
    write('empty.spec.json', '[]');
    expect(() => derive()).toThrow(/declares no witnesses/);
  });

  it('★★★ a declaration missing required fields THROWS, and names them', () => {
    write('partial.spec.json', JSON.stringify([{ name: 'P1 half a declaration', file: 'x.js' }]));
    expect(() => derive()).toThrow(/missing from, to, tests/);
  });

  it('★★★ apparatus is skipped BY EXACT NAME, and the ledger is the only entry', () => {
    // ⚠ A pattern would absorb misnamed specs. Pinning the set means every exclusion is a decision
    // someone wrote down, and adding one is visible in review.
    expect([...APPARATUS_FILES]).toEqual(['migration-ledger.json']);
  });

  it('★★★ CONTROL: the copy derives exactly what the real directory does', () => {
    // Every planted case derives the copy. If the copy differed from the real directory, a throw could come from the
    // copying rather than from the planted file.
    expect(derive()).toEqual(declaredSpecs());
  });
});
