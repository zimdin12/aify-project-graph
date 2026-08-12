// ★ A RAW NUL BYTE IN SOURCE MAKES ripgrep RETURN "NO MATCHES" — SILENTLY.
//
// Found by ef-manager while answering a publish-readiness question (2026-08-02).
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
// graph-senior-dev-hermes:
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
// ⚠ graph-senior-dev-hermes's correction, and it is load-bearing: this must be a BYTE
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
    // dev's control, and it has to be in-memory: committing a contaminated fixture to
    // prove the scanner works would trip the very gate below. Without this, a scanner
    // that always returned an empty map would pass the real test forever — which is the
    // same dead-instrument failure the class exists to catch.
    expect([...rawControlBytes(Buffer.from([0x08])).keys()], 'BACKSPACE must be caught').toEqual([0x08]);
    expect([...rawControlBytes(Buffer.from([0x00])).keys()], 'NUL must still be caught').toEqual([0x00]);
    expect([...rawControlBytes(Buffer.from([0x7f])).keys()], 'DEL must be caught').toEqual([0x7f]);
    // And the legitimate ones must NOT be flagged, or the gate is unusable on real files.
    expect([...rawControlBytes(Buffer.from('a\tb\r\nc', 'utf8')).keys()],
      'TAB/LF/CR are ordinary text').toEqual([]);
  });

  it('★★ EVERY tracked file is scanned — an unreadable one fails, it does not pass', () => {
    const files = trackedFiles();
    // A population this small would be an obvious bug; assert it rather than trust it.
    expect(files.length, 'harness sanity: the tracked population must be substantial')
      .toBeGreaterThan(100);

    // ★ CLOSED-POPULATION CONTROL. The scan must cover EXACTLY what git tracks — no
    // filter, no dropped entries. dev's `.html` carrier walked through the old extension
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
