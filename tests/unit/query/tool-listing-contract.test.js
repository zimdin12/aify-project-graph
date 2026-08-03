// ★ THE VERB THAT CALIBRATES THE OTHERS MUST CARRY ITS OWN DOUBT CLAUSE.
//
// tools/list is the ONLY thing an agent is guaranteed to read about a verb. A
// skill body costs nothing until invoked; this surface is in context from the
// first token of every session. So it must carry the facts needed to CHOOSE a
// verb and to DOUBT its answer — and little else, because everything else is
// rent paid by every session that never touches the graph.
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
//
// These assertions therefore run against the SERVED listing — the bytes a client
// actually receives — not against the source file. The earlier version of this
// test grepped server.js, which cannot tell the two sources apart and so could
// not have caught the bug in its own header. It also asserted that graph_health
// was NOT short-formed, which was a STAND-IN for the real requirement (its
// listed text must carry its scope caveat); the stand-in would block any short
// form at all, including one that keeps the caveat.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../mcp/stdio/server.js');

/** Boot the real server and return what tools/list actually serves. */
function servedDescriptions() {
  const input = [
    JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'contract-test', version: '1' } },
    }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  ].join('\n') + '\n';

  const out = execFileSync('node', [SERVER], { input, encoding: 'utf8', timeout: 120000 });
  for (const line of out.split('\n')) {
    if (!line.startsWith('{')) continue;
    const msg = JSON.parse(line);
    if (msg.id === 2 && msg.result?.tools) {
      return new Map(msg.result.tools.map((t) => [t.name, t.description]));
    }
  }
  throw new Error('server returned no tools/list result');
}

describe('tools/list carries the facts an agent needs to choose and to doubt', () => {
  let served;
  beforeAll(() => { served = servedDescriptions(); }, 120000);

  it('serves the focused set', () => {
    // Guards the harness: if this came back empty or huge, every content
    // assertion below would be checking nothing.
    expect(served.size).toBeGreaterThan(10);
    expect(served.size).toBeLessThan(25);
  });

  it('graph_health states the SCOPE of its own verdict', () => {
    // The real requirement behind the old "must not be short-formed" guard. A
    // healthy verdict here does not license a delete — that gate is
    // evidence.exhaustive on code_intel_references, and an agent reading this
    // listing cold has no other way to learn it.
    const d = served.get('graph_health');
    expect(d, 'graph_health is listed').toBeTruthy();
    expect(d).toMatch(/exhaustive/);
    expect(d).toMatch(/code_intel_references/);
  });

  it('★ graph_collect_code_intel says it DELETES the prior collection', () => {
    // The only description issue rated a publish gate rather than polish: everything
    // else costs the reader accuracy, this one can cost them data. A complete collect
    // prunes the prior same-provider collection — which is a real incident that
    // happened to a reviewer who had read more of this system than any new user will.
    const d = served.get('graph_collect_code_intel');
    expect(d).toMatch(/THIS CALL DELETES DATA/);
    // The exemption matters as much as the warning: without it an agent avoids the
    // resume calls a cold collect REQUIRES, believing each one destroys the last.
    expect(d).toMatch(/A PARTIAL collect does not/);
  });

  it('the cold-session remedy is served, not only raised in the error', () => {
    // Both verbs told you to distrust a degraded answer and neither named the fix,
    // which lived only in the response fallback — discoverable after being burned.
    for (const verb of ['code_intel_references', 'code_intel_hierarchy']) {
      expect(served.get(verb), `${verb} names the cold-session remedy`).toMatch(/waitForReadyMs/);
    }
  });

  it('every verb that can license a destructive decision says when to doubt it', () => {
    // The general form of the bug in the header. These verbs answer questions
    // where a confident wrong answer deletes code, so their doubt clause may
    // never be demoted to a skill the agent has to choose to load first.
    const mustDoubt = {
      code_intel_references: /NOT EVIDENCE OF NO CALLERS/,
      graph_callers: /HEURISTIC BY DEFAULT/,
      code_intel_hierarchy: /NOT that nothing calls it/,
      graph_consequences: /NOT evidence of absence/,
    };
    for (const [verb, clause] of Object.entries(mustDoubt)) {
      expect(served.get(verb), `${verb} carries its doubt clause`).toMatch(clause);
    }
  });
});
