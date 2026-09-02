// ⛔ A TRUST BUILDER'S FAILURE MUST NEVER BE SWALLOWED INTO SILENCE.
//
// Preregistered: docs/evidence/m2-construct-coverage/PREREGISTRATION-no-new-swallowed-trust.md
//
// Two cycles fixed THIRTEEN sites by hand where `catch { /* defensive */ }` left the trust text
// empty, shipping either a bare absence ("NO CALLERS", no caveat at all) or a bannerless result (a
// caller set with no FLOOR statement, which reads as complete). Both were measured under an induced
// fault, not inferred.
//
// That closed the instances. This closes the CLASS: the 14th such catch would otherwise be added
// tomorrow and the suite would stay green, because the symptom is the SILENT ABSENCE of text — there
// is nothing for an ordinary assertion to catch.
//
// ⚠ CEILING, stated so this is not read as a proof: it is a PROXIMITY HEURISTIC, not a parser. It
// looks ahead a bounded number of lines from each builder call for a `catch`, and requires that catch
// to assign something. It cannot see a catch further away, and it says nothing about whether the
// disclosure text is any GOOD — only that something is assigned instead of silence.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const QUERY = join(REPO, 'mcp/stdio/query');

// The whole silent-failure surface, established by census 2026-09-02: `unsearchedRelationNote` is not
// wrapped in a try at either call site (it throws loudly — fail-closed), and `constructCoverageClause`
// is only called inside `buildAbsenceTrustLine`, so its failure is already covered.
const TRUST_BUILDERS = ['buildTrustLine', 'buildAbsenceTrustLine'];
const LOOKAHEAD = 8;

function jsFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(path, out);
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

// Every builder call, paired with the catch that follows it inside the window (if any).
function builderCallSites() {
  const sites = [];
  for (const path of jsFiles(QUERY)) {
    const rel = path.slice(REPO.length).replace(/\\/g, '/');
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      // The DEFINITION is not a call site, and neither is an import or a comment about one.
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/export\s+(async\s+)?function/.test(line)) return;
      if (/^\s*import\s/.test(line)) return;
      const builder = TRUST_BUILDERS.find((b) => line.includes(`${b}(`));
      if (!builder) return;
      let catchLine = null;
      let catchBody = null;
      for (let j = i; j < Math.min(i + LOOKAHEAD, lines.length); j += 1) {
        // ⛔ SKIP COMMENT LINES HERE TOO. The first version matched the word "catch" inside the very
        // comments the fix added ("⛔ NOT an empty catch") and reported four FALSE violations against
        // already-correct code. A matcher that reads prose as code will always find what the prose is
        // about.
        if (/^\s*(\/\/|\*|\/\*)/.test(lines[j])) continue;
        if (/\bcatch\b/.test(lines[j])) { catchLine = j + 1; catchBody = lines[j]; break; }
      }
      sites.push({ file: rel, line: i + 1, builder, catchLine, catchBody });
    });
  }
  return sites;
}

// A catch that assigns is disclosing something. A catch that is empty or comment-only is silence.
const catchAssigns = (body) => body != null && /=/.test(body.replace(/\/\*.*?\*\//g, ''));

describe('a trust builder failure is never swallowed into silence', () => {
  it('POSITIVE CONTROL: the scan finds the known builder call sites', () => {
    // Thirteen were fixed by hand across two cycles. A scan that parsed none would report a clean
    // zero below and mean nothing at all.
    const sites = builderCallSites();
    expect(sites.length, 'no builder calls parsed — the scan is blind, not satisfied')
      .toBeGreaterThanOrEqual(10);
  });

  it('POSITIVE CONTROL: the scan can see catches at all', () => {
    const withCatch = builderCallSites().filter((s) => s.catchLine != null);
    expect(withCatch.length, 'no catch found near any builder call — the lookahead never matched')
      .toBeGreaterThan(0);
  });

  it('NEGATIVE CONTROL: an ASSIGNING catch is not flagged', () => {
    // Without this the gate would fire on its own fix, and "zero violations" would be unreachable.
    expect(catchAssigns("catch { line = '\\n' + ABSENCE_TRUST_UNAVAILABLE; }")).toBe(true);
    expect(catchAssigns('catch { /* defensive */ }')).toBe(false);
    expect(catchAssigns('catch { /* defensive — never block result = fine */ }')).toBe(false);
  });

  it('★★★ no trust builder sits inside a catch that assigns nothing', () => {
    const violations = builderCallSites()
      .filter((s) => s.catchLine != null && !catchAssigns(s.catchBody))
      .map((s) => `${s.file}:${s.line} ${s.builder} -> silent catch at line ${s.catchLine}`);
    expect(violations,
      'a swallowed trust failure ships a bare absence or a bannerless result — measured, not theoretical')
      .toEqual([]);
  });
});
