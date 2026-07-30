// AN OVER-BROAD TRUE STATEMENT IS NOT SAFER THAN A FALSE ONE.
//
// graph_health said "trust spine EMPTY … every caller answer is heuristic-only and
// CANNOT attest exhaustiveness". True of the STORED GRAPH, false of the LIVE verbs,
// which query the language server directly and never read those edges.
//
// The field caught both in one session, minutes apart, on one server (ef-manager,
// echoes, 2026-07-30):
//     graph_health          : trust spine EMPTY, CANNOT attest exhaustiveness
//     code_intel_references : exhaustive true, confidence high, degraded false
//
// Both correct about different things — which is exactly why the pair was harmful.
// A reader deciding whether to delete a symbol could not tell which surface
// governed the decision, so the over-broad warning destroyed their ability to use
// the accurate signal sitting next to it.
//
// Rule: a claim about trustworthiness names the SURFACE it governs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAbsenceTrustLine } from '../../../mcp/stdio/query/lsp-evidence.js';

const here = dirname(fileURLToPath(import.meta.url));
const health = readFileSync(join(here, '../../../mcp/stdio/query/verbs/health.js'), 'utf8');

describe('health and the live verbs agree about scope', () => {
  it('the empty-spine banner scopes itself to GRAPH-backed answers', () => {
    expect(health).toMatch(/GRAPH-BACKED caller answers \(graph_callers, graph_impact, graph_pull, graph_consequences\)/);
    // The unscoped universal is what made it contradict the live verbs. Check the
    // EMITTED string, not the file — the comment above the fix quotes the old
    // wording deliberately, as the record of what was wrong, and a naive
    // file-wide negative match would fail on the documentation.
    const emitted = health.slice(health.indexOf("'⚠ trust spine EMPTY"));
    const banner = emitted.slice(0, emitted.indexOf(');'));
    expect(banner).not.toMatch(/every caller answer is heuristic-only/);
  });

  it('and explicitly hands the delete decision to the live verbs evidence block', () => {
    expect(health).toMatch(/does NOT constrain the LIVE verbs/);
    expect(health).toMatch(/trust THEIR evidence\.exhaustive for a delete decision, not this line/);
  });

  it('exposes a scoped field, keeping the old key for back-compat', () => {
    // Renaming in meaning without breaking a consumer that reads the old key.
    expect(health).toMatch(/codeIntel\.graphCallerCompletenessTrustworthy = false/);
    expect(health).toMatch(/codeIntel\.callerCompletenessTrustworthy = false/);
    expect(health).toMatch(/liveVerbsUnaffectedByEmptySpine = true/);
  });

  it('the graph-side absence line already pointed at the live verbs — the two now match', async () => {
    // This side was correct all along; the contradiction was one-sided. Pinned so a
    // future edit cannot make health right and this wrong.
    const line = await buildAbsenceTrustLine({ noun: 'callers' });
    expect(line).toMatch(/absence is from the heuristic graph and is NOT exhaustive/);
    expect(line).toMatch(/code_intel_references/);
  });
});
