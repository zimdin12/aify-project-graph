import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

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
  };
}

export async function loadManifest(graphDir) {
  const manifestPath = join(graphDir, MANIFEST_FILE);

  try {
    const raw = await readFile(manifestPath, 'utf8');
    return {
      status: 'ok',
      manifest: { ...defaultManifest(), ...JSON.parse(raw) },
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'missing',
        manifest: defaultManifest(),
      };
    }

    return {
      status: 'corrupt',
      manifest: defaultManifest(),
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
