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
// ⛔ EVERYTHING ABOVE IS THE 2026-09-06 STATE AND IS KEPT AS THE HISTORY OF THE DEFECT. "It CAN
// evaluate true" was true then. It is not true now: on 2026-09-08 the named clause became a stated
// POLICY of constant false, and the paragraph that used to stand here — "BY NAME rather than by
// hardcoding false", because "a hardcoded false is a list someone must remember to update" — is the
// argument I made and then lost. See the block above the first describe for why it was wrong.
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

// ⛔⛔ 2026-09-08: THE CLAUSE BECAME A CONSTANT, AND I LOST THE ARGUMENT FOR KEEPING IT NAMED.
//
// I defended the named clause with "a gate that can only say no cannot show its no is a decision".
// That is a rule about DETECTORS, where silence is ambiguous between a real absence and a broken
// instrument. A POLICY carries no such ambiguity: "this product cannot grant absence authority" is
// a decision, and a decision does not need a manufactured positive to prove it holds. I applied an
// instrument rule to a policy.
//
// ⛔ AND I CITED THE TEST BELOW AS IF IT JUSTIFIED THE DESIGN. It asserts the design choice under
// review. A test is not an oracle for its own premise — the derived-expectation trap, in the file
// that exists to stop me trusting my own expectations.
//
// ⭐ WHAT ACTUALLY SETTLED IT, verified before conceding: the five denial states already returned
// false with five DISTINCT reasons, so the diagnostics never depended on the grant and no denial
// test was vacuous. The claim I had to withdraw was "every denial test becomes vacuous".
//
// ⇒ The grant is now a stated POLICY. What must not be lost is that the gate still DISCRIMINATES —
// a constant that flattened the reasons would be the over-correction, and the control below is what
// refuses it.
describe('the grant is a policy, and a policy still has to discriminate', () => {
  it('★★★ THE POLICY: no input grants, including one that satisfies every clause', () => {
    // ⛔ ALSO A REGRESSION GUARD. It passes the retired `lspPopulationAttested` flag explicitly, so
    // reintroducing a supplier-satisfiable grant turns this red rather than silently opening.
    for (const extra of [{}, { lspPopulationAttested: true }, { lspPopulationAttested: 'yes' }]) {
      const c = graphCapabilities({ ...BEST_CASE, ...extra });
      expect(c.absenceAuthority, `no caller may buy the licence: ${JSON.stringify(extra)}`)
        .toBe(false);
    }
  });

  it('★★★ THE DISCRIMINATING CONTROL: a constant must not flatten the diagnoses', () => {
    // ⛔ THIS IS THE ASSERTION THAT STOPS THE OVER-CORRECTION. Hardcoding the verdict is only safe
    // while each observed problem still produces its OWN reason; a gate that answered
    // "false / unattested" to everything would pass the policy test above and be useless.
    const reasons = Object.fromEntries(Object.entries({
      missingIndex: { ...BEST_CASE, indexed: false },
      partialCollection: { ...BEST_CASE, coverage: { complete: false } },
      staleCollection: { ...BEST_CASE, collectionCurrent: false },
      noCollection: { ...BEST_CASE, collectionAvailable: false },
    }).map(([k, v]) => [k, graphCapabilities(v).reason]));

    expect(reasons).toEqual({
      missingIndex: 'not_indexed',
      partialCollection: 'collection_partial',
      staleCollection: 'collection_stale',
      noCollection: 'no_collection',
    });
    expect(new Set(Object.values(reasons)).size, 'four states must give four reasons').toBe(4);
  });

  it('★★★ attestation_unknown SURVIVES the clause becoming unconditional', () => {
    // ⛔ THE TRAP IN THIS CHANGE, AND THE WHOLE REASON IT NEEDED A TEST FIRST. With the grant gone,
    // `index_population_unattested` is true on EVERY call, so left in its old position it shadowed
    // the terminal `attestation_unknown` and silently deleted a diagnosis. An always-true
    // architectural fact is not a discriminating diagnosis and must not outrank a caller omission,
    // so attestation_unknown moves ahead of it and the architectural clause becomes terminal.
    const noAttestation = {
      indexed: true, compilerVerifiedEdges: 1943, collectionAvailable: true,
      coverage: { complete: true }, collectionCurrent: true, languageHasServer: true,
    };
    expect(graphCapabilities(noAttestation).reason).toBe('attestation_unknown');

    // ...and the architectural reason is still reachable, for a caller that DID attest.
    expect(graphCapabilities({ ...noAttestation, attestation: ATTESTATION.ATTESTED }).reason)
      .toBe('index_population_unattested');
  });
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

  // ⛔ TWO TESTS WERE REMOVED HERE ON 2026-09-08, AND NEITHER IS A COVERAGE LOSS.
  //
  // "THE POSITIVE CONTROL: the clause is a DERIVATION, not a hardcoded false" asserted that
  // `lspPopulationAttested: true` GRANTS. That is the design choice this change reverses, so the
  // test now states the opposite of the contract. Its coverage is inverted and kept: the POLICY
  // test above feeds that exact flag and requires denial, so the state it used to demand is now
  // the state that must never occur.
  //
  // "NOT SUPPLIED DENIES" looped five falsy-ish values and required denial for each. With the grant
  // a constant, every one of them denies no matter what the gate does — a test that cannot fail,
  // manufacturing confidence. The POLICY test covers the same ground while still being able to go
  // red, because it names the flag a regression would reintroduce.

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
