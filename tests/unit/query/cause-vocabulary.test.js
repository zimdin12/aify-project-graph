// The trust contract tells agents that `evidence.exhaustive:false` carries a
// `cause` naming WHY the set is incomplete, and server-instructions enumerates
// them. Agents key on those exact strings — an undocumented cause is a string
// the agent has no rule for, on the one surface that must never be ambiguous.
//
// Measured 2026-07-26: 6 of the 9 causes the code could emit (cold_index,
// stale_index, timeout, definition_only, no_incoming_unconfirmed, bounded_mode)
// were NOT documented, while the instructions read as an exhaustive list.
//
// This test keeps code and instructions in lockstep: add a cause, document it.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_INSTRUCTIONS } from '../../../mcp/stdio/server-instructions.js';
import { RECEIPT_CAUSES } from '../../../mcp/stdio/code-intel/selection-digest.js';

const MCP_ROOT = fileURLToPath(new URL('../../../mcp/stdio/', import.meta.url));

function allJsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) allJsFiles(p, out);
    else if (entry.endsWith('.js')) out.push(p);
  }
  return out;
}

// ⚠ THERE ARE NOW TWO CLOSED VOCABULARIES SHARING THE KEY `cause`, and merging them was
// wrong in both directions. EVIDENCE causes explain why a result set is incomplete and are
// documented in the always-paid SERVER_INSTRUCTIONS, because an agent branches on them every
// call. RECEIPT-AVAILABILITY causes explain why an audit receipt could not be emitted; they
// belong to the selection-receipt contract and documenting them in the billed tier would spend
// every session's budget on a surface most calls never touch.
//
// ⇒ Split by SOURCE FILE ownership, and keep the ratchet on BOTH — a new cause in either
// vocabulary still has to be written down somewhere a reader can find it. Renaming the field to
// dodge this guard would have been gaming it; leaving the strings undocumented would have been
// the defect the guard exists to catch.
const RECEIPT_FILES = ['selection-digest.js'];
const SPEC_DOC = fileURLToPath(new URL('../../../docs/2026-08-19-selection-receipt-spec.md', import.meta.url));

// ⛔ THE HARVESTER WENT BLIND AND ONLY ITS OWN SELF-GUARD NOTICED. It matched the literal form
// `cause: '...'`; refactoring the receipt refusals into a helper made it find ZERO causes, and
// the "documents every cause" assertion would have passed vacuously over an empty set. A
// checker that cannot see its population will eventually certify an empty one — the same shape
// as every other instrument failure recorded in this repo.
//
// ⇒ Receipt causes now come from an EXPORTED ENUM, so the vocabulary is a value rather than a
// syntax. Evidence causes still need the source scan (they are returned inline from a dozen
// branches), but that scan keeps its non-vacuity guard.
function emittedCauses({ receipt = false } = {}) {
  if (receipt) return Object.values(RECEIPT_CAUSES).sort();
  const found = new Set();
  for (const file of allJsFiles(MCP_ROOT)) {
    if (RECEIPT_FILES.some((n) => file.endsWith(n))) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/cause:\s*'([a-z_]+)'/g)) found.add(m[1]);
  }
  return [...found].sort();
}

describe('evidence cause vocabulary', () => {
  it('emits at least the known causes (guards the harvester itself)', () => {
    const causes = emittedCauses();
    expect(causes).toContain('coverage_unknown');
    expect(causes).toContain('definition_only');
    expect(causes.length).toBeGreaterThanOrEqual(8);
  });

  it('documents EVERY cause the server can emit in SERVER_INSTRUCTIONS', () => {
    const undocumented = emittedCauses().filter((c) => !SERVER_INSTRUCTIONS.includes(c));
    expect(
      undocumented,
      `undocumented evidence causes — agents key on these strings, so add them to server-instructions.js: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });

  it('documents EVERY receipt-availability cause in the selection-receipt spec', () => {
    // Same ratchet, different home. These reach an agent as `receipt.status:'unavailable'`, so
    // an undocumented one is still a string with no rule behind it.
    const spec = readFileSync(SPEC_DOC, 'utf8');
    const causes = emittedCauses({ receipt: true });
    expect(causes.length, 'guards the harvester: the receipt module must emit causes').toBeGreaterThan(3);
    expect(
      causes.filter((c) => !spec.includes(c)),
      'undocumented receipt causes — add them to docs/2026-08-19-selection-receipt-spec.md',
    ).toEqual([]);
  });

  it('states the fail-closed rule and that absence needs exhaustive', () => {
    // The two load-bearing sentences of the contract. If either disappears, an
    // agent can read a FLOOR as a complete set.
    expect(SERVER_INSTRUCTIONS).toMatch(/FLOOR/);
    expect(SERVER_INSTRUCTIONS).toMatch(/exhaustive/);
    expect(SERVER_INSTRUCTIONS).toMatch(/coverage_unknown/);
  });
});
