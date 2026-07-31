// A DEAD END SHOULD CARRY ITS OWN NEXT STEP.
//
// Every symbol verb answered a miss with `NO MATCH for "X". Try graph_search(...)`
// — an instruction to make a SECOND call for information THIS call already had in
// hand: the graph is open and the labels are indexed.
//
// For an agent that is a wasted round-trip on every typo, every half-remembered
// name, and every `foo` that is really `fooImpl`. Correctness has dominated this
// codebase; friction is what decides whether a tool gets reached for, and "run
// another verb" was friction we were choosing to emit.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import {
  findSimilarSymbols, rankSuggestions, noMatchMessage, editDistanceWithin,
} from '../../../mcp/stdio/query/did-you-mean.js';

function seed(db, rows) {
  for (const [id, label, type, file, line] of rows) {
    db.run(
      `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
       VALUES ($id,$type,$label,$file,$line,$line,'cpp',1,'{}')`,
      { id, type, label, file, line });
  }
}

describe('did-you-mean', () => {
  let dir; let db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-dym-'));
    mkdirSync(join(dir, '.aify-graph'), { recursive: true });
    db = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
    seed(db, [
      ['a', 'cylindricalLatBandsForBody', 'Function', 'engine/voxel/CylindricalPosition.h', 110],
      ['b', 'cylindricalLatBandsPerShell', 'Function', 'engine/voxel/CylindricalPosition.h', 97],
      ['c', 'WorldBuffer::upload', 'Method', 'engine/voxel/WorldBuffer.cpp', 806],
      ['d', 'unrelatedThing', 'Function', 'engine/core/Other.cpp', 12],
    ]);
  });
  afterEach(() => { try { db.close(); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('catches a genuine typo the old message would have sent you away for', () => {
    // `cylindricalLatBadsForBody` — one missing character. LIKE cannot find this,
    // which is why the edit-distance pass exists.
    const hits = findSimilarSymbols(db, 'cylindricalLatBadsForBody');
    expect(hits.map(h => h.label)).toContain('cylindricalLatBandsForBody');
  });

  it('matches a leaf name against a qualified symbol', () => {
    // Asking for `upload` should find `WorldBuffer::upload` — an extremely common
    // agent shape, since callers often know the method and not the class.
    const hits = findSimilarSymbols(db, 'upload');
    expect(hits.map(h => h.label)).toContain('WorldBuffer::upload');
  });

  it('ranks by an explainable reason, not an opaque score', () => {
    // An agent reading the output must be able to see WHY something was offered.
    const ranked = rankSuggestions('cylindricalLatBands', [
      { label: 'cylindricalLatBandsForBody' }, { label: 'unrelatedThing' },
    ]);
    expect(ranked[0].label).toBe('cylindricalLatBandsForBody');
    expect(ranked[0]._why).toMatch(/starts with your query/);
  });

  it('offers nothing when nothing is close — no noise', () => {
    // Suggesting a distant name is worse than suggesting none: it invites a second
    // wrong call and erodes trust in the suggestions that are good.
    expect(findSimilarSymbols(db, 'zzzzQuuxNotHere')).toEqual([]);
  });

  it('degrades to the ORIGINAL message when there is nothing to suggest', () => {
    // This can only add information, never remove it.
    const msg = noMatchMessage(db, 'zzzzQuuxNotHere');
    expect(msg).toMatch(/NO MATCH for "zzzzQuuxNotHere"/);
    expect(msg).toMatch(/Try graph_search/);
  });

  it('renders suggestions with type and location, so the next call is unambiguous', () => {
    const msg = noMatchMessage(db, 'cylindricalLatBands');
    expect(msg).toMatch(/Did you mean:/);
    expect(msg).toMatch(/cylindricalLatBandsForBody \(function\)/);
    expect(msg).toMatch(/engine\/voxel\/CylindricalPosition\.h:110/);
    // And it still offers the wider search, since a suggestion may be wrong.
    expect(msg).toMatch(/for a wider search/);
  });

  it('edit distance bails out early instead of scoring distant words', () => {
    expect(editDistanceWithin('abc', 'abd', 1)).toBe(1);
    expect(editDistanceWithin('abc', 'zzzzzzzz', 2)).toBeGreaterThan(2);
  });

  it('never throws — a suggestion is a convenience, not a new failure mode', () => {
    expect(findSimilarSymbols(null, 'x')).toEqual([]);
    expect(findSimilarSymbols(db, '')).toEqual([]);
  });
});
