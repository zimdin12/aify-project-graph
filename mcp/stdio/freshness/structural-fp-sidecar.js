// P1-6: per-file STRUCTURAL fingerprint sidecar.
//
// Stores a map { repoRelativePath -> structuralFingerprint } so the
// incremental `ensureFresh` path can decide, before re-extracting +
// re-resolving a changed file, whether the change was COSMETIC (body /
// comment / whitespace / literal-value edit — same structural shape) or
// STRUCTURAL (signature, member, import/export, or call/ref-set change).
//
// A cosmetic change can't alter any node shape or any edge, so we keep the
// file's existing nodes/edges and skip the expensive re-resolution. Only a
// structural change re-extracts + re-resolves.
//
// Kept as a sidecar (not the manifest) to mirror the dirty-edges plumbing and
// avoid ballooning manifest.json on large repos (one hash per file). Best-
// effort: a missing/corrupt sidecar simply disables the cosmetic fast-path
// (every changed file is treated as structural — correct, just slower).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_JSON_MAX_BYTES } from '../util/json.js';

const SIDECAR_FILE = 'structural-fp.json';

export async function readStructuralFpSidecar(graphDir) {
  const path = join(graphDir, SIDECAR_FILE);
  try {
    const raw = await readFile(path, 'utf8');
    // Guard against a corrupt/huge sidecar OOM-ing JSON.parse.
    const cap = Number(process.env.APG_JSON_MAX_BYTES) > 0
      ? Number(process.env.APG_JSON_MAX_BYTES)
      : DEFAULT_JSON_MAX_BYTES;
    if (raw.length > cap) return new Map();
    const parsed = JSON.parse(raw);
    const fps = parsed?.fingerprints;
    if (!fps || typeof fps !== 'object') return new Map();
    return new Map(Object.entries(fps));
  } catch {
    // Missing or corrupt — disable the fast-path (treat everything structural).
    return new Map();
  }
}

export async function writeStructuralFpSidecar(graphDir, fingerprints) {
  await mkdir(graphDir, { recursive: true });
  const path = join(graphDir, SIDECAR_FILE);

  const obj = fingerprints instanceof Map
    ? Object.fromEntries(fingerprints)
    : (fingerprints ?? {});

  const tempPath = `${path}.${randomUUID()}.tmp`;
  const payload = JSON.stringify({
    count: Object.keys(obj).length,
    writtenAt: new Date().toISOString(),
    fingerprints: obj,
  });
  await writeFile(tempPath, payload, 'utf8');
  await rename(tempPath, path);
}
