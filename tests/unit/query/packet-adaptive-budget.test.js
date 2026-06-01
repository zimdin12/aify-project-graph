import { describe, it, expect } from 'vitest';
import { resolvePacketBudget } from '../../../mcp/stdio/query/verbs/packet.js';

describe('resolvePacketBudget (packet budget precedence)', () => {
  it('uses the adaptive tier when no explicit budget/env', () => {
    const r = resolvePacketBudget({ explicit: null, env: undefined, nodeCount: 5000 });
    expect(r.budgetTokens).toBe(4500); // medium
    expect(r.caps.evidence_records).toBe(20);
  });
  it('explicit budget arg wins over tier + env', () => {
    const r = resolvePacketBudget({ explicit: 999, env: '5000', nodeCount: 50000 });
    expect(r.budgetTokens).toBe(999);
  });
  it('env override wins over tier when no explicit arg', () => {
    const r = resolvePacketBudget({ explicit: null, env: '3333', nodeCount: 100 });
    expect(r.budgetTokens).toBe(3333);
  });
  it('a huge repo gets the huge tier budget by default', () => {
    const r = resolvePacketBudget({ explicit: null, env: undefined, nodeCount: 60000 });
    expect(r.budgetTokens).toBe(10000);
  });
});
