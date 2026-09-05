// ⛔ THE DEFECT THESE GUARD, MEASURED 2026-09-06.
//
// `graph_health` prints `capabilities.absenceAuthority` and its own source calls it "the field that
// answers the question that deletes code". It CAN evaluate true: measured on a best-case fixture
// (verified edges, complete collection, collection at HEAD, attested graph) it returned
// `true / reason: null`, with two negative controls in the same pass correctly denying.
//
// ⛔ AND NO ANSWER PATH WILL EVER HONOUR IT. `graph_callers` routes every absence through
// `buildAbsenceTrustLine`, which emits "absence is from the heuristic graph and is NOT exhaustive"
// UNCONDITIONALLY — there is no branch on `absenceAuthority` anywhere in the verb. So a repository
// could be told it holds a licence to delete code that nothing in the product would ever cash.
//
// ⭐ THE ROADMAP'S FIX WAS BACKWARDS, AND THAT IS THE FINDING. `ROADMAP-2026-09-03.md` R1.1 says to
// wire the gate INTO `graph_callers`. Implemented as written, that would let the caller verb UPGRADE
// its absence claim whenever the flag was true — a fail-OPEN change, in the codebase whose own
// recorded dominant defect class is fail-open. The answer paths were already right. The GRANT was
// wrong.
//
// ⭐⭐⭐ AND THE WRONG NOUN WAS INSIDE THE GATE. `coverage.complete` records the files APG PROCESSED.
// The gate read it as evidence of what the LANGUAGE SERVER INDEXED. Those are different populations,
// and `cause-classification.js` has said so on every call since 2026-08-19:
// `index_population_unattested` is true of EVERY call, because the compile DB selects which files
// clangd MAY index and never reports which it DID.
//
// ⇒ So the gate gains the clause it was missing, BY NAME rather than by hardcoding false. A
// hardcoded false is a list someone must remember to update; a named unsatisfied clause is a
// derivation, and a future workspace-symbol round-trip or background-index opt-in (both already
// named as future work in README.md) can satisfy it without anyone rediscovering this reasoning.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { graphCapabilities } from '../../../mcp/stdio/query/graph-capabilities.mjs';
import { ATTESTATION } from '../../../mcp/stdio/storage/publication-schema.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// The fixture that measured TRUE before this change: every clause the gate knew about, satisfied.
const BEST_CASE = Object.freeze({
  indexed: true,
  compilerVerifiedEdges: 1943,
  collectionAvailable: true,
  coverage: { complete: true },
  collectionCurrent: true,
  language: 'cpp',
  languageHasServer: true,
  attestation: ATTESTATION.ATTESTED,
});

describe('absence authority may not be granted on a population nothing attested', () => {
  it('★★★ THE REAL CASE: the best-case repo is REFUSED, because the language server never attested what it indexed', () => {
    // Measured true before this clause existed. The compile DB selects which files clangd MAY index
    // and never reports which it DID, so no amount of APG-side coverage establishes the LSP's own
    // population.
    const c = graphCapabilities(BEST_CASE);
    expect(c.absenceAuthority, 'a licence no verb can cash must not be granted').toBe(false);
    expect(c.reason).toBe('index_population_unattested');
  });

  it('★★★ NOT SUPPLIED DENIES — the clause fails closed like every other one here', () => {
    // The alternative is a gate that silently opens for every caller written before the clause
    // existed, which is the fail-open default this project keeps removing.
    for (const value of [undefined, null, false, 0, 'yes']) {
      const c = graphCapabilities({ ...BEST_CASE, lspPopulationAttested: value });
      expect(c.absenceAuthority, `lspPopulationAttested=${String(value)} must not grant`).toBe(false);
    }
  });

  it('★★★ THE POSITIVE CONTROL: the clause is a DERIVATION, not a hardcoded false', () => {
    // ⛔ A predicate that can never grant is as useless as one that always does, and hardcoding
    // `false` would have made every other clause in this gate dead code. When a future
    // workspace-symbol round-trip can attest the indexed population, this grants again with no
    // archaeology required.
    const c = graphCapabilities({ ...BEST_CASE, lspPopulationAttested: true });
    expect(c.absenceAuthority, 'the gate must still be satisfiable').toBe(true);
    expect(c.reason).toBeNull();
  });

  it('★★★ the new clause does not MASK the older ones — each still names its own reason', () => {
    // Ordering matters: if this clause were tested first, every partial or stale collection would be
    // diagnosed as an unattested population and the actionable diagnosis would be lost.
    const attested = { ...BEST_CASE, lspPopulationAttested: true };
    expect(graphCapabilities({ ...attested, coverage: { complete: false } }).reason)
      .toBe('collection_partial');
    expect(graphCapabilities({ ...attested, collectionCurrent: false }).reason)
      .toBe('collection_stale');
    expect(graphCapabilities({ ...attested, collectionAvailable: false }).reason)
      .toBe('no_collection');
  });

  it('★★★ THE WIRING: health does not supply the clause, so production denies', () => {
    // The pure function being correct is worth nothing if the one production caller passes the
    // clause in. Health has no way to attest the LSP's population, so it must not claim to.
    const health = read('../../../mcp/stdio/query/verbs/health.js');
    expect(health, 'health must call the gate').toMatch(/graphCapabilities\(\{/);
    expect(health, 'health cannot attest what clangd indexed and must not say it can')
      .not.toContain('lspPopulationAttested');
  });

  it('★★★ AND THE ANSWER PATH STAYS UNCONDITIONAL — callers must not learn to read this flag', () => {
    // ⛔ THIS IS THE ASSERTION THAT REFUSES THE ROADMAP'S OWN R1.1. Wiring the gate into the caller
    // verb would let it upgrade an absence claim on a flag whose premise the architecture cannot
    // support. The verb is already correct: it says NOT exhaustive, every time, with no branch.
    const callers = read('../../../mcp/stdio/query/verbs/callers.js');
    expect(callers, 'the absence path must stay unconditional').toContain('buildAbsenceTrustLine');
    expect(callers, 'graph_callers must not branch on absence authority')
      .not.toContain('absenceAuthority');
    // Live control: the identifier DOES exist in the module that owns it, so its absence above is a
    // measured result rather than a misspelling that can never match.
    const capabilities = read('../../../mcp/stdio/query/graph-capabilities.mjs');
    expect(capabilities).toContain('absenceAuthority');
  });
});
