// ⛔ A JAVASCRIPT AGENT WAS TOLD TO WARM ITS "HEADERS".
//
// Found live by ef-manager, 2026-09-05, on a .js query. The cold_index remedy read:
//
//     "pass warmupFiles[] (callers + headers), or wait_for_ready, then retry"
//
// JavaScript has no headers. The advice is not wrong so much as addressed to a different language,
// in the one place an empty result most needs signal.
//
// ⚠ SEVERITY CORRECTED FROM THE ORIGINAL REPORT, and the correction is the reason this test is
// small. ef-manager called it "the ONLY fallback string, handed to every cause" — the cause-collapse
// class fixed elsewhere tonight. Checked: there are 14 fallback strings in that file, one per cause
// branch, so cause-specificity already existed. The real defect is narrower — LANGUAGE leakage in a
// single otherwise-correct remedy. They accepted the correction and deleted the memory file built
// on it.
//
// ⭐ THE BRANCH IS ON A REAL DISTINCTION, NOT A LANGUAGE LIST. C++ warms headers because the include
// graph runs through them; TS/JS/Python reach a symbol through importers. Two true statements about
// how a symbol is reached, not an enumeration somebody must extend per backend.
import { describe, it, expect } from 'vitest';
import { buildReferencesEvidence } from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { BACKENDS } from '../../../mcp/stdio/code-intel/backends.js';

const cold = { freshness: 'cold', callsiteCount: 0, coverage: { complete: true } };

describe('the cold-index remedy does not assume C++', () => {
  it('★★★ a non-C++ language is never told to warm HEADERS', () => {
    // Harvested from BACKENDS so a backend added later is covered without editing this test.
    const others = Object.keys(BACKENDS).filter((l) => l !== 'cpp');
    expect(others.length, 'only one backend — the assertion would be vacuous').toBeGreaterThan(0);
    for (const language of [...others, 'javascript']) {
      const e = buildReferencesEvidence({ ...cold, language });
      expect(e.cause).toBe('cold_index');
      expect(e.fallback, `${language} has no headers to warm`).not.toContain('header');
    }
  });

  it('★★★ C++ KEEPS the header advice, which is true and useful for it', () => {
    // ⛔ The direction a fix like this usually breaks: removing the C++-specific hint from everyone
    // to silence the leak would trade a wrong sentence for a less useful one.
    const e = buildReferencesEvidence({ ...cold, language: 'cpp' });
    expect(e.fallback).toContain('header');
  });

  it('★★★ every language still gets the ACTIONABLE part of the remedy', () => {
    // A gate on wording must not quietly drop the advice itself. warmupFiles[] and the retry are
    // what the agent can actually do, in every language.
    for (const language of ['cpp', 'typescript', 'python', 'javascript', undefined]) {
      const e = buildReferencesEvidence({ ...cold, language });
      expect(e.fallback, `${language} must still be told what to do`).toContain('warmupFiles[]');
      expect(e.fallback).toMatch(/retry/);
    }
  });

  it('★★ an unknown language gets the neutral form, not the C++ one', () => {
    // Fail-closed on wording: an unrecognised language must not inherit another language's mechanics.
    const e = buildReferencesEvidence({ ...cold, language: 'zzq-not-a-language' });
    expect(e.fallback).not.toContain('header');
  });
});
