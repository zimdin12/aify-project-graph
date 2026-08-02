// ★ CAPTURING EVIDENCE IS NOT AGGREGATING IT.
//
// 3a4c5a5 made the collector compute evidence.cause on every not-found result, and
// that half worked — the raw blob carried {"cause":"definition_only"}. But cause
// and degraded were persisted ONLY inside that JSON, with no columns and nothing
// summing them, so graph_health still printed a bare refsNotFoundSymbols=833 with
// no split. ef-manager got the answer by parsing 833 raw blobs by hand.
//
// His diagnosis: the original defect moved down one level. The qualifier now EXISTS
// and the summary statistic still cannot see it.
//
// THE ANSWER those columns exist to carry, measured on echoes 2026-08-02:
//   cause across the 833 : definition_only 833 (100.0%)
//   refsDegradedSymbols     = 833
//   refsCleanNotFoundSymbols = 0
// ZERO genuinely-unreferenced symbols. The "52% of symbols have no references"
// figure was 100% artifact — retired, not corrected, and now proven rather than
// inferred. Control: 'found' records carry no cause (400/400), position_unresolved
// carry no cause (21/21), so the field discriminates rather than firing everywhere.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '../../../mcp/stdio', p), 'utf8');
const schema = read('storage/schema.js');
const importer = read('ingest/code-intel/importer.js');
const query = read('code-intel/query.js');
const health = read('query/verbs/health.js');

describe('the cause reaches real columns, not just the raw blob', () => {
  it('migrates cause and degraded onto code_intel_records', () => {
    expect(schema).toMatch(/ALTER TABLE code_intel_records ADD COLUMN cause TEXT/);
    expect(schema).toMatch(/ALTER TABLE code_intel_records ADD COLUMN degraded INTEGER/);
  });

  it('migrates the split counters onto code_intel_collections', () => {
    expect(schema).toMatch(/ADD COLUMN refs_degraded INTEGER/);
    expect(schema).toMatch(/ADD COLUMN refs_clean_not_found INTEGER/);
  });

  it('writes cause and degraded on every record insert', () => {
    expect(importer).toMatch(/result_state, cause, degraded, raw\)/);
    expect(importer).toMatch(/cause: record\.cause \?\? null/);
  });

  it('persists the split on the collection row', () => {
    expect(importer).toMatch(/refs_degraded: sess\.refsDegradedSymbols/);
    expect(importer).toMatch(/refs_clean_not_found: sess\.refsCleanNotFoundSymbols/);
  });

  it('reads the split back out', () => {
    expect(query).toMatch(/refsDegraded: row\.refs_degraded/);
    expect(query).toMatch(/refsCleanNotFound: row\.refs_clean_not_found/);
  });
});

describe('graph_health can finally state the honest headline', () => {
  it('surfaces the breakdown rather than a bare not-found count', () => {
    expect(health).toMatch(/refsNotFoundBreakdown/);
    expect(health).toMatch(/are NOT evidence of no callers/);
  });

  it('warns when results are degraded, and says so when none are clean', () => {
    expect(health).toMatch(/are DEGRADED/);
    expect(health).toMatch(/ZERO are clean absences/);
  });

  it('projects the session counters health needs to reason about', () => {
    // The ccfe69c contradiction check misfired because refsFound/refsNotFound were
    // never on health's codeIntel projection — it tested fields that did not exist
    // and read undefined as "session missing".
    expect(health).toMatch(/refsFound: latest\.refsFound/);
    expect(health).toMatch(/refsNotFound: latest\.refsNotFound/);
  });
});

describe('staleProcess distinguishes a doc change from a behaviour change', () => {
  it('reports whether the delta touches executable files', () => {
    const build = read('server-build.js');
    expect(build).toMatch(/executable_files_changed/);
    expect(build).toMatch(/behaviourally_current/);
    expect(build).toMatch(/BEHAVIOURALLY CURRENT and a restart is not/);
  });

  it('still demands a restart when the delta cannot be computed', () => {
    // Fail-closed: unknown delta means assume it matters.
    const build = read('server-build.js');
    expect(build).toMatch(/Delta could not be computed, so assume it matters/);
  });
});
