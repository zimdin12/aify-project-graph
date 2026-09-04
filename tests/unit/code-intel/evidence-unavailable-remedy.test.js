// ⛔⛔ ONE REMEDY, WRITTEN FOR ONE FAULT, HANDED TO EVERY FAULT.
//
// `renderEvidenceLine` emitted a single hardcoded sentence for every unavailable reason:
//
//     EVIDENCE: tree-sitter+overlay only; code_intel unavailable
//       (<reason>: install clangd or set --no-code-intel to silence)
//
// "install clangd" is the remedy for exactly ONE cause — `provider_missing`. Every other cause
// inherited it:
//
//     no_graph            no graph has been built     -> real remedy: graph_index
//     no_collection       no collection taken yet     -> real remedy: graph_collect_code_intel
//     an unreadable DB    the file is corrupt/locked  -> DEMONSTRATED, see below
//
// ⛔ THE UNREADABLE-DB CASE IS MEASURED, NOT ARGUED. A `.aify-graph/graph.sqlite` containing
// non-database bytes passes the `existsSync` guard, makes `openExistingDb` throw, and the catch
// leaves the default in place — so the agent is told `no_collection` (a claim about the REPO) and
// handed "install clangd". Installing clangd cannot fix a corrupt file, so the agent re-runs and
// gets the identical message forever.
//
// ⇒ This is the class ef-manager asked be fixed rather than its instances: *a remedy that cannot
// address the actual fault is worse than no remedy, because it spends the agent's next action on a
// guaranteed miss.* The structural repair is that a cause OWNS its remedy in one place, and an
// unrecognised cause gets NO invented action rather than inheriting someone else's.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remedyForUnavailable, UNAVAILABLE_REMEDIES } from '../../../mcp/stdio/code-intel/evidence-unavailable.js';
import { renderEvidenceLine } from '../../../mcp/stdio/code-intel/render.js';
import { buildEvidenceBlock } from '../../../mcp/stdio/query/verbs/packet-evidence.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

describe('an unavailable cause owns its own remedy', () => {
  it('★★★ each cause gets the action that can actually fix IT', () => {
    expect(remedyForUnavailable('no_graph')).toMatch(/graph_index/);
    expect(remedyForUnavailable('no_collection')).toMatch(/graph_collect_code_intel/);
    expect(remedyForUnavailable('provider_missing')).toMatch(/clangd/);
    expect(remedyForUnavailable('graph_unreadable')).toMatch(/rebuild|re-run graph_index/i);
  });

  it('★★★ POSITIVE CONTROL: the remedies are genuinely DIFFERENT sentences', () => {
    // Without this, a mapper returning one string for everything would satisfy nothing above while
    // reproducing the exact defect — which is how this shipped in the first place.
    const remedies = [...UNAVAILABLE_REMEDIES.keys()].map(remedyForUnavailable);
    expect(new Set(remedies).size, 'every cause must carry a distinct action').toBe(remedies.length);
  });

  it('★★★ an UNRECOGNISED cause is handed no action at all, rather than inheriting one', () => {
    // ⛔ FAIL CLOSED. Inheriting a neighbour's remedy is precisely the defect; the honest output
    // for a cause nobody wrote a remedy for is to say so, and to say the absence is unexplained.
    const r = remedyForUnavailable('some_cause_added_later');
    expect(r).toMatch(/no remedy is known|unexplained/i);
    expectAbsentWithLiveMatcher(
      /install clangd/,
      { forbidden: 'install clangd or set --no-code-intel to silence',
        allowed: 'no remedy is known for this cause' },
      r,
      'an unknown cause must not inherit the clangd remedy',
    );
  });

  it('★★★ the rendered line carries the cause-specific remedy', () => {
    const line = renderEvidenceLine({ available: false, reason: 'no_graph' });
    expect(line).toMatch(/no_graph/);
    expect(line).toMatch(/graph_index/);
    expectAbsentWithLiveMatcher(
      /install clangd/,
      { forbidden: 'no_graph: install clangd or set --no-code-intel to silence',
        allowed: 'no_graph: no graph has been built — run graph_index' },
      line,
      'no_graph is not fixed by installing clangd',
    );
  });

  it('★★★ DEMONSTRATED: an unreadable graph is not reported as "no collection"', () => {
    // The measured case. Real bytes, real openExistingDb, no stub.
    const repo = mkdtempSync(join(tmpdir(), 'apg-unavail-'));
    mkdirSync(join(repo, '.aify-graph'), { recursive: true });
    writeFileSync(join(repo, '.aify-graph', 'graph.sqlite'), 'this is not a sqlite database at all');

    const block = buildEvidenceBlock({ repoRoot: repo });
    expect(block.available).toBe(false);
    // ⛔ `no_collection` is a claim about the REPOSITORY. Nothing here established it — the probe
    // never got far enough to ask.
    expect(block.reason, 'an unreadable DB is not evidence that no collection exists')
      .not.toBe('no_collection');
    expect(block.reason).toBe('graph_unreadable');
  });

  it('★★ POSITIVE CONTROL: the honest cases still report themselves correctly', () => {
    // Proves the test above is discriminating, not just rejecting every reason.
    const bare = mkdtempSync(join(tmpdir(), 'apg-unavail-bare-'));
    expect(buildEvidenceBlock({ repoRoot: bare }).reason).toBe('no_graph');
  });
});
