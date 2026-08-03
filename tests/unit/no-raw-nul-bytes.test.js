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

describe('★ no tracked source file contains a raw NUL byte', () => {
  it('every tracked text file is searchable by ripgrep-class tooling', () => {
    const offenders = [];
    for (const rel of trackedSourceFiles()) {
      let buf;
      try { buf = readFileSync(join(repoRoot, rel)); } catch { continue; }
      const count = buf.reduce((n, b) => (b === 0 ? n + 1 : n), 0);
      if (count > 0) offenders.push(`${rel} (${count} NUL byte${count === 1 ? '' : 's'})`);
    }
    // Write the delimiter as the escape `\x00`, never as a literal byte — the
    // runtime value is identical and the file stays greppable.
    expect(offenders).toEqual([]);
  });
});
