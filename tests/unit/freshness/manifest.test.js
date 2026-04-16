import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest, writeManifest } from '../../../mcp/stdio/freshness/manifest.js';

describe('manifest persistence', () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-manifest-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns defaults when the manifest is missing', async () => {
    const result = await loadManifest(dir);

    expect(result.status).toBe('missing');
    expect(result.manifest).toMatchObject({
      commit: null,
      dirtyFiles: [],
      dirtyEdges: [],
    });
  });

  it('writes via atomic rename and round-trips the manifest', async () => {
    const manifest = {
      commit: 'abc123',
      indexedAt: '2026-04-16T00:00:00Z',
      schemaVersion: 1,
      extractorVersion: '0.1.0',
      parserBundleVersion: '2026.04.16',
      dirtyFiles: ['src/app.py'],
      dirtyEdges: [{ target: 'os', relation: 'IMPORTS' }],
    };

    await writeManifest(dir, manifest);

    const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    expect(raw).toMatchObject(manifest);

    const loaded = await loadManifest(dir);
    expect(loaded.status).toBe('ok');
    expect(loaded.manifest).toMatchObject(manifest);
  });

  it('marks corrupt JSON as corrupt', async () => {
    await writeFile(join(dir, 'manifest.json'), '{not-json', 'utf8');

    const result = await loadManifest(dir);
    expect(result.status).toBe('corrupt');
  });
});
