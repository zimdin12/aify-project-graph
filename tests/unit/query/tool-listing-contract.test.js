// ★ THE VERB THAT CALIBRATES THE OTHERS MUST NOT BE IN THE SHORT-DESCRIPTION TIER.
//
// SHORT_DESCRIPTIONS replaces a verb's full prose with one line in tools/list, to cut
// the per-session manifest tax on verbs that are "rarely the first reach". graph_health
// was in it — so agents saw 66 characters ("Graph trust + dirty-edge breakdown. Run to
// assess indexing quality.") instead of the description explaining WHEN to call it and
// what would make you distrust every OTHER verb's answer.
//
// A field reviewer read tools/list cold and failed exactly that verb: the one whose
// purpose is "can I trust what I am about to be told" was the only one in the set
// saying nothing about when to doubt it. Its own output had reported the feature
// overlay 99 days stale — the fact that discounts graph_consequences' inferred fields
// — and nothing in the listing connected them.
//
// ★ AND THE FULL DESCRIPTION HAD ALREADY BEEN REWRITTEN. The rewrite went to a
// description the listing does not serve for that verb. Two sources of truth, and the
// improved one was not the one being read.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../mcp/stdio/server.js'), 'utf8');
const shortBlock = src.slice(src.indexOf('const SHORT_DESCRIPTIONS'), src.indexOf('function projectToShortDescription'));

describe('tools/list carries the facts an agent needs to choose and to doubt', () => {
  it('graph_health is NOT short-formed — it is the session-start verb', () => {
    expect(shortBlock).not.toMatch(/'graph_health'/);
  });

  it('★ graph_collect_code_intel says it DELETES the prior collection', () => {
    // The only description issue rated a publish gate rather than polish: everything
    // else costs the reader accuracy, this one can cost them data. A complete collect
    // prunes the prior same-provider collection — which is a real incident that
    // happened to a reviewer who had read more of this system than any new user will.
    expect(src).toMatch(/THIS CALL DELETES DATA/);
    expect(src).toMatch(/A PARTIAL collect does not/);
  });

  it('the cold-session remedy is in the description, not only in the error', () => {
    // Both verbs told you to distrust a degraded answer and neither named the fix,
    // which lived only in the response fallback — discoverable after being burned.
    const cold = src.match(/ON A COLD SESSION/g) || [];
    expect(cold.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/waitForReadyMs/);
  });
});
