// P3-4 — packet clampToBudget skeletonize-before-drop (codegraph #564/#569).
//
// The clamp must, in escalating order:
//   Tier-1 collapse list items sharing a directory prefix into a summary line,
//   Tier-2 keep a section header + omitted-count instead of deleting the body,
//   Tier-3 drop the section entirely (last rail only),
// and NEVER drop/collapse the section containing the packet target (READ FIRST).

import { describe, it, expect } from 'vitest';
import { clampToBudget } from '../../../mcp/stdio/query/verbs/packet.js';

function tokensOf(s) { return Math.ceil(s.length / 4); }

function buildOverBudgetPacket() {
  const lines = [
    'FEATURE: auth',
    'MODE: plan',
    'SNAPSHOT: indexed=abc head=abc dirty=0 trust=strong',
    'READ FIRST:',
    '- src/auth/login.ts — feature primary file',
    '- src/auth/session.ts — feature anchor file',
    'CONTRACTS:',
    '- docs/auth-contract.md',
    '- docs/session-contract.md',
    'TESTS:',
    '- tests/auth/login.test.ts',
    '- tests/auth/logout.test.ts',
    '- tests/auth/session.test.ts',
    '- tests/auth/token.test.ts',
    '- tests/auth/refresh.test.ts',
    '- tests/auth/expiry.test.ts',
    'RISKS:',
    '- broad blast radius',
    '- graph trust=weak — verify in source before acting',
  ];
  return lines.join('\n');
}

describe('packet clampToBudget — skeletonize before drop', () => {
  it('is a no-op when already under budget', () => {
    const text = buildOverBudgetPacket();
    const out = clampToBudget(text, 100000, 'READ FIRST:');
    expect(out).toBe(text);
  });

  it('Tier-1 collapses directory-prefixed list items instead of dropping', () => {
    const text = buildOverBudgetPacket();
    // Pick a budget just below the full size so only Tier-1 is needed.
    const full = tokensOf(text);
    const out = clampToBudget(text, full - 6, 'READ FIRST:');
    // TESTS collapsed: first item kept, rest summarized — not deleted.
    expect(out).toContain('- tests/auth/login.test.ts');
    expect(out).toMatch(/more under tests\/auth\/\* \(collapsed/);
    // Section header survives (not dropped).
    expect(out).toContain('TESTS:');
  });

  it('never drops or collapses the target (READ FIRST) section', () => {
    const text = buildOverBudgetPacket();
    // Brutal budget: force escalation through all tiers.
    const out = clampToBudget(text, 12, 'READ FIRST:');
    expect(out).toContain('READ FIRST:');
    expect(out).toContain('- src/auth/login.ts — feature primary file');
    // Both READ FIRST items must remain verbatim.
    expect(out).toContain('- src/auth/session.ts — feature anchor file');
  });

  it('Tier-2 keeps header + omitted count rather than deleting a section', () => {
    const text = buildOverBudgetPacket();
    // Budget tight enough that Tier-1 alone is insufficient but Tier-2 reached.
    const out = clampToBudget(text, 70, 'READ FIRST:');
    // Some non-target section should appear as "N omitted (over budget)".
    expect(out).toMatch(/(RISKS|TESTS|CONTRACTS): \d+ omitted \(over budget\)/);
    // READ FIRST never becomes an omitted-count line.
    expect(out).not.toMatch(/READ FIRST: \d+ omitted/);
  });

  it('drops sections (Tier-3) only as a last rail, target still intact', () => {
    const text = buildOverBudgetPacket();
    const out = clampToBudget(text, 55, 'READ FIRST:');
    // Output is shorter than input.
    expect(tokensOf(out)).toBeLessThan(tokensOf(text));
    // Target survives even under the most aggressive clamp.
    expect(out).toContain('READ FIRST:');
    expect(out).toContain('- src/auth/login.ts — feature primary file');
  });
});
