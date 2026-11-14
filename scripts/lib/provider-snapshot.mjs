// All provider graph reads share the same existence, publication and snapshot gate.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureExistingSnapshot } from '../../mcp/stdio/storage/db.js';
import { ATTESTATION, classifyAttestation, readGraphPublication } from '../../mcp/stdio/storage/publication-schema.js';
import { enableSteps } from './apg-index.mjs';

function readManifest(repoRoot) {
  try { return JSON.parse(readFileSync(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8')); }
  catch { return null; }
}

function staleness(manifest, head) {
  const reasons = [];
  const indexCommit = typeof manifest?.commit === 'string' && manifest.commit !== '' ? manifest.commit : null;
  if (indexCommit === null) reasons.push('index_commit_unknown');
  else if (indexCommit !== head) reasons.push('index_behind_head');
  if (Array.isArray(manifest?.dirtyFiles) && manifest.dirtyFiles.length > 0) reasons.push('indexed_with_uncommitted_changes');
  return { indexCommit, head, stale: reasons.length > 0, staleBecause: reasons };
}

/** Capture plain data synchronously. Never creates an index or holds a database over an await. */
export function readAttestedSnapshot({ repoRoot, head, capture }) {
  const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
  if (!existsSync(dbPath)) {
    const enable = enableSteps(repoRoot);
    return { ok: false, problem: `no graph index at ${dbPath}. Enable it with: ${enable[0]} ; keep it current with: ${enable[1]}`, reasonCode: 'no_index', enable };
  }
  if (typeof capture !== 'function' || capture.constructor.name === 'AsyncFunction') {
    throw new Error('provider snapshot capture must be a synchronous function');
  }
  const manifest = readManifest(repoRoot);
  return captureExistingSnapshot(dbPath, (db) => {
    const attestation = classifyAttestation({
      dbGeneration: readGraphPublication(db)?.generation ?? null,
      manifestGeneration: manifest?.generation ?? null,
      manifestUsable: manifest !== null,
    });
    if (attestation !== ATTESTATION.ATTESTED) {
      return { ok: false, problem: `the index cannot be read as one whole build (${attestation})`, reasonCode: 'index_not_attested' };
    }
    const result = capture(db);
    if (result !== null && typeof result?.then === 'function') throw new Error('provider snapshot capture must be synchronous');
    return result.ok ? { ...result, value: { ...staleness(manifest, head), ...result.value } } : result;
  });
}
