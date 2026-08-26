import { describe, expect, it } from 'vitest';
import { canonicalise, diffSets } from '../../../scripts/ab-graph-effect.mjs';

// ⛔ THE CARRIER THAT PRODUCES MY EVIDENCE HAD NO CONTROL OF ITS OWN.
//
// Six defects were found in this harness across one day — it mutated the main checkout, named a
// commit the run did not execute, discarded the populations it compared, labelled itself into its
// own measurement, addressed its artifacts at a temp path, and emitted evidence that could not be
// committed. Every one was caught by review or by chasing a residue, never by a test.
//
// An instrument whose output is published as evidence needs the same controls it demands of the code
// it measures. These are the two pure functions the receipt's claims rest on.

const SEP = String.fromCharCode(1);
const key = (...fields) => fields.join(SEP);

describe('canonicalise — what the published hashes are hashes OF', () => {
  it('⛔ is order-independent, or a replay could never reproduce the hash', () => {
    // The whole point of publishing a hash is that a re-run recomputes it. If insertion order leaked
    // into the digest, every "reproducible from the subject commit" claim would be false.
    const a = canonicalise([key('z', 'Node', 'zeta'), key('a', 'Node', 'alpha')]);
    const b = canonicalise([key('a', 'Node', 'alpha'), key('z', 'Node', 'zeta')]);
    expect(a.hash).toBe(b.hash);
    expect(a.text).toBe(b.text);
  });

  it('⛔⛔ emits NO raw control byte — the guard that makes it committable at all', () => {
    // Set keys join their fields with U+0001. Writing them verbatim produced evidence this
    // repository's own scan REJECTS, which was found only after committing 15MB of it. Tab is
    // permitted and is equally absent from ids, labels and paths.
    const { text } = canonicalise([key('id1', 'File', 'a.js'), key('id2', 'Function', 'run')]);
    const offending = [...Buffer.from(text, 'utf8')]
      .filter((ch) => ch < 9 || (ch > 10 && ch < 32 && ch !== 13));
    expect(offending, 'a raw control byte here fails tests/unit/no-raw-nul-bytes').toHaveLength(0);
    expect(text).toContain('\t');
  });

  it('⭐ CONTROL: the fields survive the rewrite', () => {
    // Without this, "no control bytes" would also be satisfied by discarding the data.
    const { text, count } = canonicalise([key('id1', 'File', 'a.js')]);
    expect(count).toBe(1);
    for (const field of ['id1', 'File', 'a.js']) expect(text).toContain(field);
  });

  it('⛔ the count is the member count, not the byte length', () => {
    expect(canonicalise([]).count).toBe(0);
    expect(canonicalise(['x', 'y', 'z']).count).toBe(3);
  });

  it('⛔ two different rows cannot collide into one', () => {
    // An earlier version joined fields with an EMPTY string, so id "a" + type "b" and id "ab" +
    // type "" produced the same key. Two distinct rows comparing equal would make the diff
    // under-report with no error anywhere.
    const both = canonicalise([key('a', 'b'), key('ab', '')]);
    expect(both.count).toBe(2);
    expect(both.text.trim().split('\n')).toHaveLength(2);
  });
});

describe('diffSets — the comparator the inclusion claims rest on', () => {
  const setOf = (...ks) => new Set(ks);

  it('⛔ detects a planted difference', () => {
    // Run inline as a one-off control when the harness was first used; permanent now. A comparator
    // that answers "no difference" for everything is indistinguishable from a real null.
    const a = setOf('e1', 'e2', 'e3');
    const b = setOf('e1', 'e2');
    const d = diffSets(a, b);
    expect(d.onlyA).toEqual(['e3']);
    expect(d.onlyB).toEqual([]);
  });

  it('⛔ reports BOTH directions, because a one-directional check hides a swap', () => {
    const d = diffSets(setOf('x'), setOf('y'));
    expect(d.onlyA).toEqual(['x']);
    expect(d.onlyB).toEqual(['y']);
  });

  it('⭐ identical sets differ in nothing — and this is only meaningful beside the test above', () => {
    const d = diffSets(setOf('e1', 'e2'), setOf('e1', 'e2'));
    expect(d.onlyA).toEqual([]);
    expect(d.onlyB).toEqual([]);
    expect(d.aSize).toBe(2);
    expect(d.bSize).toBe(2);
  });

  it('⛔ equal SIZES do not imply equal SETS', () => {
    // The reason this compares sets at all: two offsetting differences leave every total unchanged,
    // so a totals comparison would report "no effect" on a graph that changed in both directions.
    const d = diffSets(setOf('e1', 'e2'), setOf('e1', 'e9'));
    expect(d.aSize).toBe(d.bSize);
    expect(d.onlyA).toEqual(['e2']);
    expect(d.onlyB).toEqual(['e9']);
  });
});
