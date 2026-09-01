// `spineCoverage` — the STRUCTURED scope of the compiler-verified spine, shared by the absence
// trust line and by graph_consequences.structural_coverage.
//
// ⛔ WHY graph_consequences NEEDED THIS. When the overlay is unmapped, `overlay_coverage.remedy`
// tells the reader to "treat the observed fields (callers, importers, documents_mentioning,
// tests_adjacent) as the whole answer". So the verb directs an agent to the STRUCTURAL side at
// exactly the moment the curated side is empty — while nothing stated that those fields come from a
// spine which, measured on this repository, covered 73 of 627 eligible files.
//
// ⛔ WHY A FIELD AND NOT A SENTENCE. The plan warns that recreating the warning wall the pilot
// agents skimmed would undo M2's own purpose. This mirrors overlay_coverage's
// {cause, consequence, remedy} contract so an agent can branch on it instead of reading prose.
import { describe, it, expect } from 'vitest';
import { spineCoverage } from '../../../mcp/stdio/query/lsp-evidence.js';

const dbWith = (rows) => ({
  get(sql, params) {
    if (/language=\$lang/.test(sql)) return rows.byLanguage?.[params?.lang] ?? null;
    return rows.latest ?? null;
  },
  all() { return []; },
});

const TS = (over = {}) => ({
  collection_id: 'c-ts', language: 'typescript', compile_db_hash: null, operations_json: '{}',
  files_processed: 73, files_in_scope: 73, files_eligible: 627, ...over,
});

describe('spineCoverage — the structured scope of the trust spine', () => {
  it('POSITIVE CONTROL: a real collection yields a populated verdict', () => {
    // Without this, every "null" assertion below could pass because the function always returns null.
    const c = spineCoverage(dbWith({ latest: TS() }));
    expect(c, 'a collection must produce a verdict').toBeTruthy();
    expect(c.language).toBe('typescript');
  });

  it('★ partial coverage names processed / ELIGIBLE and offers the remedy', () => {
    const c = spineCoverage(dbWith({ latest: TS() }));
    expect(c.cause).toBe('partial_spine_coverage');
    expect(c.files_processed).toBe(73);
    expect(c.files_eligible).toBe(627);
    expect(c.consequence).toMatch(/73 of 627 eligible files/);
    expect(c.remedy, 'a partial spine must say how to complete it').toMatch(/graph_collect_code_intel/);
  });

  it('⛔ the denominator is ELIGIBLE, never IN-SCOPE', () => {
    // A scope:"files" run over three paths reports 3 of 3 and reads as COMPLETE. Using the run's own
    // scope would turn a three-file sample of a 627-file repo into a claim of total coverage.
    const c = spineCoverage(dbWith({ latest: TS({ files_processed: 3, files_in_scope: 3 }) }));
    expect(c.files_eligible).toBe(627);
    expect(c.consequence).toMatch(/3 of 627 eligible files/);
  });

  it('⛔ UNRECORDED coverage yields nulls and a named cause, never a fabricated ratio', () => {
    const c = spineCoverage(dbWith({ latest: TS({ files_processed: null, files_eligible: null }) }));
    expect(c.cause).toBe('coverage_unrecorded');
    expect(c.files_processed, 'null is not zero and not "all"').toBeNull();
    expect(c.files_eligible).toBeNull();
    expect(c.consequence).toMatch(/UNKNOWN/);
  });

  it('no collection at all is a statement about the SPINE, not about the code', () => {
    const c = spineCoverage(dbWith({ latest: null }));
    expect(c.cause).toBe('no_code_intel_collection');
    expect(c.consequence).toMatch(/evidence about the SPINE, not about the code/);
    expect(c.remedy).toMatch(/graph_collect_code_intel/);
  });

  it('a C++ collection with no compile db is a FLOOR that cannot license a deletion', () => {
    const cpp = { collection_id: 'c-cpp', language: 'cpp', compile_db_hash: null, operations_json: '{}' };
    const c = spineCoverage(dbWith({ latest: cpp, byLanguage: { cpp } }));
    expect(c.cause).toBe('no_compile_db');
    expect(c.consequence).toMatch(/FLOOR/);
    expect(c.remedy).toMatch(/CMAKE_EXPORT_COMPILE_COMMANDS/);
  });

  it('complete coverage carries no cause and no remedy', () => {
    const c = spineCoverage(dbWith({ latest: TS({ files_processed: 627 }) }));
    expect(c.cause, 'a fully covered spine is not a defect').toBeNull();
    expect(c.remedy).toBeNull();
  });

  it('a missing or throwing db returns null rather than a reassuring default', () => {
    expect(spineCoverage(null)).toBeNull();
    expect(spineCoverage({ get() { throw new Error('closed'); }, all() { return []; } })).toBeNull();
  });
});
