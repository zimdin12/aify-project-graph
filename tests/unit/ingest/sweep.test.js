import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepFilesystem } from '../../../mcp/stdio/ingest/sweep.js';

function findNode(nodes, type, filePath) {
  return nodes.find((node) => node.type === type && node.file_path === filePath);
}

describe('filesystem sweep', () => {
  let repoDir;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'apg-sweep-'));
    await mkdir(join(repoDir, 'src'), { recursive: true });
    await mkdir(join(repoDir, 'routes'), { recursive: true });
    await mkdir(join(repoDir, 'db', 'migrations'), { recursive: true });

    await writeFile(
      join(repoDir, 'README.md'),
      '# Aify Project Graph\nCode intelligence for agents\n\nExtra body that should not be stored.\n',
    );
    await writeFile(
      join(repoDir, 'package.json'),
      JSON.stringify({ name: 'aify-project-graph', dependencies: { vitest: '^3.0.0' } }, null, 2),
    );
    await writeFile(join(repoDir, 'src', 'main.py'), 'def main():\n    return 0\n');
    await writeFile(join(repoDir, 'routes', 'web.php'), '<?php\nRoute::get("/", HomeController::class);\n');
    await writeFile(join(repoDir, 'db', 'migrations', '001_init.sql'), 'create table users (id integer primary key);\n');
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it('emits directory, document, config, route, entrypoint, and schema nodes', async () => {
    const result = await sweepFilesystem({ repoRoot: repoDir });

    expect(findNode(result.nodes, 'Directory', '.')).toBeTruthy();
    expect(findNode(result.nodes, 'Directory', 'src')).toBeTruthy();
    expect(findNode(result.nodes, 'Directory', 'routes')).toBeTruthy();

    expect(findNode(result.nodes, 'Document', 'README.md')).toMatchObject({
      extra: expect.objectContaining({
        title: 'Aify Project Graph',
        summary: 'Code intelligence for agents',
      }),
    });

    expect(findNode(result.nodes, 'Config', 'package.json')).toMatchObject({
      extra: expect.objectContaining({
        keys: expect.arrayContaining(['dependencies', 'name']),
      }),
    });

    expect(findNode(result.nodes, 'Entrypoint', 'src/main.py')).toBeTruthy();
    expect(findNode(result.nodes, 'Route', 'routes/web.php')).toBeTruthy();
    expect(findNode(result.nodes, 'Schema', 'db/migrations/001_init.sql')).toBeTruthy();

    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'CONTAINS', from_path: '.', to_path: 'README.md' }),
      expect.objectContaining({ relation: 'CONTAINS', from_path: '.', to_path: 'package.json' }),
      expect.objectContaining({ relation: 'CONTAINS', from_path: 'src', to_path: 'src/main.py' }),
      expect.objectContaining({ relation: 'CONTAINS', from_path: 'routes', to_path: 'routes/web.php' }),
      expect.objectContaining({ relation: 'CONTAINS', from_path: 'db/migrations', to_path: 'db/migrations/001_init.sql' }),
    ]));
  });
});
