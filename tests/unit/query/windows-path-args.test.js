// Borrow sweep (codegraph 0171785): path-taking verbs must accept a Windows
// backslash path arg — file_path is stored with forward slashes, so a `src\foo`
// arg previously matched nothing and returned an empty/"not found" result.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphFile } from '../../../mcp/stdio/query/verbs/file.js';
import { graphFind } from '../../../mcp/stdio/query/verbs/find.js';
import { normalizePathArg } from '../../../mcp/stdio/util/paths.js';

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'python', confidence: 1, extra: '{}', ...node });
}

describe('normalizePathArg', () => {
  it('converts backslashes to forward slashes; passes through clean paths/non-strings', () => {
    expect(normalizePathArg('src\\db\\conn.py')).toBe('src/db/conn.py');
    expect(normalizePathArg('src/db/conn.py')).toBe('src/db/conn.py');
    expect(normalizePathArg(undefined)).toBe(undefined);
  });
});

describe('path verbs accept Windows backslash args', () => {
  let repoRoot;
  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-winpath-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });
  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch {} });

  it('graph_file resolves a backslash path to the forward-slash File node', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'file1', type: 'File', label: 'db.py', file_path: 'src/db/db.py' });
    db.close();
    const out = await graphFile({ repoRoot, path: 'src\\db\\db.py' });
    expect(out).toContain('src/db/db.py');
    expect(out).not.toContain('NO FILE');
  });

  it('graph_find matches a backslash path fragment against a doc file_path', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'd1', type: 'Document', label: 'api.md', file_path: 'docs/api/conn.md' });
    db.close();
    const raw = await graphFind({ repoRoot, query: 'docs\\api\\conn', layers: ['docs'] });
    const result = JSON.parse(raw);
    expect(result.hits.docs.items.map((h) => h.file)).toContain('docs/api/conn.md');
  });
});
