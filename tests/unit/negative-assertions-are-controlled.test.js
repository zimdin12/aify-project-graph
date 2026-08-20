// ⛔ THE MECHANISM WAS NEVER MISSING. ADOPTION WAS.
//
// `tests/helpers/live-matcher.js` has existed since 0d97826 (2026-08-12) and is stronger than
// anything hand-rolled: a forbidden canary proving the matcher CAN fire, an allowed canary proving
// it is not simply matching everything, and a lastIndex-safe clone so a /g regex cannot consume
// its own probe.
//
// Eight days later it had THREE call sites, against 158 bare `not.toMatch(`.
//
// And the vacuous property test that shipped tonight did not fail for want of a helper. It failed
// while hand-rolling a WEAKER inline copy of one, in a file that imports nothing from
// live-matcher.js. ef-manager found the helper by grepping for the remedy; I had reasoned from the
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
// The existing 158 are grandfathered by an explicit, visible baseline. What is forbidden is
// ADDING to it: a new bare `not.toMatch` in a file not on the list, or a higher count in a file
// that is, turns this red.
//
// ⚠ THIS IS A RATCHET, NOT A BAN. Nobody is going to migrate 158 assertions tonight, and a rule
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

// Bare negative regex assertions, by file, relative to tests/.
function census() {
  const counts = {};
  for (const file of walk(TESTS)) {
    const src = readFileSync(file, 'utf8');
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
const BASELINE_TOTAL = 157;

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

  it('★★★ the controlled helper is actually reachable and exports what callers need', () => {
    // ⚠ A rule pointing at a helper that does not exist is worse than no rule: it reads as a
    // solved problem. This is the positive control on the instruction itself.
    const src = readFileSync(join(TESTS, 'helpers', 'live-matcher.js'), 'utf8');
    expect(src).toMatch(/export function expectAbsentWithLiveMatcher/);
    expect(src, 'the forbidden canary — proves the matcher can fire').toMatch(/DEAD INSTRUMENT/);
    expect(src, 'the allowed canary — proves it is not matching everything')
      .toMatch(/OVERBROAD INSTRUMENT/);
  });

  it('★★★ adoption is reported, so "available" is never mistaken for "adopted"', () => {
    // ef-manager: "A helper nobody reaches for is not a control; it is an available control, which
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
