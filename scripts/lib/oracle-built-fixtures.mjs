// DOES A TEST BUILD ITS INPUT OUT OF ITS EXPECTED VALUE?
//
// ⛔ THE SHAPE, from 2026-09-04, hit twice in ninety minutes by someone actively looking for it:
//
//     for (const [reason, expected, why] of TABLE) {
//       const ready = expected !== false;          // <- the ORACLE built the STIMULUS
//       expect(fn({ ready, reason })).toBe(expected);
//     }
//
// The row cannot fail. `cold_no_warm` is emitted by the client with `ready:false`; the table expected
// `null`; so this built `{ready: true, reason: 'cold_no_warm'}` — a pair the producer never emits —
// and passed cleanly over the exact defect the row was written to catch.
//
// INVARIANT: every field of a fixture traces to the PRODUCER or to a literal. None to the oracle.
//
// ⚠ WHY THIS EXISTS AS A DETECTOR AND NOT AS A RULE: mutation testing cannot find it. Mutation asks
// "does this test detect a change from CURRENT behaviour", and a fixture built from the oracle still
// answers yes — correctly — about a baseline that was wrong to begin with. The technique is blind to
// this by construction. (Proven here: the ratchet that pinned `cold_no_warm` killed its mutant.)
//
// ⚠ LIMIT, stated so a clean result is never oversold: this finds a fixture derived from the oracle
// IN THE SAME EXPRESSION. It cannot find a case table built by CALLING the function under test, or
// pasted from its output — the same circularity one level further out, and byte-identical to an
// honest table. There is no detector for that; the defence is that a ratchet NAMES its independent
// source in the file.
//
// ⛔ NO BACKSLASH APPEARS IN THIS FILE, DELIBERATELY. The first version was written through a
// heredoc, which ate one escape level and turned every word-boundary into a literal BACKSPACE
// (U+0008) inside a template literal. It then searched 481 files for a control character that exists
// in none of them and reported 0 hits, which looked exactly like good news. Word boundaries are
// computed by hand below. On this machine an instrument containing a backslash is not trustworthy.

const WORD_CHARS = new Set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$');
const isWordChar = (c) => c !== undefined && WORD_CHARS.has(c);

/** True when `word` appears in `line` as a whole identifier. No regex, so no escape can be eaten. */
export function usesWord(line, word) {
  let i = line.indexOf(word);
  while (i !== -1) {
    if (!isWordChar(line[i - 1]) && !isWordChar(line[i + word.length])) return true;
    i = line.indexOf(word, i + 1);
  }
  return false;
}

/** A mention of the oracle inside an assertion is exactly what it is for, so it is not a hit. */
function isAssertion(line) {
  if (usesWord(line, 'expect')) return true;
  return ['.toBe', '.toEqual', '.toMatch', '.toContain', '.toBeNull', '.toThrow', '.not.']
    .some((m) => line.includes(m));
}

/** Names that hold the expected value. */
const ORACLE = new Set(['expected', 'want', 'wanted', 'shouldBe', 'expectedValue', 'exp']);

/**
 * Names that hold a case LABEL. Deriving a test's description from its expectation is fine, and
 * without this exclusion it would be most of the hits.
 */
const LABEL = new Set(['name', 'title', 'label', 'desc', 'description', 'why', 'note', 'msg', 'message']);

/**
 * Scan table-driven cases for an input field computed from the expectation.
 *
 * @param {string[]} files paths to scan
 * @param {(f: string) => string} readFile injected so the controls can run on in-memory sources
 * @returns {{file: string, line: number, text: string, oracle: string}[]}
 */
export function scanForOracleBuiltFixtures(files, readFile) {
  const hits = [];
  for (const f of files) {
    const lines = readFile(f).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const open = lines[i].indexOf('[');
      const close = lines[i].indexOf(']');
      if (open === -1 || close <= open) continue;
      const isLoop = lines[i].includes('for (') && lines[i].includes(' of ');
      const isCallback = lines[i].includes('=>')
        && ['.map(', '.forEach(', '.each('].some((m) => lines[i].includes(m));
      if (!isLoop && !isCallback) continue;

      const names = lines[i].slice(open + 1, close).split(',').map((s) => s.trim()).filter(Boolean);
      const oracle = names.find((n) => ORACLE.has(n));
      if (!oracle) continue;
      const labels = names.filter((n) => LABEL.has(n));

      let depth = 0;
      let started = false;
      for (let j = i; j < lines.length && j < i + 90; j += 1) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth += 1; started = true; } else if (ch === '}') depth -= 1;
        }
        if (j > i) {
          const text = lines[j].trim();
          const isComment = text.startsWith('//') || text.startsWith('*');
          const labelUse = labels.some((n) => usesWord(lines[j], n));
          const builds = lines[j].includes('=') || lines[j].includes('(');
          if (!isComment && usesWord(lines[j], oracle) && !isAssertion(lines[j]) && !labelUse && builds) {
            hits.push({ file: f, line: j + 1, text, oracle });
          }
        }
        if (started && depth <= 0) break;
      }
    }
  }
  return hits;
}

/** The real 2026-09-04 defect, verbatim. The detector MUST fire on it or it is blind. */
export const KNOWN_BAD = [
  'for (const [reason, expected, why] of DISCRIMINATOR) {',
  '  const ready = expected !== false;',
  '  expect(fn({ ready, reason })).toBe(expected);',
  '}',
].join('\n');

/** The corrected form, where every fixture field comes from the producer. Must stay quiet. */
export const KNOWN_GOOD = [
  'for (const [reason, ready, expected] of TABLE) {',
  '  expect(fn({ ready, reason })).toBe(expected);',
  '}',
].join('\n');
