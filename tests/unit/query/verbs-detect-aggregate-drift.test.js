// ⛔ THE THIRD TIME THE CLASSIFIER WAS COVERED AND THE CALL WAS NOT.
//
// classifyPublication has thorough unit tests. They killed four mutants and MISSED two: reverting
// graph_status and graph_health to a generation-only classification changed nothing any test could
// see, because every assertion pointed at the function rather than at the verbs that call it.
//
// That is the same gap that let the original defect exist — reviewer reproduced production printing
//     graph_status : generationState=attested | dirtyEdgeCount=9 | dbUnresolvedCount=2
// while a hand-written comparison in a test passed. A test that agrees with the code about a
// property the code does not enforce is worse than no test: it is a green light over the hole.
//
// So this file asserts on VERB OUTPUT, through the real verbs, over a real drifted graph.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { readGraphPublication } from '../../../mcp/stdio/storage/publication-schema.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { graphStatus } from '../../../mcp/stdio/query/verbs/status.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';

let repo; let graphDir;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-drift-'));
  graphDir = join(repo, '.aify-graph');
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  // A repo-shaped import that cannot resolve, so the graph has a real unresolved population to
  // count. An empty population would make every count comparison trivially equal.
  writeFileSync(join(repo, 'src', 'a.js'), "import { g } from './missing.js';\nexport const u = g;\n");
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  await ensureFresh({ repoRoot: repo });
});

afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

/** Falsify ONLY the copied counts. Generation untouched on both sides — that is the trap. */
const driftTheManifestCounts = () => {
  const p = join(graphDir, 'manifest.json');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify({
    ...m,
    dirtyEdgeCount: (m.dirtyEdgeCount ?? 0) + 7,
    trustDirtyEdgeCount: (m.trustDirtyEdgeCount ?? 0) + 7,
  }));
};

const committed = () => {
  const db = openDb(join(graphDir, 'graph.sqlite'));
  try { return readGraphPublication(db); } finally { db.close(); }
};

describe('the verbs detect a manifest copy that drifted from the committed aggregates', () => {
  it('POSITIVE CONTROL: an untampered graph reports attested from both verbs', async () => {
    // ⛔ Without this, both denials below are satisfied by verbs that never attest anything.
    expect((await graphStatus({ repoRoot: repo })).generationState).toBe('attested');
    expect((await graphHealth({ repoRoot: repo })).capabilities.attestation).toBe('attested');
  });

  it('⛔ graph_status reports aggregate_mismatch, not attested', async () => {
    const before = committed();
    driftTheManifestCounts();
    const out = await graphStatus({ repoRoot: repo });
    expect(out.generationState).toBe('aggregate_mismatch');
    // And the committed aggregate is unchanged — the drift is in the copy, not the graph.
    expect(committed().counts).toEqual(before.counts);
  });

  it('⛔ graph_health denies authority and NAMES the drift', async () => {
    driftTheManifestCounts();
    const caps = (await graphHealth({ repoRoot: repo })).capabilities;
    expect(caps.attestation).toBe('aggregate_mismatch');
    expect(caps.absenceAuthority).toBe(false);
    expect(caps.reason).toBe('aggregate_mismatch');
    expect(caps.nextAction, 'the remedy must say the copy drifted, not that the graph is torn')
      .toMatch(/do NOT match the aggregates/);
  });

  it('⛔ status publishes ONE authoritative count, not two contradictory ones', async () => {
    // The original output printed dirtyEdgeCount=9 beside dbUnresolvedCount=2 under "attested" and
    // left the reader to notice. Where the two disagree the disagreement IS the finding.
    driftTheManifestCounts();
    const out = await graphStatus({ repoRoot: repo });
    expect(out.committedUnresolvedCount, 'the graph committed this').toBe(committed().counts.unresolved);
    expect(out.generationState, 'and the state says the manifest copy cannot be trusted')
      .toBe('aggregate_mismatch');
  });

  it('⛔ health and status agree on the state — two consumers, one classifier', async () => {
    // ⭐ FOUND BY THE FULL STATE MATRIX, NOT BY A UNIT TEST. Run against copies of the real graph,
    // an unreadable manifest produced health=manifest_unusable and status=generation_mismatch for
    // the SAME input: status destructured loadManifest's status and never passed it on. Each verb
    // was tested alone and neither test could see the disagreement.
    //
    // status telling a reader "a rebuild committed and its manifest never landed" when the manifest
    // was merely unreadable is the wrong-cause defect this unit keeps removing, arriving through a
    // consumer that had not been wired rather than through the classifier.
    writeFileSync(join(graphDir, 'manifest.json'), '{ this is not json');
    const h = (await graphHealth({ repoRoot: repo })).capabilities.attestation;
    const s = (await graphStatus({ repoRoot: repo })).generationState;
    expect(h, 'health must name the read failure').toBe('manifest_unusable');
    expect(s, 'and status must not call the same input a torn publication').toBe(h);
  });

  it('⛔ drifting ONLY the trust count is caught — it is the load-bearing half', async () => {
    const p = join(graphDir, 'manifest.json');
    const m = JSON.parse(readFileSync(p, 'utf8'));
    writeFileSync(p, JSON.stringify({ ...m, trustDirtyEdgeCount: (m.trustDirtyEdgeCount ?? 0) + 1 }));
    expect((await graphStatus({ repoRoot: repo })).generationState).toBe('aggregate_mismatch');
  });
});
