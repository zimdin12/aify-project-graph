// HOTSPOTS MUST NOT PRESENT A NAME-RESOLVED FAN-IN AS A MEASURED ONE.
//
// Field report (2026-07-27), C++ repo: HOTSPOTS ranked `main` at 321 inbound and
// `build` at 612 — a symbol with 6 real occurrences. Neither number was a fact.
//
// Mechanism, traced to resolver.js:525-545 — when a bare call target has exactly
// ONE label match repo-wide, resolveTarget attaches the edge to it and
// pickProvenance stamps EXTRACTED. Global uniqueness of a NAME is treated as
// proof of IDENTITY. In C++ `a.build()` and `b.build()` are different methods, so
// every call site in the repo collapses onto whichever `build` is in the graph.
//
// Two guards, both cheap, neither waiting on the resolver rewrite:
//   1. HOTSPOT_NOISE derives from COMMON_NAMES, so a name the RESOLVER refuses to
//      trust can never be ranked as a hub by ANALYTICS. These were two hand-kept
//      lists of the same concept and they had drifted (`main` in one, not other).
//   2. A large fan-in with no ground-truth (LSP/code-intel) edge among the
//      inbound is reported as a CEILING, not a measurement.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import {
  computeHotspots,
  hotspotBoundCaveat,
  HOTSPOT_NOISE,
} from '../../../mcp/stdio/intelligence/analytics.js';
import { COMMON_NAMES } from '../../../mcp/stdio/ingest/denylist.js';

function node(db, id, label, file, type = 'Method') {
  db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,$type,$label,$file,1,5,'cpp',1,'{}')`,
    { id, type, label, file });
}

function edge(db, from, to, provenance, sourceFile) {
  db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ($from,$to,'CALLS',$sf,1,1.0,$prov,'cpp')`,
    { from, to, sf: sourceFile, prov: provenance });
}

describe('HOTSPOTS degree honesty', () => {
  let repoRoot;
  let dbPath;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-hotspot-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
  });
  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch {} });

  it('every name the resolver refuses is also refused as a hotspot', () => {
    // The drift that let `main` through. Asserting the SUBSET relation, not a
    // copy of the list, so a future addition to COMMON_NAMES cannot re-open it.
    for (const name of COMMON_NAMES) {
      expect(HOTSPOT_NOISE.has(name), `HOTSPOT_NOISE is missing "${name}"`).toBe(true);
    }
  });

  it('a name-only fan-in from many files is flagged as an upper bound', () => {
    const db = openDb(dbPath);
    node(db, 'target', 'serialize', 'src/core/Blob.cpp');
    // 40 callers across 40 distinct files, all name-resolved (EXTRACTED via the
    // unique-label path) — the exact `build`-with-612 shape.
    for (let i = 0; i < 40; i += 1) {
      node(db, `c${i}`, `caller${i}`, `src/mod${i}/unit.cpp`);
      edge(db, `c${i}`, 'target', 'EXTRACTED', `src/mod${i}/unit.cpp`);
    }
    db.close();

    const db2 = openDb(dbPath);
    const [top] = computeHotspots(db2, { limit: 5 });
    db2.close();

    expect(top.label).toBe('serialize');
    expect(top.fan_in).toBe(40);
    expect(top.fan_in_verified).toBe(0);
    expect(top.degree_is_upper_bound).toBe(true);
    expect(hotspotBoundCaveat(top)).toMatch(/upper bound/);
  });

  it('a ground-truth-backed fan-in is NOT downgraded', () => {
    // The guard must not over-correct into calling every hub unverified.
    const db = openDb(dbPath);
    node(db, 'target', 'serialize', 'src/core/Blob.cpp');
    for (let i = 0; i < 40; i += 1) {
      node(db, `c${i}`, `caller${i}`, `src/mod${i}/unit.cpp`);
      edge(db, `c${i}`, 'target', 'LSP_VERIFIED', `src/mod${i}/unit.cpp`);
    }
    db.close();

    const db2 = openDb(dbPath);
    const [top] = computeHotspots(db2, { limit: 5 });
    db2.close();

    expect(top.fan_in_verified).toBe(40);
    expect(top.degree_is_upper_bound).toBe(false);
    expect(hotspotBoundCaveat(top)).toBe('');
  });

  it('a small local fan-in is not flagged (threshold, not blanket suspicion)', () => {
    const db = openDb(dbPath);
    node(db, 'target', 'serialize', 'src/core/Blob.cpp');
    for (let i = 0; i < 4; i += 1) {
      node(db, `c${i}`, `caller${i}`, 'src/core/Blob.cpp');
      edge(db, `c${i}`, 'target', 'EXTRACTED', 'src/core/Blob.cpp');
    }
    db.close();

    const db2 = openDb(dbPath);
    const [top] = computeHotspots(db2, { limit: 5 });
    db2.close();

    expect(top.degree_is_upper_bound).toBe(false);
  });
});
