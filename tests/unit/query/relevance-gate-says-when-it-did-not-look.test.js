// ⛔ SILENCE MUST MEAN "I LOOKED AND FOUND NOTHING", AND NOTHING ELSE.
//
// uncommittedMentionClause had four silent returns meaning three different things: nothing
// uncommitted (honest), over the scan cap (a check that did not happen), a read error (a check that
// could not happen), and no hits (honest). The middle two wore the costume of the first.
//
// ⛔ AND THE SAME LESSON IS WRITTEN THREE FUNCTIONS ABOVE IN THAT FILE, on uncommittedSourceClause:
// "null IS A MEASUREMENT THAT FAILED, AND IT USED TO READ AS SILENCE". I reproduced it hours after
// reading it — which is why this is a test and not another comment.
// docs/evidence/m2-contract/FINDING-silence-hid-three-different-states.md
import { describe, it, expect } from 'vitest';
import { uncommittedMentionClause } from '../../../mcp/stdio/query/verbs/read_freshness.js';

const src = (n) => Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.js`, why: 'untracked' }));
const reads = (text) => () => text;
const throws = () => { throw new Error('EACCES'); };

describe('the relevance gate distinguishes "found nothing" from "did not look"', () => {
  it('⛔ POSITIVE CONTROL: a real hit still produces the clause — else every case below is vacuous', () => {
    const out = uncommittedMentionClause(
      { uncommittedSources: src(1) }, 'target', '/repo', reads('return target();'));
    expect(out).toMatch(/MAY BE INCOMPLETE/);
    expect(out).toMatch(/src\/f0\.js/);
  });

  it('⛔ HONEST SILENCE: nothing uncommitted, and no name to match, both stay silent', () => {
    expect(uncommittedMentionClause({ uncommittedSources: [] }, 'target', '/repo', reads('x'))).toBe('');
    expect(uncommittedMentionClause({ uncommittedSources: src(1) }, '', '/repo', reads('x'))).toBe('');
    expect(uncommittedMentionClause({ uncommittedSources: src(1) }, [], '/repo', reads('x'))).toBe('');
  });

  it('⛔ HONEST SILENCE: scanned and genuinely found nothing', () => {
    const out = uncommittedMentionClause(
      { uncommittedSources: src(3) }, 'target', '/repo', reads('const unrelated = 1;'));
    expect(out, 'a completed scan with no hits is the one silence that means "clean"').toBe('');
  });

  it('★★★ OVER THE CAP: says it did not look, and names the size', () => {
    // The case that fires when the tree is dirtiest — when an agent is most likely to be holding the
    // very uncommitted caller this clause exists to name.
    const out = uncommittedMentionClause(
      { uncommittedSources: src(500) }, 'target', '/repo', reads('return target();'));
    expect(out, 'must not be silent').not.toBe('');
    expect(out).toMatch(/NOT CHECKED/);
    expect(out, 'the reader needs the actual size to judge it').toMatch(/500/);
    expect(out, 'and the budget it exceeded').toMatch(/200/);
  });

  it('★★★ A READ ERROR: says the scan was partial instead of returning clean', () => {
    const out = uncommittedMentionClause(
      { uncommittedSources: src(4) }, 'target', '/repo', throws);
    expect(out).toMatch(/NOT CHECKED/);
    expect(out, 'how many could not be read').toMatch(/4 of 4/);
  });

  it('★★★ one unreadable file does NOT discard the other files\' results', () => {
    // The second bug inside the read-error path: it used to `return ''` on the first failure,
    // throwing away every other file's outcome — silently.
    let call = 0;
    const flaky = () => { call += 1; if (call === 1) throw new Error('EACCES'); return 'return target();'; };
    const out = uncommittedMentionClause({ uncommittedSources: src(3) }, 'target', '/repo', flaky);
    expect(out, 'a real hit after a failed read must still be reported').toMatch(/MAY BE INCOMPLETE/);
  });

  it('⛔ a hit OUTRANKS the partial-scan note — a fact is not weakened by an unrelated failure', () => {
    let call = 0;
    const flaky = () => { call += 1; if (call === 2) throw new Error('EACCES'); return 'return target();'; };
    const out = uncommittedMentionClause({ uncommittedSources: src(3) }, 'target', '/repo', flaky);
    expect(out).toMatch(/MAY BE INCOMPLETE/);
  });
});
