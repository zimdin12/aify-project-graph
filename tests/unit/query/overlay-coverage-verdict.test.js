// UNMAPPED IS NOT UNAFFECTED.
//
// Field report (sc-manager, Sand Castle, 2026-08-04). graph_consequences was run
// on the file at the centre of five slices and two nights of work. It returned
// features_touching [], contracts [], open_tasks [], co_consumer_files [],
// claim_count 0. The code layer was healthy — 12,130 nodes, freshly indexed.
// Every empty field was overlay-derived, and the overlay had no feature
// anchoring that subsystem at all.
//
// The agent worked that out by hand, and reported having previously internalised
// "the graph doesn't help here" without ever learning WHY it returned nothing.
// That is the cost: an empty curated field has the same shape whether the
// curation says "nothing here" or was never written, so a reader with no way to
// tell them apart eventually stops asking.
//
// field_provenance labelled those fields `inferred` already. That names where a
// field COMES FROM; it does not say the overlay has no entry for THIS target,
// and only the second fact explains the emptiness.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../');
const SERVER = join(REPO, 'mcp', 'stdio', 'server.js');

function consequences(target) {
  const input = [
    JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'overlay-test', version: '1' } },
    }),
    JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'graph_consequences', arguments: { target, repo: REPO } },
    }),
  ].join('\n') + '\n';

  const out = execFileSync('node', [SERVER], { input, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  for (const line of out.split('\n')) {
    if (!line.startsWith('{')) continue;
    const msg = JSON.parse(line);
    if (msg.id === 2) return JSON.parse(msg.result.content[0].text);
  }
  throw new Error('no graph_consequences result');
}

describe('graph_consequences distinguishes an unmapped target from an unaffected one', () => {
  // This repo's own overlay anchors only a handful of globs, so it contains both
  // cases naturally — no fixture needed, and the test moves with the real map.
  const UNMAPPED = 'mcp/stdio/dashboard/server.js';
  const MAPPED = 'mcp/stdio/ingest/languages/cpp.js';

  it('an UNMAPPED target says so, and says what the emptiness means', () => {
    const res = consequences(UNMAPPED);
    expect(res.features_touching, 'precondition: this target is unmapped').toEqual([]);

    const cov = res.overlay_coverage;
    expect(cov, 'the verdict exists at all').toBeTruthy();
    expect(cov.target_is_mapped).toBe(false);
    expect(cov.cause).toBe('no_feature_anchors_this_target');
    // The consequence must be stated, not left for the reader to derive — that
    // derivation is exactly what the field report had to do by hand.
    expect(cov.consequence).toMatch(/UNMAPPED, not that it is unaffected/);
    expect(cov.remedy, 'names the way out').toMatch(/graph-build-functionality/);
    // And it must report the map's size, so "0 of 8 features" is legible as a
    // coverage gap rather than a broken tool.
    expect(cov.overlay_features_total).toBeGreaterThan(0);
  });

  it('a MAPPED target says its empty lists are a curated claim, not a gap', () => {
    const res = consequences(MAPPED);
    expect(res.features_touching.length, 'precondition: this target is mapped').toBeGreaterThan(0);

    const cov = res.overlay_coverage;
    expect(cov.target_is_mapped).toBe(true);
    expect(cov.cause).toBeNull();
    // The freshness caveat still applies — a curated claim is only as good as
    // the day it was curated.
    expect(cov.consequence).toMatch(/overlay_age_days/);
  });

  it('the two cases are actually distinguishable from each other', () => {
    // The regression this guards: before the fix BOTH returned the same shape —
    // empty lists plus an `inferred` provenance label — so no assertion on a
    // single response could tell them apart. If a future change collapses them
    // again, this fails even if each case above still looks individually sane.
    const unmapped = consequences(UNMAPPED).overlay_coverage;
    const mapped = consequences(MAPPED).overlay_coverage;
    expect(unmapped.target_is_mapped).not.toBe(mapped.target_is_mapped);
    expect(unmapped.cause).not.toBe(mapped.cause);
  });
});
