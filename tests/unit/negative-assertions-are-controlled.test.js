// ⛔ THE MECHANISM WAS NEVER MISSING. ADOPTION WAS.
//
// `tests/helpers/live-matcher.js` has existed since 0d97826 (2026-08-12) and is stronger than
// anything hand-rolled: a forbidden canary proving the matcher CAN fire, an allowed canary proving
// it is not simply matching everything, and a lastIndex-safe clone so a /g regex cannot consume
// its own probe.
//
// Eight days later it had THREE call sites, against 154 bare negative assertions.
//
// And the vacuous property test that shipped tonight did not fail for want of a helper. It failed
// while hand-rolling a WEAKER inline copy of one, in a file that imports nothing from
// live-matcher.js. the field test found the helper by grepping for the remedy; I had reasoned from the
// defect and built a second one.
//
// ★ THE PATTERN, THREE TIMES IN ONE NIGHT, and the common factor is not knowledge:
//     · a three-state rule that did not reach its instrument
//     · FILE_LEVEL_TYPES sitting written-down while detectNodeKind checked `type = 'File'`
//     · a liveness helper that did not reach its call sites
//   In every case the correct thing was AVAILABLE and the incorrect thing was the DEFAULT.
//
// ⇒ So this is the deny-by-default inversion, applied where opting in has demonstrably not
// happened — the same move as making the packet governed-set physical rather than name-shaped.
// The existing 154 are grandfathered by an explicit, visible baseline. What is forbidden is
// ADDING to it: a new bare `not.toMatch` in a file not on the list, or a higher count in a file
// that is, turns this red.
//
// ⚠ THIS IS A RATCHET, NOT A BAN. Nobody is going to migrate 154 assertions tonight, and a rule
// that demands that would be turned off within a day. What it buys is that the number can only go
// down, and every new negative assertion has to justify itself at the moment it is written —
// which is the only moment anyone will look.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(test|spec)\.js$/.test(e)) out.push(p);
  }
  return out;
}

// ⛔ COMMENTS ARE STRIPPED BEFORE COUNTING, AND THE DIRECTION OF THE HOLE IS THE POINT.
//
// The raw count was 157, of which 3 occurrences sat on comment lines — including line 8 of THIS
// file, which quotes the number in prose. Additions were still caught, so the hole is the other
// way round: DELETING A COMMENT LOWERS THE COUNT AND BUYS A FREE VIOLATION. Edit that line 8 while
// updating the prose and the effective baseline drops to 156, so the next genuinely-new bare
// assertion lands at 157 and passes silently. The comment most likely to be edited is the one
// inside the ratchet's own file, because it quotes a number that changes.
//
// Same family as the 158-vs-157 slack, by a different route: not headroom I wrote, headroom
// anyone can create later by editing prose. Stripped, the baseline is 154 and means one thing.
// (the field test found this while answering whether the two helper-file occurrences were an
// uncovered hole. They are not — one is a comment and the other is the controlled path's own
// guarded payload — so the boundary stays at test files.)
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// Bare negative regex assertions, by file, relative to tests/.
function census() {
  const counts = {};
  for (const file of walk(TESTS)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const n = (src.match(/not\.toMatch\(/g) ?? []).length;
    if (n > 0) counts[file.slice(TESTS.length).replace(/\\/g, '/')] = n;
  }
  return counts;
}

// ⚠ THE BASELINE IS THE POPULATION AS IT STANDS, RECORDED RATHER THAN DESCRIBED. It is long on
// purpose: an honest baseline of a real debt is long, and a short one would mean the rule was
// scoped to whatever happened to be convenient. Every entry is an assertion that passes silently
// when its pattern dies.
// ⚠ EXACT, NOT ROUNDED. I first wrote 158 while the measured count was 157 — one slot of slack,
// which would have silently admitted the next new bare assertion. A ratchet with headroom is a
// ratchet that permits exactly as many violations as its headroom, and nobody notices the first
// one because the rule stays green.
const BASELINE_TOTAL = 154;

describe('negative assertions must not spread uncontrolled', () => {
  it('★★★ the number of bare not.toMatch assertions never INCREASES', () => {
    // ⛔ The whole rule. A bare `not.toMatch` passes for two different reasons — the output is
    // clean, or the pattern is dead — and a green run cannot tell them apart. New ones must use
    // `expectAbsentWithLiveMatcher`, which proves the matcher fires before trusting its silence.
    const counts = census();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total, [
      `bare not.toMatch count is ${total}, baseline ${BASELINE_TOTAL}.`,
      total > BASELINE_TOTAL
        ? 'A NEW bare negative assertion was added. Use expectAbsentWithLiveMatcher from '
          + 'tests/helpers/live-matcher.js — it proves the matcher can fire and that it is not '
          + 'overbroad, so its silence means something.'
        : 'The count went DOWN — good. Lower BASELINE_TOTAL to lock the gain in, or this rule '
          + 'quietly allows it to climb back.',
    ].join(' ')).toBeLessThanOrEqual(BASELINE_TOTAL);
  });

  it('★★★ the controlled helper actually BEHAVES — called, not read', async () => {
    // ⛔ THIS CONTROL WAS SOURCE-INSPECTION AND A COMMENT DEFEATED IT. the field test stripped the
    // overbroad canary out of live-matcher.js, watched this go red on the missing STRING, then put
    // "OVERBROAD INSTRUMENT" back in a comment with the behaviour still deleted — and the gate
    // went green. The helper the entire ratchet points at could lose the canary that makes it
    // worth pointing at, and this said everything was fine.
    //
    // ★ FOURTH consumer-side collapse tonight, and this one is inside the guard written to stop
    // the third. Their diagnosis is not carelessness: source-inspection is the DEFAULT REFLEX when
    // what you want to assert is "a file contains a mechanism", and the behavioural version
    // requires noticing you can simply call it. The correct thing was available — this helper is
    // importable, and three test files already import it — and the incorrect thing was the
    // default. Same shape as the other three.
    //
    // ⇒ Two calls, no strings. It fails when the BEHAVIOUR goes, not when the prose does.
    const { expectAbsentWithLiveMatcher } = await import('../helpers/live-matcher.js');

    // A matcher that matches NEITHER canary must be rejected as dead.
    expect(() => expectAbsentWithLiveMatcher(
      /THIS_MATCHES_NOTHING_AT_ALL/,
      { forbidden: 'a forbidden line', allowed: 'an allowed line' },
      'the subject',
      'dead-matcher control',
    ), 'a dead matcher must be refused, not silently trusted').toThrow(/DEAD INSTRUMENT/);

    // A matcher that matches BOTH canaries must be rejected as overbroad — the failure mode no
    // liveness check catches, because a too-greedy pattern is very much alive.
    expect(() => expectAbsentWithLiveMatcher(
      /line/,
      { forbidden: 'a forbidden line', allowed: 'an allowed line' },
      'the subject',
      'overbroad-matcher control',
    ), 'an overbroad matcher rejects legitimate output and must be refused')
      .toThrow(/OVERBROAD INSTRUMENT/);

    // And the ordinary path still works, or the two above would pass on a helper that always throws.
    expect(() => expectAbsentWithLiveMatcher(
      /ERROR/,
      { forbidden: 'an ERROR occurred', allowed: 'all clear' },
      'all clear',
      'happy path',
    )).not.toThrow();

    // ⛔ AND THE PAYLOAD ITSELF, WITHOUT WHICH THE THREE ABOVE PASS ON A HELPER THAT ASSERTS
    // NOTHING. the field test deleted `expect(subject, label).not.toMatch(...)` from the helper — the
    // one line that actually checks the production output — and all three controls stayed green,
    // because none of them uses a subject the matcher matches. The dead and overbroad controls
    // throw at the canary before the payload would run; the happy path only proves the helper does
    // not throw when it SHOULDN'T. Nothing proved it throws when it SHOULD.
    //
    // Consequence had this shipped: all six controlled call sites, the seal boundary included,
    // asserting nothing at all, behind a ratchet directing everyone to use them.
    expect(() => expectAbsentWithLiveMatcher(
      /ERROR/,
      { forbidden: 'an ERROR occurred', allowed: 'all clear' },
      'an ERROR occurred',                    // the subject MATCHES — this MUST fail
      'payload control',
    ), 'the helper validated its canaries and then asserted nothing about the subject').toThrow();
  });

  it('★★★ adoption is reported, so "available" is never mistaken for "adopted"', () => {
    // the field test: "A helper nobody reaches for is not a control; it is an available control, which
    // is a different thing and reads the same in a commit body." So the number is printed rather
    // than assumed — 3 of 162 was invisible until someone counted.
    let adopted = 0;
    for (const file of walk(TESTS)) {
      adopted += (readFileSync(file, 'utf8').match(/expectAbsentWithLiveMatcher\(/g) ?? []).length;
    }
    const bare = Object.values(census()).reduce((a, b) => a + b, 0);
    // eslint-disable-next-line no-console
    console.log(`NEGATIVE ASSERTIONS — controlled: ${adopted} · bare: ${bare} · `
      + `${((100 * adopted) / (adopted + bare)).toFixed(1)}% controlled`);
    expect(adopted, 'the helper must have real call sites, or the rule points at nothing')
      .toBeGreaterThan(0);
  });
});
