// ★ A RAW NUL BYTE IN SOURCE MAKES ripgrep RETURN "NO MATCHES" — SILENTLY.
//
// Found in field testing while answering a publish-readiness question (2026-08-02).
// Three tracked source files carried raw NUL bytes, used as a dedup-key delimiter
// and written as a literal byte instead of the `\x00` escape:
//
//     mcp/stdio/ingest/code-intel/importer.js   3
//     mcp/stdio/code-intel/dedup-records.js     6
//     mcp/stdio/query/verbs/health.js           1
//
// Node does not care — the runtime value is identical either way. Tooling does:
// ripgrep classifies the file as BINARY and skips it, returning "No matches found"
// with no error. LIVE PROOF from that session: a Grep for a term occurring four
// times in importer.js returned nothing.
//
// ★ It is our own defect class aimed at our own repo — an empty result meaning "I
// did not look", read as "it is not there" — and it landed in the three files most
// worth auditing. It also nearly produced a false report: the reviewer was one step
// from telling us a function did not exist and its regression tests were vacuous.
//
// This test exists because the failure is INVISIBLE. Nothing else catches it: the
// suite passes, the code is correct, `git diff` renders normally (git's binary
// heuristic reads only the first ~8000 bytes and these sat past that).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

// ⛔ THE POPULATION WAS SELF-SELECTED, AND TWO WITHHELD CARRIERS WALKED THROUGH IT.
//
// review, hermes session:
//   1. the scan listed only *.js/*.mjs/*.cjs/*.ts/*.json/*.md, so a tracked
//      `raw-control-probe.html` carrying one 0x08 stayed GREEN — while the test's own
//      claim said "every tracked source file".
//   2. worse, it split lines and `.trim()`ed each path. A tracked file named
//      ` leading.js` had its name CHANGED by the trim, the read then failed, and the
//      `catch { continue }` swallowed it. Green again.
//
// ⇒ Both are the same defect as the thing being scanned for: a gate that reports "clean"
// when it did not look. Patching in one more extension would repeat it.
//
// THE PARTITION IS NOW CLOSED, three ways:
//   · `git ls-files -z` — NUL-separated, so path bytes survive verbatim. No trim, no
//     line splitting, no assumption that a filename lacks leading/trailing space.
//   · EVERY tracked file is scanned. `.gitattributes` declares `* text=auto eol=lf` and
//     the repo currently tracks zero binaries, so "text" is the whole population — there
//     is no filter to get wrong.
//   · a read failure FAILS. It cannot mean "clean" — that is the fail-open shape this
//     codebase exists to eliminate.
//
// ★ BINARY_FILES is the ratchet. If a genuinely binary file is ever tracked, this gate
// fails until it is listed here — a conscious decision, recorded, rather than a silent
// widening of an exclusion glob.
const BINARY_FILES = new Set([]);

// ⛔ AN EXCLUSION LIST IS AN AUTHORITY, AND IT WAS ACCOUNTABLE TO NOTHING.
//
// review, hermes session: they added the TEXT source `mcp/stdio/server-build.js` to
// BINARY_FILES, inserted two literal 0x08 bytes into it, and the gate stayed 2/2 GREEN.
// So the whole tracked population was ENUMERATED but not SCANNED — any carrier could be
// silently reclassified as binary and walk straight through.
//
// ★ I had declared the empty ratchet a "future risk". It was a live false-green: an
// exemption path with no constraint does not become dangerous when it is used, it is
// already dangerous while it is empty, because nothing stops the first use.
//
// ⇒ THREE INDEPENDENT CONSTRAINTS, because one is a preference and three are a rule:
//   1. MEMBERSHIP — BINARY_FILES must equal this hand-approved list exactly. Adding an
//      exemption requires two conscious edits, in different places.
//   2. PROOF — every exemption must actually BE binary by an independent classifier.
//      A text file cannot be smuggled in even if both lists are edited together.
//   3. The exemption still does not suppress the READ; an unreadable exemption fails.
//
// Empty today, and that is a fact worth asserting rather than assuming: this repo tracks
// no binaries, so any non-empty value is a change someone must justify.
const APPROVED_BINARY_EXEMPTIONS = [];

// ⛔ THE DENSITY CLASSIFIER WAS CIRCULAR, AND THE CIRCULARITY IS THE ELEGANT PART.
//
// review, hermes session broke the previous version five ways, but one is the root:
// adding an ordinary `smuggled.js` to both approved lists with an EARLY NUL stayed green
// "because one NUL self-justifies binary". ⇒ THE CONTAMINATING BYTE WAS ALSO THE EVIDENCE
// OF EXEMPTION ELIGIBILITY. The thing being detected was licensing its own concealment.
//
// Four more, all consequences of using a tunable heuristic as an authority:
//   · threshold >0.3 → >0.5            green
//   · >0.3 → >=0.3                     green
//   · sample 8192 → 16                 green
//   · scan limited to first 8192, NUL at byte 9000   green
// A threshold and a sample window are parameters, and parameters can be moved by the same
// patch that needs them moved.
//
// ⇒ ADMISSION NOW REQUIRES FORMAT MAGIC — a known file signature at a known offset. A
// stray NUL anywhere does not make a file a PNG, so the contaminant can no longer vouch
// for the container. There is no threshold to tune and no window to shrink, and the
// evidence is positional rather than statistical.
//
// ⚠ This is deliberately CONSERVATIVE: a real binary format not listed here is refused
// admission and the gate fails until someone adds its signature. Refusing to exempt is the
// safe direction — it costs a commit, whereas wrongly exempting hides a carrier.
const BINARY_MAGIC = [
  { name: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { name: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { name: 'zip/jar/docx', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: 'gzip', bytes: [0x1f, 0x8b] },
  { name: 'sqlite', bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00] },
  { name: 'elf', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: 'wasm', bytes: [0x00, 0x61, 0x73, 0x6d] },
  { name: 'ico', bytes: [0x00, 0x00, 0x01, 0x00] },
];

function binaryFormatOf(buf) {
  for (const sig of BINARY_MAGIC) {
    if (buf.length < sig.bytes.length) continue;
    if (sig.bytes.every((b, i) => buf[i] === b)) return sig.name;
  }
  return null;
}

// ⚠ THE RATCHET WAS UNTESTED, and I said so to dev before they could find it. An empty
// allowlist that has never admitted anything is indistinguishable from one that admits
// EVERYTHING — the exemption path had no control at all.
//
// ⇒ The scan is extracted so it can be driven over a SYNTHETIC population, which lets the
// exemption and the failure paths be exercised without committing a binary to the repo
// (which the gate would then have to exempt, making the test its own excuse).
export function scanPopulation(files, readFile, allowlist = BINARY_FILES) {
  const offenders = [];
  const unreadable = [];
  for (const rel of files) {
    if (allowlist.has(rel)) continue;
    let buf;
    try {
      buf = readFile(rel);
    } catch (e) {
      // NOT `continue`. A file we could not read is a file we did not check.
      unreadable.push(`${rel} (${e.code || e.message})`);
      continue;
    }
    const found = rawControlBytes(buf);
    if (found.size > 0) {
      offenders.push(`${rel} (${[...found.entries()].map(([b, n]) => `${hex(b)}x${n}`).join(' ')})`);
    }
  }
  return { offenders, unreadable };
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter((s) => s.length > 0);
}

// ★★ GENERALISED 2026-08-12 FROM NUL TO EVERY C0 CONTROL, and the second instance is
// why. My python edit scripts silently turned a `\b` escape into a literal BACKSPACE
// (0x08): in python that IS a valid escape, so unlike `\d` and `\w` it converted without
// a warning. Eight of them landed inside REGEX LITERALS in two test files.
//
// ⇒ Every word-boundary regex written that way was matching a control character that
// appears in no output. THE ASSERTIONS COULD NOT EXECUTE — and a dead assertion is
// indistinguishable from a live one in a green run. It also poisons mutation testing: an
// unrunnable assertion looks exactly like a surviving mutant, so I concluded twice that
// my semantics were wrong when the instrument simply was not running.
//
// ⚠ review, hermes session's correction, and it is load-bearing: this must be a BYTE
// gate, not a parser gate. My first proposal allowed controls "outside string literals" —
// but the 0x08 WAS inside a regex literal, so that exemption would have preserved the
// exact defect. In tracked text a literal backspace is never a legitimate way to spell a
// word boundary; the intended bytes are 5c 62. No exemptions.
const ALLOWED_CONTROLS = new Set([0x09, 0x0a, 0x0d]); // TAB, LF, CR

function rawControlBytes(buf) {
  const found = new Map();
  for (const b of buf) {
    if ((b < 0x20 && !ALLOWED_CONTROLS.has(b)) || b === 0x7f) {
      found.set(b, (found.get(b) ?? 0) + 1);
    }
  }
  return found;
}

const hex = (b) => `0x${b.toString(16).padStart(2, '0')}`;

describe('★ no tracked source file contains a raw control byte', () => {
  it('★★ the scanner detects a backspace — proven IN MEMORY, not by a fixture', () => {
    // the reviewer's control, and it has to be in-memory: committing a contaminated fixture to
    // prove the scanner works would trip the very gate below. Without this, a scanner
    // that always returned an empty map would pass the real test forever — which is the
    // same dead-instrument failure the class exists to catch.
    expect([...rawControlBytes(Buffer.from([0x08])).keys()], 'BACKSPACE must be caught').toEqual([0x08]);
    expect([...rawControlBytes(Buffer.from([0x00])).keys()], 'NUL must still be caught').toEqual([0x00]);
    expect([...rawControlBytes(Buffer.from([0x7f])).keys()], 'DEL must be caught').toEqual([0x7f]);
    // And the legitimate ones must NOT be flagged, or the gate is unusable on real files.
    expect([...rawControlBytes(Buffer.from('a\tb\r\nc', 'utf8')).keys()],
      'TAB/LF/CR are ordinary text').toEqual([]);

    // ⛔ SELF-REVIEW SURVIVOR E4 — WIDENING THE ALLOWED SET. Adding vertical tab (0x0b) and
    // form feed (0x0c) to ALLOWED_CONTROLS survived every case, because nothing asserted
    // they are FORBIDDEN. Both make ripgrep treat a file as binary exactly as NUL does, so
    // an allow-list that quietly grows re-opens the hole the gate exists to close.
    expect([...rawControlBytes(Buffer.from([0x0b])).keys()], 'vertical tab must be caught')
      .toEqual([0x0b]);
    expect([...rawControlBytes(Buffer.from([0x0c])).keys()], 'form feed must be caught')
      .toEqual([0x0c]);
    expect([...rawControlBytes(Buffer.from([0x1b])).keys()], 'ESC must be caught')
      .toEqual([0x1b]);
  });

  it('★★ the exemption MEMBERSHIP rule is equality, not containment', () => {
    // ⛔ SELF-REVIEW SURVIVOR E7. Replacing the equality check with "every approved entry
    // is present" survived, because both lists are empty and containment is trivially true
    // of an empty set. That weakening would let BINARY_FILES grow entries the approved
    // list never sanctioned — precisely the smuggling route.
    //
    // ⇒ The comparison is exercised on SYNTHETIC sets, so it is tested even while the real
    // lists are empty. An assertion over two empty lists cannot distinguish a strict rule
    // from a vacuous one.
    const sameMembers = (actual, approved) =>
      JSON.stringify([...actual].sort()) === JSON.stringify([...approved].sort());

    expect(sameMembers(new Set(), []), 'empty matches empty').toBe(true);
    expect(sameMembers(new Set(['a.png']), ['a.png']), 'identical sets match').toBe(true);
    expect(sameMembers(new Set(['a.png', 'smuggled.js']), ['a.png']),
      'an UNAPPROVED extra exemption must not pass').toBe(false);
    expect(sameMembers(new Set(['a.png']), ['a.png', 'b.png']),
      'a missing approved entry must not pass either').toBe(false);

    // And the real lists must satisfy that same rule.
    expect(sameMembers(BINARY_FILES, APPROVED_BINARY_EXEMPTIONS)).toBe(true);
  });

  it('★★ the RATCHET is discriminating — it admits only what is listed', () => {
    // Three properties the real scan cannot demonstrate on a repo that contains no
    // binaries. Driven over a synthetic population so the exemption path is exercised
    // without committing a binary that the gate would then have to exempt — a test whose
    // fixture is its own excuse proves nothing.
    const read = (rel) => {
      if (rel === 'unreadable.bin') { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
      if (rel === 'clean.js') return Buffer.from('const a = 1;\n', 'utf8');
      return Buffer.from([0x00, 0x08, 0x41]); // binary-looking: NUL, BS, 'A'
    };
    const files = ['clean.js', 'assets/logo.png', 'unreadable.bin'];

    // 1. NOT listed → the control bytes are reported. An allowlist that admits by default
    //    would silently pass here, which is the failure mode of every exclusion glob.
    const strict = scanPopulation(files, read, new Set());
    expect(strict.offenders.some((o) => o.startsWith('assets/logo.png')),
      'an unlisted binary must be caught, not assumed').toBe(true);

    // 2. LISTED → skipped, and ONLY it. The exemption must not widen to its neighbours.
    const lenient = scanPopulation(files, read, new Set(['assets/logo.png']));
    expect(lenient.offenders, 'a listed binary is exempt').toEqual([]);

    // 3. UNREADABLE is a failure on BOTH runs — an exemption list is not a licence to stop
    //    looking, and "could not read" may never mean "clean".
    expect(strict.unreadable.length, 'unreadable must fail regardless of the allowlist').toBe(1);
    expect(lenient.unreadable.length).toBe(1);

    // 4. And a genuinely clean text file is never a false positive, or the gate is unusable.
    expect(strict.offenders.some((o) => o.startsWith('clean.js')),
      'clean text must not be flagged').toBe(false);
  });

  it('★★ the EXEMPTION LIST is accountable — membership approved AND binariness proven', () => {
    // the reviewer's mutant: add a text source to BINARY_FILES, contaminate it, stay green. Both
    // constraints below independently stop that, so editing one list is not enough and
    // editing both is still not enough if the file is not really binary.
    expect([...BINARY_FILES].sort(), 'every exemption must be on the hand-approved list')
      .toEqual([...APPROVED_BINARY_EXEMPTIONS].sort());

    for (const rel of BINARY_FILES) {
      let buf;
      try {
        buf = readFileSync(join(repoRoot, rel));
      } catch (e) {
        throw new Error(`exempt file is unreadable, so its exemption cannot be justified: ${rel} (${e.code})`);
      }
      expect(binaryFormatOf(buf), `${rel} is EXEMPTED as binary but carries no known format `
        + 'signature — an exemption is a claim about the container, and this one is unproven')
        .toBeTruthy();
    }
  });

  it('★★ admission requires FORMAT MAGIC — a contaminant cannot vouch for its own container', () => {
    // The circularity the reviewer found: under a density rule, the very NUL being smuggled made
    // the file "look binary" and so justified exempting it from the scan that would have
    // caught it. Magic is positional, so a stray byte anywhere proves nothing.
    const smuggled = Buffer.concat([
      Buffer.from('const a = 1;\n', 'utf8'),
      Buffer.from([0x00]),                       // the contaminant itself
      Buffer.from('export default a;\n', 'utf8'),
    ]);
    expect(binaryFormatOf(smuggled), 'a NUL inside JavaScript does not make it a binary format')
      .toBeNull();

    // A leading NUL is likewise not a format — the reviewer's early-NUL variant.
    expect(binaryFormatOf(Buffer.concat([Buffer.from([0x00]), Buffer.from('let x=1', 'utf8')])),
      'a leading NUL is not a signature').toBeNull();

    // Real formats ARE admitted, or the rule is unusable rather than strict.
    expect(binaryFormatOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])))
      .toBe('png');
    expect(binaryFormatOf(Buffer.from('SQLite format 3\0extra', 'binary'))).toBe('sqlite');

    // ⛔ SELF-REVIEW SURVIVOR E1 — THE POLYGLOT. Matching the signature ANYWHERE instead of
    // at offset 0 survived every case above, because none of them put a valid signature
    // somewhere other than the start. A source file that merely CONTAINS PNG bytes would
    // then be admitted as a PNG — and a file can be made to contain anything.
    const polyglot = Buffer.concat([
      Buffer.from('// a perfectly ordinary source file\n', 'utf8'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('\nexport default 1;\n', 'utf8'),
    ]);
    expect(binaryFormatOf(polyglot), 'a signature must be AT THE START, not merely present')
      .toBeNull();

    // ⛔ SELF-REVIEW SURVIVOR E2 — A TRUNCATED SIGNATURE. Shortening the PNG magic to two
    // bytes also survived: nothing tested a NEAR MISS, so a weakened signature that
    // matches far more files looked identical to a correct one.
    expect(binaryFormatOf(Buffer.from([0x89, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])),
      'two matching bytes are not a PNG').toBeNull();
    expect(binaryFormatOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a])),
      'a signature one byte short is not a match').toBeNull();

    // And ordinary text is never admitted.
    expect(binaryFormatOf(Buffer.from('const a = 1;\n', 'utf8'))).toBeNull();
    expect(binaryFormatOf(Buffer.from('a\tb\r\nc — ünïcode\n', 'utf8'))).toBeNull();
  });

  it('★★ the scan reads EVERY byte — late contamination cannot hide past a window', () => {
    // dev restricted the scan to the first 8192 bytes and put a NUL at byte 9000: green.
    // A window is a parameter, and a parameter can be moved by the patch that needs it
    // moved. This pins the property instead: position must not matter.
    const late = Buffer.concat([
      Buffer.alloc(9000, 0x41),                 // 9000 harmless 'A'
      Buffer.from([0x00]),                      // contaminant far past any plausible window
      Buffer.alloc(100, 0x42),
    ]);
    expect([...rawControlBytes(late).keys()], 'a NUL at byte 9000 must still be found')
      .toEqual([0x00]);

    const veryLate = Buffer.concat([Buffer.alloc(200_000, 0x41), Buffer.from([0x08])]);
    expect([...rawControlBytes(veryLate).keys()], 'and so must one at byte 200,000')
      .toEqual([0x08]);
  });

  it('★★ EVERY tracked file is scanned — an unreadable one fails, it does not pass', () => {
    const files = trackedFiles();
    // A population this small would be an obvious bug; assert it rather than trust it.
    expect(files.length, 'harness sanity: the tracked population must be substantial')
      .toBeGreaterThan(100);

    // ★ CLOSED-POPULATION CONTROL. The scan must cover EXACTLY what git tracks — no
    // filter, no dropped entries. the reviewer's `.html` carrier walked through the old extension
    // list, and this is what makes that impossible rather than merely unlikely.
    const trackedCount = execFileSync('git', ['ls-files'], {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    }).split('\n').filter((l) => l.length > 0).length;
    expect(files.length, 'the scanned population must equal the tracked population')
      .toBe(trackedCount);

    // ★ PATH-IDENTITY CONTROL. The old version `.trim()`ed each path, so a tracked file
    // named ` leading.js` was renamed by the parser, failed to read, and was swallowed by
    // a `catch { continue }`. -z parsing cannot do that, and this proves the property
    // rather than trusting the flag: no path may differ from its own trimmed form
    // unnoticed — if one does, it must still be readable below.
    const withEdgeWhitespace = files.filter((f) => f !== f.trim());
    expect(withEdgeWhitespace.every((f) => files.includes(f)),
      'paths with leading/trailing space must survive parsing verbatim').toBe(true);

    const offenders = [];
    const unreadable = [];
    for (const rel of files) {
      if (BINARY_FILES.has(rel)) continue;
      let buf;
      try {
        buf = readFileSync(join(repoRoot, rel));
      } catch (e) {
        // ⛔ NOT `continue`. A file we could not read is a file we did not check, and
        // reporting that as clean is the exact defect this gate exists to catch.
        unreadable.push(`${rel} (${e.code || e.message})`);
        continue;
      }
      const found = rawControlBytes(buf);
      if (found.size > 0) {
        offenders.push(`${rel} (${[...found.entries()].map(([b, n]) => `${hex(b)}x${n}`).join(' ')})`);
      }
    }
    expect(unreadable, 'every tracked file must be readable, or the scan is incomplete')
      .toEqual([]);
    // Write the delimiter as the escape `\x00`, never as a literal byte — the
    // runtime value is identical and the file stays greppable.
    expect(offenders).toEqual([]);
  });
});
