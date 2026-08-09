// A TRUNCATED, UNRANKED LIST MUST SAY IT IS BOTH.
//
// Field report (ef-manager, echoes_of_the_fallen, 2026-08-09). `GpuMaterial` has
// 16 hits in that repo: ONE authoritative C++ declaration and 15 GLSL mirrors.
// The packet's DEFINED IN showed five shader copies and dropped the C++
// declaration; graph_whereis ranked the C++ one first. An agent trusting the
// packet would have edited a shader copy.
//
// The cause was slice(0,6) over arrival order with no statement that the order
// meant nothing. Ranking belongs in graph_whereis — duplicating it here would
// give two rankings that can disagree. What the packet owes the reader is
// honesty about what its list IS.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'packet.js'),
  'utf8',
);

describe('symbol-pointer packet is honest about its candidate list', () => {
  it('★ announces that the order is arrival, not relevance', () => {
    expect(src).toMatch(/UNRANKED/);
    expect(src).toMatch(/order is arrival, not relevance/);
  });

  it('★ points at the verb that actually ranks', () => {
    // Without this the reader has no next step — the warning would tell them to
    // distrust the list and leave them there.
    // Anchor on the emitted STRING, not the first mention of "UNRANKED" — that
    // one is in the comment header above it, and matching there would pass on a
    // file where the warning was documented but never rendered.
    const i = src.indexOf('⚠ UNRANKED, showing');
    expect(i, 'the rendered warning exists').toBeGreaterThan(-1);
    expect(src.slice(i, i + 400)).toMatch(/graph_whereis\(symbol=/);
  });

  it('names the truncation as n of m when it truncates', () => {
    // "showing 6 of 16" is the difference between a sample and a complete answer.
    expect(src).toMatch(/showing \$\{SHOWN\} of \$\{symHits\.length\}/);
  });

  it('warns even when nothing was truncated but the match is ambiguous', () => {
    // 2 matches shown in full are still unranked. The danger is the first entry
    // reading as the definition, which does not require truncation.
    expect(src).toMatch(/symHits\.length > 1/);
  });
});
