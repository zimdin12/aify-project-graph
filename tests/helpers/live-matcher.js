// A NEGATIVE ASSERTION IS ONLY EVIDENCE IF THE MATCHER COULD HAVE FIRED.
//
// `expect(output).not.toMatch(BAD)` passes for two completely different reasons:
//   1. the output is clean — what we meant, and
//   2. BAD cannot match anything at all — a dead instrument.
// Nothing in a green run separates them, and (2) has bitten this repo twice in one day:
//
//   · a `\b` written through a python heredoc became a literal BACKSPACE byte (0x08), so
//     every word-boundary regex was matching a control character that appears in no
//     output. I "repaired" the same finding twice and watched it stay green both times,
//     concluding my semantics were wrong when the regex simply was not running.
//   · an actor-enumerating regex (you / your / the agent / an agent) that genuinely ran,
//     but did not contain "THIS agent" — the phrasing the reviewer's mutant used.
//
// ⇒ review, hermes session's rule, and it is stricter than what I proposed: per-matcher
// bidirectionality, not one live assertion per file. One working matcher can happily
// coexist with seven dead ones in the same test.
//
// The contract, in order:
//   raw carrier bytes clean  (tests/unit/no-raw-nul-bytes.test.js — a byte gate, no
//                             exemption for string or regex literals)
//   → positive canary MATCHES   (the matcher can fire at all)
//   → negative canary REJECTS   (it is not simply matching everything)
//   → production subject assertion
//
// ⚠ A surviving mutant is `UNPROVEN / discriminator absent` until the instrument controls
// pass. Never infer "my semantics were wrong" from survival alone.
import { expect } from 'vitest';

// Regexes with /g or /y carry `lastIndex` across calls, so a liveness probe could consume
// the match and change the result of the assertion that follows it. Test against a clone.
const fresh = (re) => new RegExp(re.source, re.flags.replace(/[gy]/g, ''));

/**
 * Assert `subject` does NOT match `matcher`, having first proved the matcher works.
 *
 * @param {RegExp} matcher          the forbidden pattern
 * @param {object} canaries
 * @param {string} canaries.forbidden  text the matcher MUST match (proves it can fire)
 * @param {string} canaries.allowed    nearby text it must NOT match (proves it discriminates)
 * @param {string} subject          the real production output under test
 * @param {string} label            what the prohibition means, for the failure message
 */
export function expectAbsentWithLiveMatcher(matcher, { forbidden, allowed }, subject, label) {
  const probe = fresh(matcher);

  expect(probe.test(forbidden), `DEAD INSTRUMENT: ${matcher} does not match its own forbidden canary `
    + `${JSON.stringify(forbidden)} — the assertion below could never fail, so a green result `
    + 'from it means nothing').toBe(true);

  expect(fresh(matcher).test(allowed), `OVERBROAD INSTRUMENT: ${matcher} also matches the allowed `
    + `canary ${JSON.stringify(allowed)} — it would reject legitimate output`).toBe(false);

  expect(subject, label).not.toMatch(fresh(matcher));
}
