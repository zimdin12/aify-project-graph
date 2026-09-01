// ⛔ ONE FIX IS NOT A SWEEP, and this repo has paid for that lesson more than once.
//
// The construct-coverage clause ("NOT MODELLED: calls through function pointers…") shipped on
// `graph_callers` only. Four other verbs emit absence claims through the SAME helper —
// graph_callees, graph_impact, graph_neighbors, graph_trace — and every one of them was still
// answering "no callees / no impact / no path" for a C++ symbol without saying what the analysis
// cannot see. `graph_impact` is the verb an agent asks before changing something.
//
// ⛔ THIS GATE IS STRUCTURAL, NOT ATTENTIONAL, WHICH IS THE ONLY KIND THAT HOLDS HERE.
// The population is DERIVED from source at run time, so a SIXTH consumer added next month is
// enrolled automatically. A hand-kept list of verbs would be the parallel-list defect: it would go
// stale exactly when someone adds the consumer that needed catching.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERBS_DIR = fileURLToPath(new URL('../../../mcp/stdio/query/verbs/', import.meta.url));

// Every `buildAbsenceTrustLine({ … })` call site in the verb layer, with its argument text.
function absenceCallSites() {
  const sites = [];
  for (const file of readdirSync(VERBS_DIR).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(join(VERBS_DIR, file), 'utf8');
    for (const m of source.matchAll(/buildAbsenceTrustLine\(\{([^}]*)\}/g)) {
      sites.push({ file, args: m[1] });
    }
  }
  return sites;
}

describe('every absence claim names what was not modelled', () => {
  it('POSITIVE CONTROL: the scan finds call sites at all', () => {
    // A "no consumer omits language" result is trivially true of an empty scan, and a wrong zero
    // here agrees with exactly what we hope to see. This is the assertion that makes the next one
    // mean something.
    const sites = absenceCallSites();
    expect(sites.length, 'the matcher found no call sites — it is blind, not satisfied')
      .toBeGreaterThan(1);
    expect(new Set(sites.map((s) => s.file)).size, 'across several verbs').toBeGreaterThan(1);
  });

  it('★ every consumer passes a language, so the C/C++ clause can fire', () => {
    const missing = absenceCallSites()
      .filter((s) => !/\blanguage\s*:/.test(s.args))
      .map((s) => s.file);
    expect(missing, 'an absence claim with no language can never name its unmodelled constructs')
      .toEqual([]);
  });

  it('⛔ NEGATIVE CONTROL: the check can actually fail', () => {
    // The matcher above must be able to say NO. Fed a call site with no `language:`, it has to
    // report it — otherwise the green above proves nothing about the real sources.
    const forbidden = "buildAbsenceTrustLine({ noun: 'callers', db, repoRoot }";
    const allowed = "buildAbsenceTrustLine({ noun: 'callers', db, repoRoot, language: x }";
    const detect = (src) => [...src.matchAll(/buildAbsenceTrustLine\(\{([^}]*)\}/g)]
      .filter((m) => !/\blanguage\s*:/.test(m[1])).length;
    expect(detect(forbidden), 'the matcher must FLAG a call site with no language').toBe(1);
    expect(detect(allowed), 'and must NOT flag one that has it').toBe(0);
  });
});
