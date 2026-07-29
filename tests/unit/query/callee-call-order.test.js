// CALLEES ARE A SEQUENCE, NOT A RANKING.
//
// "Who calls X" is a set — order is a ranking question. "What does X call" is
// what an agent asks while reading a function body, and the useful order is the
// order the calls occur in.
//
// Field report (2026-07-27): graph_callees returned its list in an order that
// looked alphabetical/scrambled. Two causes stacked:
//   1. `rankCallees` was a literal alias of `rankCallers`, and for a callee list
//      EVERY tiebreaker in that function is constant (depth 1 at the default,
//      fan_in hardcoded to 1, from_type always 'Function'). All tiers collapsed
//      and the stable sort fell through to arbitrary SQL row order.
//   2. The mapper overwrote `source_line` with the CALLEE'S DEFINITION line,
//      discarding the only field that could express call order.
// The SQL also had no ORDER BY, so its LIMIT 100 truncated arbitrarily.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';
import { rankCallees } from '../../../mcp/stdio/query/rank.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function node(db, id, label, file, line) {
  db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,'Function',$label,$file,$line,$end,'cpp',1,'{}')`,
    { id, label, file, line, end: line + 2 });
}

describe('graph_callees returns calls in body order', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-callorder-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });
  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch {} });

  it('orders callees by call-site line, not by callee definition line', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    node(db, 'root', 'orchestrate', 'src/run.cpp', 10);
    // Definition lines are DESCENDING while call-site lines ASCEND, so a list
    // ordered by the wrong field comes out exactly reversed. Labels are also
    // reverse-alphabetical to the call order, catching an alphabetical fallback.
    const callees = [
      { id: 'z', label: 'zeta_first', defLine: 900, callLine: 11 },
      { id: 'm', label: 'mu_second', defLine: 600, callLine: 12 },
      { id: 'a', label: 'alpha_third', defLine: 300, callLine: 13 },
    ];
    for (const c of callees) {
      node(db, c.id, c.label, 'src/lib.cpp', c.defLine);
      db.run(
        `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
         VALUES ('root',$to,'CALLS','src/run.cpp',$line,1.0,'EXTRACTED','cpp')`,
        { to: c.id, line: c.callLine });
    }
    db.close();

    const out = await graphCallees({ repoRoot, symbol: 'orchestrate' });

    const order = ['zeta_first', 'mu_second', 'alpha_third']
      .map((label) => out.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it('rankCallees still puts ground truth ahead of a heuristic earlier in the body', () => {
    // Ordering by body position must not interleave a verified edge with guesses.
    const ranked = rankCallees([
      { to_label: 'guess_at_top', call_line: 1, provenance: 'EXTRACTED' },
      { to_label: 'verified_lower', call_line: 99, provenance: 'LSP_VERIFIED' },
    ]);
    expect(ranked.map((e) => e.to_label)).toEqual(['verified_lower', 'guess_at_top']);
  });

  it('rankCallees is deterministic when call lines are absent', () => {
    // Missing call_line must degrade to a stable label order, not arbitrary order.
    const edges = [
      { to_label: 'charlie', provenance: 'EXTRACTED' },
      { to_label: 'alpha', provenance: 'EXTRACTED' },
      { to_label: 'bravo', provenance: 'EXTRACTED' },
    ];
    expect(rankCallees(edges).map((e) => e.to_label)).toEqual(['alpha', 'bravo', 'charlie']);
  });
});
