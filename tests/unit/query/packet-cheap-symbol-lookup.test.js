// THE BARE-SYMBOL PATH WAS NON-FUNCTIONAL ON REAL C++ REPOS.
//
// Measured (ef-manager, echoes, 2026-08-10): ALL THREE symbols tried —
// SimCoordinator, WorldBuffer, GpuMaterial — blew graph_packet's 2000ms
// symbol→feature budget. Not an edge case. On a 12,126-node C++ repo the
// flagship orientation verb could not resolve ANY bare symbol.
//
//   graphConsequences round-trip: 601ms @ 3,958 nodes · 4316ms @ 12,126 nodes
//
// The earlier fix made the timeout HONEST (it stopped reporting a latency fact as
// "symbol not found"). This one makes the path WORK: mapping a symbol to its
// feature does not need callers, importers, documents_mentioning, tasks, tests,
// git history, risk flags or a receipt — all of which graphConsequences computes.
// It needs the label resolved and the anchors checked.
//
// Deliberately NOT fixed by raising the budget: a bigger number moves the cliff
// and still leaves the reader unable to tell which side they are on.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'packet.js'),
  'utf8',
);

describe('graph_packet resolves symbol→feature without the full traversal', () => {
  it('★ has a cheap resolver that does not call graphConsequences', () => {
    const i = src.indexOf('function resolveFeatureForSymbolCheap');
    expect(i, 'the cheap resolver exists').toBeGreaterThan(-1);
    const body = src.slice(i, i + 2200);
    expect(body, 'resolves the label directly').toMatch(/resolveSymbol\(db, symbol\)/);
    expect(body, 'does not reach for the expensive verb').not.toMatch(/graphConsequences/);
  });

  it('★ the cheap path runs BEFORE the budgeted one', () => {
    // Order is the fix. Placed after, the budgeted call still runs first and still
    // times out, and the cheap resolver becomes dead code that passes its own test.
    const cheapAt = src.indexOf('resolveFeatureForSymbolCheap(repoRoot, functionality');
    const budgetedAt = src.indexOf("await import('./consequences.js')");
    expect(cheapAt).toBeGreaterThan(-1);
    expect(budgetedAt).toBeGreaterThan(-1);
    expect(cheapAt, 'cheap path precedes the budgeted import').toBeLessThan(budgetedAt);
  });

  it('uses the SAME anchor semantics as consequences', () => {
    // A different matching rule here would make the cheap and full paths disagree
    // about the same repo — two answers to one question, which is the defect class
    // this codebase keeps finding in itself.
    const i = src.indexOf('function resolveFeatureForSymbolCheap');
    const body = src.slice(i, i + 2200);
    expect(body).toMatch(/anchors\?\.symbols/);
    expect(body).toMatch(/anchors\?\.files/);
    expect(body).toMatch(/pattern\.endsWith\('\/\*'\)/);
  });

  it('never makes orientation fail — falls through on any error', () => {
    const i = src.indexOf('function resolveFeatureForSymbolCheap');
    expect(src.slice(i, i + 2400)).toMatch(/catch\s*{\s*\n?\s*return null;/);
  });
});
