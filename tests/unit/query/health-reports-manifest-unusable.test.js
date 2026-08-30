// ⛔ THE CLASSIFIER WAS TESTED. THE WIRING WAS NOT — AND THE WIRING IS WHERE THE DEFECT LIVED.
//
// health.js destructured `{ manifest }` from loadManifest and threw away the load status, so a
// corrupt or missing manifest reached classifyAttestation as generation=null against a healthy
// database and was reported as a torn publication: "a rebuild committed and its manifest never
// landed". Nothing established that.
//
// ⭐ A MUTANT IS WHY THIS FILE EXISTS. After fixing it, a mutation that removed the load-status
// argument from health's call SURVIVED the whole suite — every attestation test asserts against
// classifyAttestation directly, so none of them could see a caller that stopped asking. The unit
// under test here is the CALL, not the function it calls.
//
// ⚠ The name collision that hid it is one line wide and still there: `manifestLoad.status` is
// whether the file could be READ; `manifest.status` is the manifest's own ok/indexing field.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { bumpGraphGeneration } from '../../../mcp/stdio/storage/publication-schema.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';

let repo; let graphDir;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'apg-manifest-'));
  graphDir = join(repo, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const db = openDb(join(graphDir, 'graph.sqlite'));
  try {
    db.run("INSERT INTO nodes (id, type, label, file_path) VALUES ('n1', 'File', 'a.js', 'a.js')");
    bumpGraphGeneration(db, { unresolvedCount: 0, trustUnresolvedCount: 0 });  // generation 1
  } finally { db.close(); }
});

afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

const writeManifest = (bytes) => writeFileSync(join(graphDir, 'manifest.json'), bytes);
const goodManifest = () => JSON.stringify({
  status: 'ok', commit: 'a'.repeat(40), indexedAt: '2026-08-30T00:00:00.000Z',
  nodes: 1, edges: 0, schemaVersion: SCHEMA_VERSION, generation: 1,
  dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0, trustDirtyEdgeCount: 0,
});

describe('graph_health passes the manifest LOAD STATUS, not just the manifest', () => {
  it('POSITIVE CONTROL: a readable, agreeing manifest reports ATTESTED', async () => {
    // ⛔ Without this the two cases below would pass against a verb that reported
    // manifest_unusable unconditionally — a state that never lifts is not a state.
    writeManifest(goodManifest());
    const out = await graphHealth({ repoRoot: repo });
    expect(out.capabilities.attestation).toBe('attested');
  });

  it('⛔ a CORRUPT manifest reports manifest_unusable, not a torn publication', async () => {
    writeManifest(goodManifest().slice(0, 60));
    const out = await graphHealth({ repoRoot: repo });
    expect(out.capabilities.attestation).toBe('manifest_unusable');
    expect(out.capabilities.nextAction, 'the remedy names the read failure, not a crash window')
      .toMatch(/could not be read/);
  });

  it('⛔ an ABSENT manifest reports manifest_unusable too', async () => {
    // Nothing whatever is known about a crash window here — the graph may be a fresh checkout.
    rmSync(join(graphDir, 'manifest.json'), { force: true });
    const out = await graphHealth({ repoRoot: repo });
    expect(out.capabilities.attestation).toBe('manifest_unusable');
  });

  it('⛔ neither case claims a rebuild committed without its manifest', async () => {
    // The precise sentence the defect emitted. Asserting on the CLAIM rather than the state name
    // means a future refactor that reintroduces the wording is caught even if the enum survives.
    writeManifest(goodManifest().slice(0, 60));
    const out = await graphHealth({ repoRoot: repo });
    expect(out.capabilities.nextAction).not.toMatch(/manifest never landed/);
    expect(out.capabilities.nextAction).not.toMatch(/DIFFERENT generations/);
  });
});
