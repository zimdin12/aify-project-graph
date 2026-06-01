import { describe, it, expect } from 'vitest';
import { getPacketTokenBudget, assertMonotonicPacketTiers, PACKET_TIERS } from '../../../mcp/stdio/query/response-budget.js';

describe('getPacketTokenBudget', () => {
  it('maps node counts to the expected tier', () => {
    expect(getPacketTokenBudget(0).name).toBe('tiny');
    expect(getPacketTokenBudget(799).name).toBe('tiny');
    expect(getPacketTokenBudget(800).name).toBe('tiny'); // boundary: <= maxNodes(800) → tiny
    expect(getPacketTokenBudget(801).name).toBe('small');
    expect(getPacketTokenBudget(4000).name).toBe('small');
    expect(getPacketTokenBudget(4001).name).toBe('medium');
    expect(getPacketTokenBudget(15000).name).toBe('medium');
    expect(getPacketTokenBudget(40001).name).toBe('huge');
    expect(getPacketTokenBudget(10_000_000).name).toBe('huge');
  });

  it('returns budgetTokens and a full caps object', () => {
    const b = getPacketTokenBudget(5000);
    expect(b.budgetTokens).toBe(4500);
    for (const k of ['evidence_records', 'affected_files', 'read_first', 'diagnostics', 'refs_per_symbol']) {
      expect(typeof b.caps[k]).toBe('number');
    }
  });

  it('is monotonic: no axis decreases as repos grow', () => {
    expect(assertMonotonicPacketTiers()).toBe(true);
    const capAxes = ['evidence_records', 'affected_files', 'read_first', 'diagnostics', 'refs_per_symbol'];
    for (let i = 1; i < PACKET_TIERS.length; i++) {
      expect(PACKET_TIERS[i].budgetTokens).toBeGreaterThanOrEqual(PACKET_TIERS[i - 1].budgetTokens);
      for (const a of capAxes) expect(PACKET_TIERS[i].caps[a]).toBeGreaterThanOrEqual(PACKET_TIERS[i - 1].caps[a]);
    }
  });

  it('assertMonotonicPacketTiers throws on a regressed table', () => {
    const bad = [
      { name: 'a', maxNodes: 10, budgetTokens: 2000, caps: { evidence_records: 10, affected_files: 10, read_first: 10, diagnostics: 10, refs_per_symbol: 8 } },
      { name: 'b', maxNodes: Infinity, budgetTokens: 1000, caps: { evidence_records: 10, affected_files: 10, read_first: 10, diagnostics: 10, refs_per_symbol: 8 } },
    ];
    expect(() => assertMonotonicPacketTiers(bad)).toThrow(/monoton/i);
  });

  it('defends against non-finite input (→ tiny, safest under-read)', () => {
    expect(getPacketTokenBudget(undefined).name).toBe('tiny');
    expect(getPacketTokenBudget(-5).name).toBe('tiny');
    expect(getPacketTokenBudget(NaN).name).toBe('tiny');
  });
});
