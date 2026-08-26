import { describe, expect, it } from 'vitest';
import { classify, isMemberCall, isBareCall, controlFailures } from '../../../scripts/measure-callee-classes.mjs';

// ⛔ THIS CLASSIFIER EXISTS BECAUSE A LABEL-ONLY RULE COULD NOT DO THIS JOB AND DELETED REAL EDGES.
//
// `promise.catch(() => null)` and `} catch (e) {` reach the resolver as the same bare string. The
// only place the difference survives is the source line, so the separation has to happen there — and
// this file pins the exact discriminations the reverted guard could not make.
//
// ⭐ MEASURED with these definitions on this repository: of 5,990 External CALLS edges, 3,079 are
// proven member calls, 1,968 are bare (irreducibly ambiguous), 943 are never in call position. And
// 22 labels occur as BOTH a real member call and as noise — for those, a label-only rule must delete
// one class to remove the other. That is the argument for fixing this in the extractor, in one line
// of evidence.

describe('classify — what the reverted guard could not tell apart', () => {
  it('⛔ separates a Promise .catch() from a catch clause', () => {
    // The single case that made the withdrawn rule destroy evidence.
    expect(classify('await prior.catch(() => {});', 'catch')).toBe('MEMBER');
    expect(classify('} catch (e) {', 'catch')).toBe('BARE');
  });

  it('⛔ a `new X()` construction is not a call to `new`', () => {
    expect(classify('const t = new Date().toISOString();', 'new')).toBe('NEITHER');
    // ...but an object with a `new` method is a real member call, which is why the label alone
    // never sufficed and why Ruby was the obvious counter-example all along.
    expect(classify('registry.new(spec);', 'new')).toBe('MEMBER');
  });

  it('⭐ an ordinary direct call is BARE, not NEITHER', () => {
    // Without this the classifier could call everything without a dot "not a call" and the NEITHER
    // population would be meaningless.
    expect(classify('const s = readFileSync(p);', 'readFileSync')).toBe('BARE');
  });

  it('⛔ a longer identifier that merely ENDS with the label is not a call to it', () => {
    expect(classify('return myOwnJoin(a);', 'Join')).toBe('NEITHER');
    expect(classify('const x = path.joinAll(a);', 'join')).toBe('NEITHER');
  });

  it('⛔ a prose mention is not a call', () => {
    expect(classify('// we merely mention catch here, twice: catch', 'catch')).toBe('NEITHER');
  });

  it('⛔ a parse fragment used as a label is never in call position', () => {
    expect(classify("const git = (...a) => execFileSync('git', a, {});", "execFileSync('git',")).toBe('NEITHER');
  });

  it('⭐ the two predicates disagree in the direction that matters', () => {
    // MEMBER implies call position; the reverse does not hold. If isBareCall ever started matching
    // member calls the three classes would collapse into two and NEITHER would still look sane.
    expect(isMemberCall('a.b(1)', 'b')).toBe(true);
    expect(isBareCall('a.b(1)', 'b')).toBe(false);
    expect(isBareCall('b(1)', 'b')).toBe(true);
  });
});

describe('the script refuses to report when its own controls fail', () => {
  it('⭐ controls pass as shipped', () => {
    expect(controlFailures()).toEqual([]);
  });

  it('⛔ and the gate is reachable — it is a list, not a constant', () => {
    // A control that cannot report a failure is decoration. Verified separately by mutating
    // classify() and observing exit 1; this pins the shape the entry point depends on.
    expect(Array.isArray(controlFailures())).toBe(true);
  });
});
