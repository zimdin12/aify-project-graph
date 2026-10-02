// ⛔⛔ "DID ARM A USE THE LAYER" IS COUNTED FROM THE TRANSCRIPT, BY NODE IDS READ FROM STRUCTURE, AND A CALL WHOSE
// RESULT NEVER REACHED THE AGENT IS COUNTED APART FROM ONE THAT DID.
//
// The fixture is a seeded run of 2026-10-02 (session 8e9f79d7) against the trial's scratch dashboard, cut to its tool
// calls and results. Its four dashboard calls were fixed in the prompt before it ran:
//   1. graph_list for arm A    -> graphs and counts, no node    -> not a layer call
//   2. graph_get  for A's map  -> all 94 nodes, but 55.3 KB, so Claude Code saved it to a file and showed the agent a
//                                 2 KB preview with no node id in it -> a layer call the agent did not see
//   3. graph_query from symbol-lookup, depth 1 -> 8 nodes inline -> a layer call it saw
//   4. graph_list for arm B    -> nothing                        -> not a layer call
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authoredNodeIds, countLayerUse, isDashboardTool } from '../../../scripts/lib/trial-layer-use.mjs';
import { parseJsonl } from '../../../scripts/lib/claude-session-files.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FIX = join(REPO, 'tests', 'fixtures', 'claude-session', 'seeded-layer-run');
const SAVED = 'toolu_01KQxtjStPeAW3BPXkhiEyVv.json';
// The map the trial's import read: aify-project-graph 550643ef. Read from git rather than copied, so this test adds no
// tracked copy of the layer that an arm's checkout could carry.
const IDS = authoredNodeIds(JSON.parse(execFileSync('git', ['-C', REPO, 'show', '550643ef:.aify-graph/functionality.json'], { encoding: 'utf8' })));

const transcript = () => parseJsonl(readFileSync(join(FIX, 'transcript.jsonl'), 'utf8'), 'transcript').records;
const readPersisted = (path) => {
  const file = join(FIX, path.replace('<SAVED>/', ''));
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
const count = (records, ids = IDS, reader = readPersisted) => countLayerUse({ records, ids, readPersisted: reader });
const callAndResult = (id, name, input, content, isError = false) => [
  { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] } },
];

describe('the seeded run: four calls fixed in advance', () => {
  it('★★★ POSITIVE CONTROL: the two calls against the layer count, and only the inline one counts as seen', () => {
    const run = count(transcript());
    expect(run.ok, JSON.stringify(run.detail)).toBe(true);
    expect(run).toMatchObject({ dashboardCalls: 4, layerCalls: 2, seenCalls: 1 });
    expect(run.nodesTouched).toHaveLength(94);
    expect(run.nodesSeen).toHaveLength(8);
    expect(run.nodesSeen).toContain('symbol-lookup');
    const byTool = run.calls.map((c) => [c.tool.split('__').pop(), c.touched.length, c.shown]);
    expect(byTool).toEqual([
      ['dashboard_graph_list', 0, true],
      ['dashboard_graph_get', 94, false],
      ['dashboard_graph_query', 8, true],
      ['dashboard_graph_list', 0, true],
    ]);
  });

  it('★★★ the ids derived from the map are exactly the ids the service returned for the imported graph', () => {
    // Two substrates: this file's derivation from the map, and the service's own answer saved in call 2.
    const saved = JSON.parse(JSON.parse(readFileSync(join(FIX, SAVED), 'utf8'))[0].text);
    const held = new Set(saved.graph.document.nodes.map((n) => n.id));
    expect([...held].sort()).toEqual([...IDS].sort());
  });

  it('★★★ a saved result the agent then opened with Read counts as seen', () => {
    const opened = [...transcript(), ...callAndResult('r1', 'Read', { file_path: `<SAVED>/${SAVED}` }, 'file text')];
    expect(count(opened)).toMatchObject({ layerCalls: 2, seenCalls: 2 });
  });
});

describe('what does not count, and what cannot be told', () => {
  it('★★★ NEGATIVE CONTROL: feature ids in a reply\'s TEXT are not uses of the layer', () => {
    // `dashboard` and `briefs` are feature ids, and words every dashboard reply can contain.
    expect(IDS.has('dashboard')).toBe(true);
    const run = count(callAndResult('t1', 'mcp__aify-dashboard__dashboard_graph_list', {},
      [{ type: 'text', text: JSON.stringify({ graphs: [], note: 'the dashboard briefs say dashboard' }) }]));
    expect(run).toMatchObject({ ok: true, dashboardCalls: 1, layerCalls: 0 });
  });

  it('★★★ a call that failed used nothing, even when it named an authored node', () => {
    const run = count(callAndResult('e1', 'mcp__aify-dashboard__dashboard_graph_query', { graphId: 'g', from: 'symbol-lookup' }, 'no such graph', true));
    expect(run).toMatchObject({ ok: true, dashboardCalls: 1, layerCalls: 0 });
    // CONTROL: the same call succeeding with an empty answer counts, because it named the node.
    const ok = count(callAndResult('e2', 'mcp__aify-dashboard__dashboard_graph_query', { graphId: 'g', from: 'symbol-lookup' },
      [{ type: 'text', text: '{"nodes":[]}' }]));
    expect(ok).toMatchObject({ layerCalls: 1, seenCalls: 1 });
  });

  it('★★★ a saved result that is gone, a call with no result, or a reply that is not JSON: refused, not zero', () => {
    expect(count(transcript(), IDS, () => null)).toMatchObject({ ok: false, reason: 'persisted_result_missing' });
    const lone = [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'mcp__d__dashboard_graph_get', input: {} }] } }];
    expect(count(lone)).toMatchObject({ ok: false, reason: 'call_without_result' });
    expect(count(callAndResult('y', 'mcp__d__dashboard_graph_get', {}, 'not json'))).toMatchObject({ ok: false, reason: 'unparseable_result' });
    expect(count(transcript(), new Set())).toMatchObject({ ok: false, reason: 'no_authored_ids' });
  });

  it('★★★ only dashboard tools are dashboard calls', () => {
    expect(isDashboardTool('mcp__aify-dashboard__dashboard_graph_get')).toBe(true);
    expect(isDashboardTool('dashboard_graph_get')).toBe(true);
    expect(isDashboardTool('mcp__aify-project-graph__graph_packet')).toBe(false);
    expect(isDashboardTool('Read')).toBe(false);
  });
});
