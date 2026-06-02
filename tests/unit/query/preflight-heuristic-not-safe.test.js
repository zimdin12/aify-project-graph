// R2-2026-05-31 (BUG 2) — honest absence/trust gate for change_plan/preflight.
//
// An empty / low caller set is only "SAFE — proceed / safe to delete" when it
// is backed by LIVE per-symbol clangd evidence (an LSP_VERIFIED incoming caller
// edge). The heuristic graph's caller set undercounts cross-TU dispatch, so a
// heuristic-only caller set must downgrade to REVIEW and point the agent at
// code_intel_references — never a green "SAFE — proceed".

import { describe, expect, it } from 'vitest';
import { computeDecision } from '../../../mcp/stdio/query/verbs/preflight.js';

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
    });
    expect(d.tier).toBe('SAFE');
  });
});
