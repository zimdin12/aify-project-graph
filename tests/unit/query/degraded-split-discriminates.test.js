// ★ A FIELD THAT FIRES EVERYWHERE AND A FIELD THAT FIRES CORRECTLY ARE
//   INDISTINGUISHABLE UNTIL YOU PRODUCE A CASE WHERE IT MUST NOT FIRE.
//
// ef-manager's control, and the reasoning is why this test exists rather than a
// single happy-path assertion. The real-world observation is {total 833,
// degraded 833, clean 0} — which proves the field POPULATES and cannot prove it
// DISCRIMINATES, because clean is 0. A breakdown that hardcoded clean:0, or that
// mislabelled every record degraded, produces a byte-identical result.
//
// It is the same shape as the control that turned his 52% answer from a
// coincidence into a measurement: 'found' records carry NO cause (400/400),
// position_unresolved carry NO cause (21/21). Without a case where the field must
// stay silent, "it fired" is not evidence.
//
// Waiting for a repo that yields both non-zero could take months, so the arms are
// seeded directly on the collection row — no repo, no clangd, no live DB.
//
// SCOPE, stated because the boundary matters: this verifies PERSISTENCE →
// READER → SURFACING. It does NOT verify that the provider classifies a given
// absence correctly as degraded vs clean; that needs a real collect.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ensureCodeIntelCollectionsTable, ensureCodeIntelRecordsTable } from '../../../mcp/stdio/storage/schema.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';

let repo;

function seed(degraded, clean) {
  const db = new Database(join(repo, '.aify-graph', 'graph.sqlite'));
  db.prepare('UPDATE code_intel_collections SET refs_degraded = ?, refs_clean_not_found = ?').run(degraded, clean);
  db.close();
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'apg-disc-'));
  mkdirSync(join(repo, '.aify-graph'), { recursive: true });
  const db = new Database(join(repo, '.aify-graph', 'graph.sqlite'));
  ensureCodeIntelCollectionsTable(db);
  ensureCodeIntelRecordsTable(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, type TEXT, label TEXT, file_path TEXT,
      start_line INTEGER, end_line INTEGER, language TEXT, confidence REAL, structural_fp TEXT,
      dependency_fp TEXT, extra TEXT);
    CREATE TABLE IF NOT EXISTS edges (from_id TEXT, to_id TEXT, relation TEXT, source_file TEXT,
      source_line INTEGER, confidence REAL, provenance TEXT, extractor TEXT);
  `);
  db.prepare(`INSERT INTO code_intel_collections
    (collection_id, provider, provider_version, project_root, language, status, collected_at, refs_found, refs_not_found)
    VALUES ('c1','cpp-clangd','0.1.0',?, 'cpp','ok','2026-08-02T00:00:00Z', 766, 833)`).run(repo);
  db.close();
});

afterAll(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* best-effort */ } });

describe('★ the degraded/clean split discriminates rather than decorating', () => {
  it('reports the seeded values instead of a hardcoded shape', async () => {
    seed(800, 33);
    const b = (await graphHealth({ repoRoot: repo })).codeIntel.refsNotFoundBreakdown;
    expect(b).toMatchObject({ total: 833, degraded: 800, clean: 33 });
  });

  it('moves when the split moves — the property a hardcoded clean:0 cannot fake', async () => {
    seed(500, 333);
    const b = (await graphHealth({ repoRoot: repo })).codeIntel.refsNotFoundBreakdown;
    expect(b).toMatchObject({ total: 833, degraded: 500, clean: 333 });
  });

  it('says ZERO clean absences only when there genuinely are none', async () => {
    seed(833, 0);
    const h = await graphHealth({ repoRoot: repo });
    expect(h.codeIntel.refsNotFoundBreakdown).toMatchObject({ degraded: 833, clean: 0 });
    expect(h.summary).toMatch(/ZERO are clean absences/);
  });

  it('★ STAYS SILENT when nothing is degraded — the case where it must NOT fire', async () => {
    // The arm that makes the other three mean something. A field that warns
    // unconditionally is indistinguishable from one that warns correctly.
    seed(0, 833);
    const h = await graphHealth({ repoRoot: repo });
    expect(h.codeIntel.refsNotFoundBreakdown).toMatchObject({ degraded: 0, clean: 833 });
    expect(h.summary).not.toMatch(/are DEGRADED/);
  });
});
