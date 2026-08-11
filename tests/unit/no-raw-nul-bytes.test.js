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

function trackedSourceFiles() {
  const out = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.cjs', '*.ts', '*.json', '*.md'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
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

  it('every tracked text file is searchable by ripgrep-class tooling', () => {
    const offenders = [];
    for (const rel of trackedSourceFiles()) {
      let buf;
      try { buf = readFileSync(join(repoRoot, rel)); } catch { continue; }
      const found = rawControlBytes(buf);
      if (found.size > 0) {
        offenders.push(`${rel} (${[...found.entries()].map(([b, n]) => `${hex(b)}x${n}`).join(' ')})`);
      }
    }
    // Write the delimiter as the escape `\x00`, never as a literal byte — the
    // runtime value is identical and the file stays greppable.
    expect(offenders).toEqual([]);
  });
});
