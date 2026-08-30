// R2-2026-05-31 (BUG 2) — honest absence/trust gate for change_plan/preflight.
//
// An empty / low caller set is only "SAFE — proceed / safe to delete" when it
// is backed by LIVE per-symbol clangd evidence (an LSP_VERIFIED incoming caller
// edge). The heuristic graph's caller set undercounts cross-TU dispatch, so a
// heuristic-only caller set must downgrade to REVIEW and point the agent at
// code_intel_references — never a green "SAFE — proceed".

import { describe, expect, it } from 'vitest';
import { computeDecision } from '../../../mcp/stdio/query/verbs/preflight.js';
import { ATTESTATION } from '../../../mcp/stdio/storage/publication-schema.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

describe('computeDecision — heuristic caller set is never SAFE-to-proceed', () => {
  it('0 callers, heuristic-only → REVIEW (not SAFE), points at code_intel_references', () => {
    const d = computeDecision({
      callerCount: 0,
      testCount: 0,
      dirtyCount: 0,
      crossModule: false,
      confidence: 1.0,
      callersHaveLspEvidence: false,
    });
    expect(d.tier).toBe('REVIEW');
    expect(d.reason).toMatch(/heuristic, not exhaustive/);
    expect(d.reason).toContain('code_intel_references');
  });

  it('1 caller, heuristic-only → REVIEW (not SAFE) even with tests present', () => {
    const d = computeDecision({
      callerCount: 1,
      testCount: 2,
      dirtyCount: 0,
      crossModule: false,
      confidence: 1.0,
      callersHaveLspEvidence: false,
    });
    expect(d.tier).toBe('REVIEW');
    expect(d.reason).toMatch(/heuristic, not exhaustive/);
  });

  it('0 callers WITH live lsp evidence → SAFE (the legitimate proceed path)', () => {
    const d = computeDecision({
      callerCount: 0,
      testCount: 0,
      dirtyCount: 0,
      crossModule: false,
      confidence: 1.0,
      callersHaveLspEvidence: true,
      // ⚠ ADDED 2026-08-30. SAFE now also requires a CURRENT collection: evidence that was ground
      // truth at collection time is not ground truth after the files it covered have changed. This
      // is a positive control for the legitimate proceed path, so it must state every condition that
      // path requires — otherwise the new gate would make SAFE unreachable and these controls would
      // be the thing that noticed.
      collectionCurrent: true,
      // ⚠ ADDED with the interim containment. SAFE now also requires ONE current collection over an
      // UNCHANGED eligible corpus. These are positive controls for the legitimate proceed path, so
      // they must state every condition that path requires — otherwise the new gates would make SAFE
      // unreachable and these controls are exactly what would notice.
      evidenceUnion: false,
      eligibleDirty: 0,
      // ⚠ ADDED with the publication gate, and held CONSTANT across this file. SAFE now also
      // requires that the graph the caller set came from is the graph the manifest describes.
      // Every test here varies one OTHER thing, so this stays satisfied — otherwise the new
      // gate would make SAFE unreachable and these positive controls are what would notice.
      attestation: ATTESTATION.ATTESTED,
    });
    expect(d.tier).toBe('SAFE');
    expect(d.reason).toMatch(/lsp-verified/);
    expect(d.reason).toMatch(/proceed/);
  });

  it('1 caller with tests AND live lsp evidence → SAFE', () => {
    const d = computeDecision({
      callerCount: 1,
      testCount: 1,
      dirtyCount: 0,
      crossModule: false,
      confidence: 1.0,
      callersHaveLspEvidence: true,
      // ⚠ ADDED 2026-08-30. SAFE now also requires a CURRENT collection: evidence that was ground
      // truth at collection time is not ground truth after the files it covered have changed. This
      // is a positive control for the legitimate proceed path, so it must state every condition that
      // path requires — otherwise the new gate would make SAFE unreachable and these controls would
      // be the thing that noticed.
      collectionCurrent: true,
      // ⚠ ADDED with the interim containment. SAFE now also requires ONE current collection over an
      // UNCHANGED eligible corpus. These are positive controls for the legitimate proceed path, so
      // they must state every condition that path requires — otherwise the new gates would make SAFE
      // unreachable and these controls are exactly what would notice.
      evidenceUnion: false,
      eligibleDirty: 0,
      // ⚠ ADDED with the publication gate, and held CONSTANT across this file. SAFE now also
      // requires that the graph the caller set came from is the graph the manifest describes.
      // Every test here varies one OTHER thing, so this stays satisfied — otherwise the new
      // gate would make SAFE unreachable and these positive controls are what would notice.
      attestation: ATTESTATION.ATTESTED,
    });
    expect(d.tier).toBe('SAFE');
    expect(d.reason).toMatch(/proceed/);
  });

  it('multi-caller REVIEW/CONFIRM tiers are unchanged by the lsp gate', () => {
    // >1 callers already routes to REVIEW before the absence gate; lsp evidence
    // does not relax that.
    const d = computeDecision({
      callerCount: 3,
      testCount: 0,
      dirtyCount: 0,
      crossModule: false,
      confidence: 1.0,
      callersHaveLspEvidence: true,
      // ⚠ ADDED 2026-08-30. SAFE now also requires a CURRENT collection: evidence that was ground
      // truth at collection time is not ground truth after the files it covered have changed. This
      // is a positive control for the legitimate proceed path, so it must state every condition that
      // path requires — otherwise the new gate would make SAFE unreachable and these controls would
      // be the thing that noticed.
      collectionCurrent: true,
      // ⚠ ADDED with the interim containment. SAFE now also requires ONE current collection over an
      // UNCHANGED eligible corpus. These are positive controls for the legitimate proceed path, so
      // they must state every condition that path requires — otherwise the new gates would make SAFE
      // unreachable and these controls are exactly what would notice.
      evidenceUnion: false,
      eligibleDirty: 0,
      // ⚠ ADDED with the publication gate, and held CONSTANT across this file. SAFE now also
      // requires that the graph the caller set came from is the graph the manifest describes.
      // Every test here varies one OTHER thing, so this stays satisfied — otherwise the new
      // gate would make SAFE unreachable and these positive controls are what would notice.
      attestation: ATTESTATION.ATTESTED,
    });
    expect(d.tier).toBe('REVIEW');
  });

  it('default (callersHaveLspEvidence omitted) is treated as heuristic → not SAFE', () => {
    const d = computeDecision({
      callerCount: 0,
      testCount: 0,
      dirtyCount: 0,
      crossModule: false,
      confidence: 1.0,
    });
    expect(d.tier).toBe('REVIEW');
  });

  // FALSE-EXHAUSTIVE GUARD (2026-06-02): lsp-verified callers are NOT a safe
  // basis for SAFE when the compile DB only partially covers the repo.
  it('lsp evidence present BUT compile-DB coverage incomplete (foreign) → REVIEW, not SAFE', () => {
    const d = computeDecision({
      callerCount: 1,
      testCount: 1,
      dirtyCount: 0,
      crossModule: false,
      confidence: 1.0,
      callersHaveLspEvidence: true,
      coverageComplete: false,
      coverageReason: 'compile DB was built by a different (Linux/WSL) toolchain',
    });
    expect(d.tier).toBe('REVIEW');
    expect(d.reason).toMatch(/PARTIALLY covers|partial/i);
    expect(d.reason).toMatch(/APG_CLANGD_WSL/);
  });

  it('lsp evidence present, coverage incomplete (unity) → REVIEW with the unity remedy', () => {
    const d = computeDecision({
      callerCount: 0,
      testCount: 0,
      dirtyCount: 0,
      crossModule: false,
      confidence: 1.0,
      callersHaveLspEvidence: true,
      coverageComplete: false,
      coverageReason: 'compile DB is a CMake UNITY build',
    });
    expect(d.tier).toBe('REVIEW');
    expect(d.reason).toMatch(/expand the unity build/);
  });

  it('lsp evidence present + coverageComplete:true (default) → SAFE (unchanged)', () => {
    const d = computeDecision({
      callerCount: 1,
      testCount: 1,
      dirtyCount: 0,
      crossModule: false,
      confidence: 1.0,
      callersHaveLspEvidence: true,
      // ⚠ ADDED 2026-08-30. SAFE now also requires a CURRENT collection: evidence that was ground
      // truth at collection time is not ground truth after the files it covered have changed. This
      // is a positive control for the legitimate proceed path, so it must state every condition that
      // path requires — otherwise the new gate would make SAFE unreachable and these controls would
      // be the thing that noticed.
      collectionCurrent: true,
      // ⚠ ADDED with the interim containment. SAFE now also requires ONE current collection over an
      // UNCHANGED eligible corpus. These are positive controls for the legitimate proceed path, so
      // they must state every condition that path requires — otherwise the new gates would make SAFE
      // unreachable and these controls are exactly what would notice.
      evidenceUnion: false,
      eligibleDirty: 0,
      // ⚠ ADDED with the publication gate, and held CONSTANT across this file. SAFE now also
      // requires that the graph the caller set came from is the graph the manifest describes.
      // Every test here varies one OTHER thing, so this stays satisfied — otherwise the new
      // gate would make SAFE unreachable and these positive controls are what would notice.
      attestation: ATTESTATION.ATTESTED,
    });
    expect(d.tier).toBe('SAFE');
  });
});

// ⛔ A SAFETY CURRENCY NO SAFETY CONSUMER READS IS NOT A GATE.
// absenceAuthority was hardened to require a current collection and then had exactly two production
// files: its definition and graph_health. THIS verb prints "DECISION: SAFE ... proceed" before
// someone deletes a symbol, and consumed neither it nor collection currency. Reviewer executed both
// stale and unknown-currency collections: health denied absence authority while preflight still said
// SAFE, its own trust line calling the caller set a FLOOR in the same output.
describe('computeDecision — SAFE requires evidence that is still current', () => {
  const verified = {
    callerCount: 0, testCount: 0, dirtyCount: 0, crossModule: false, confidence: 1.0,
    // The other SAFE preconditions held constant so each test below varies ONE thing — currency.
    callersHaveLspEvidence: true, evidenceUnion: false, eligibleDirty: 0,
    attestation: ATTESTATION.ATTESTED,
  };

  it('a collection taken at an older commit is never SAFE', () => {
    const d = computeDecision({ ...verified, collectionCurrent: false });
    expect(d.tier).toBe('REVIEW');
    expect(d.reason, 'and it says WHY, not just no').toMatch(/older commit/);
    expect(d.reason, 'and what the caller set is worth meanwhile').toMatch(/floor/i);
  });

  it('unknown currency fails closed, under its own wording', () => {
    // null is what a non-git checkout or a collection predating commit tracking produces. Unknown is
    // not evidence of currency, and it must not be reported as known staleness either.
    const d = computeDecision({ ...verified, collectionCurrent: null });
    expect(d.tier).toBe('REVIEW');
    expect(d.reason).toMatch(/could not be established/);
  });

  it('POSITIVE CONTROL: a current collection still reaches SAFE', () => {
    // Without this the gate above could deny unconditionally and every assertion here would pass.
    expect(computeDecision({ ...verified, collectionCurrent: true }).tier).toBe('SAFE');
  });
});

// ⛔ INTERIM CONTAINMENT, agreed with review and labelled temporary in the source.
// The right discriminator is BYTE IDENTITY — a collection recording the exact eligible-file
// membership and per-file digest it was taken from, so SAFE stays reachable in a dirty worktree
// whose bytes the collection actually read. Until that exists these deny.
describe('computeDecision — evidence must be ONE current generation over an unchanged corpus', () => {
  const current = {
    callerCount: 0, testCount: 0, dirtyCount: 0, crossModule: false, confidence: 1.0,
    callersHaveLspEvidence: true, collectionCurrent: true,
    attestation: ATTESTATION.ATTESTED,
  };

  it('evidence spanning more than one collection is never SAFE', () => {
    // Coverage is counted across EVERY live collection while currency checks only the latest, so a
    // small current collection can certify what older ones supplied.
    const d = computeDecision({ ...current, evidenceUnion: true, eligibleDirty: 0 });
    expect(d.tier).toBe('REVIEW');
    expect(d.reason).toMatch(/MORE THAN ONE collection/);
  });

  it('a dirty eligible source file is never SAFE — a caller can live in any of them', () => {
    const d = computeDecision({ ...current, evidenceUnion: false, eligibleDirty: 3 });
    expect(d.tier).toBe('REVIEW');
    expect(d.reason).toMatch(/3 eligible source file/);
  });

  it('unknown fails closed on both, under their own wording', () => {
    // null is what an unreadable collection table or an uninspectable worktree produces. Neither may
    // be reported as the known-bad case — that would assert a cause nothing established.
    expect(computeDecision({ ...current, evidenceUnion: null, eligibleDirty: 0 }).reason)
      .toMatch(/could not be established/);
    expect(computeDecision({ ...current, evidenceUnion: false, eligibleDirty: null }).reason)
      .toMatch(/could not be inspected/);
  });

  it('POSITIVE CONTROL: one current collection over a clean eligible corpus still reaches SAFE', () => {
    // Without this the two gates above could deny unconditionally — which is the failure mode that
    // put them here: a gate whose closed state is permanent is not fail-closed, it is off.
    expect(computeDecision({ ...current, evidenceUnion: false, eligibleDirty: 0 }).tier).toBe('SAFE');
  });
});

// ⛔ THE VERB THAT PRINTS "DECISION: SAFE — PROCEED" MUST ASK WHOSE GRAPH IT IS READING.
//
// Every gate above weighs how good the evidence is. This one asks whether the graph the evidence
// came out of has ever been published, and whether what is on disk matches what claims to describe
// it. An unattested graph can be internally perfect and still be answering about a different corpus.
//
// The precedent is exact and recent: absenceAuthority was hardened to require a current collection
// and then had two production consumers, neither of them this verb — health denied authority while
// preflight said SAFE in the same breath. A gate no safety consumer reads is not a gate.
describe('computeDecision — SAFE requires a graph the manifest actually describes', () => {
  const otherwiseSafe = {
    callerCount: 0, testCount: 0, dirtyCount: 0, crossModule: false, confidence: 1.0,
    callersHaveLspEvidence: true, collectionCurrent: true, evidenceUnion: false, eligibleDirty: 0,
  };

  it('POSITIVE CONTROL: an attested graph with every other clause satisfied still reaches SAFE', () => {
    // ⛔ WITHOUT THIS THE FOUR DENIALS BELOW PROVE NOTHING. A gate whose closed state is permanent
    // is not fail-closed, it is off — and it would satisfy every refusal while never opening.
    const d = computeDecision({ ...otherwiseSafe, attestation: ATTESTATION.ATTESTED });
    expect(d.tier).toBe('SAFE');
  });

  for (const [state, phrase] of [
    [ATTESTATION.LEGACY_UNATTESTED, /predates publication attestation/],
    [ATTESTATION.NEVER_COMPLETED, /generation 0/],
    [ATTESTATION.GENERATION_MISMATCH, /DIFFERENT generations/],
  ]) {
    it(`⛔ ${state} is never SAFE, and says which state it is`, () => {
      const d = computeDecision({ ...otherwiseSafe, attestation: state });
      expect(d.tier, 'every other clause holds, so only attestation can be denying').toBe('REVIEW');
      expect(d.reason).toMatch(phrase);
    });
  }

  it('⛔ the three denials do NOT share a message — each remedy differs', () => {
    const reasons = [ATTESTATION.LEGACY_UNATTESTED, ATTESTATION.NEVER_COMPLETED, ATTESTATION.GENERATION_MISMATCH]
      .map((a) => computeDecision({ ...otherwiseSafe, attestation: a }).reason);
    expect(new Set(reasons).size, 'three states, three messages').toBe(3);
  });

  it('⛔ an attestation nobody established fails closed, under its OWN wording', () => {
    // Not reported as any of the three known states: that would assert a fault in the graph that
    // nothing found, and the next reader would rebuild a healthy index on the strength of it.
    const d = computeDecision(otherwiseSafe);
    expect(d.tier).toBe('REVIEW');
    expect(d.reason).toMatch(/publication state of this graph was not established/);
    expectAbsentWithLiveMatcher(
      /\b(predates|generation 0|DIFFERENT generations)\b/,
      { forbidden: 'this graph predates attestation', allowed: 'the publication state was not established' },
      d.reason,
      'unknown must not borrow the wording of a state that was actually diagnosed',
    );
  });

  it('⛔ an unknown attestation does NOT mask a more specific evidence failure', () => {
    // Ordered last deliberately. Placed with the three known states it reported "unattested" on
    // every caller written before the parameter existed, hiding the heuristic-caller-set reason —
    // the identical mistake made in graph-capabilities minutes earlier, caught by its own tests.
    const d = computeDecision({ ...otherwiseSafe, callersHaveLspEvidence: false });
    expect(d.reason, 'a heuristic caller set is a real finding and outranks a caller omission')
      .toMatch(/heuristic, not exhaustive/);
  });
});
