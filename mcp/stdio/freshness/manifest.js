import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_JSON_MAX_BYTES } from '../util/json.js';

const MANIFEST_FILE = 'manifest.json';

function defaultManifest() {
  return {
    commit: null,
    indexedAt: null,
    nodes: 0,
    edges: 0,
    schemaVersion: 1,
    extractorVersion: '0.0.0',
    parserBundleVersion: '0.0.0',
    dirtyFiles: [],
    dirtyEdges: [],
    dirtyEdgeCount: 0,
    trustDirtyEdgeCount: null,
  };
}

export async function loadManifest(graphDir) {
  const manifestPath = join(graphDir, MANIFEST_FILE);

  try {
    // P5-1: size-cap the manifest before reading it into memory. A corrupt
    // or maliciously huge manifest.json must not OOM the server; treat
    // over-cap the same as a corrupt file (degrade to defaults).
    const cap = Number(process.env.APG_JSON_MAX_BYTES) > 0
      ? Number(process.env.APG_JSON_MAX_BYTES)
      : DEFAULT_JSON_MAX_BYTES;
    const { size } = await stat(manifestPath);
    if (size > cap) {
      return { status: 'corrupt', manifest: defaultManifest(), parsed: null };
    }
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      status: 'ok',
      manifest: { ...defaultManifest(), ...parsed },
      // ⛔ WHAT THE FILE ACTUALLY SAID, BESIDE WHAT THE DEFAULTS SUPPLIED.
      //
      // The defaults are right for every ordinary reader — a missing count should behave as 0 so no
      // caller has to handle undefined. They are catastrophic for one question: "did this manifest
      // ever record an unresolved population?" A legacy manifest written before dirtyEdgeCount
      // existed comes back as `dirtyEdgeCount: 0, dirtyEdges: []`, which the migration source then
      // certifies as PROVABLY COMPLETE AND EMPTY — a claim that this graph has zero unresolved refs,
      // manufactured entirely by defaultManifest().
      //
      // Measured: a manifest holding only {commit,indexedAt,status,schemaVersion} produced
      //     migration source -> {"state":"valid","rows":[],"count":0}
      //
      // So anything deciding whether EVIDENCE EXISTS must read `parsed`, not `manifest`. The
      // distinction is absence versus a filled-in zero, and only the raw object still has it.
      parsed,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'missing',
        manifest: defaultManifest(),
        parsed: null,
      };
    }

    return {
      status: 'corrupt',
      manifest: defaultManifest(),
      parsed: null,
    };
  }
}

export async function writeManifest(graphDir, manifest) {
  await mkdir(graphDir, { recursive: true });

  const manifestPath = join(graphDir, MANIFEST_FILE);
  const tempPath = `${manifestPath}.${randomUUID()}.tmp`;
  const payload = JSON.stringify(
    { ...defaultManifest(), ...manifest },
    null,
    2,
  );

  await writeFile(tempPath, `${payload}\n`, 'utf8');
  await rename(tempPath, manifestPath);
}
