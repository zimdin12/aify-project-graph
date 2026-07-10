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
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { graphModuleTree } from '../../../mcp/stdio/query/verbs/module_tree.js';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';
import { normalizePathArg } from '../../../mcp/stdio/util/paths.js';

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'python', confidence: 1, extra: '{}', ...node });
}

function insertEdge(db, edge) {
  db.run(
    `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
     VALUES ($from_id, $to_id, $relation, $source_file, $source_line, $confidence, $provenance, $extractor)`,
    { source_line: 1, confidence: 1, provenance: 'EXTRACTED', extractor: 'generic', ...edge });
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

  it('graph_search applies a backslash file filter against forward-slash file_path', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'fn1', type: 'Function', label: 'connect', file_path: 'src/db/conn.py' });
    insertNode(db, { id: 'fn2', type: 'Function', label: 'connect', file_path: 'src/net/sock.py' });
    db.close();
    const out = await graphSearch({ repoRoot, query: 'connect', file: 'src\\db' });
    expect(out).toContain('src/db/conn.py');
    expect(out).not.toContain('src/net/sock.py');
  });

  it('graph_module_tree resolves a backslash path prefix', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'dir1', type: 'Directory', label: 'db', file_path: 'src/db' });
    insertNode(db, { id: 'mf1', type: 'File', label: 'conn.py', file_path: 'src/db/conn.py' });
    db.close();
    const out = await graphModuleTree({ repoRoot, path: 'src\\db' });
    expect(out).toContain('src/db/conn.py');
  });

  it('graph_callees applies a backslash file filter to a CALLS edge source_file', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'caller', type: 'Function', label: 'run', file_path: 'src/db/conn.py' });
    insertNode(db, { id: 'callee', type: 'Function', label: 'helper', file_path: 'src/db/util.py' });
    insertEdge(db, { from_id: 'caller', to_id: 'callee', relation: 'CALLS', source_file: 'src/db/conn.py' });
    db.close();
    const out = await graphCallees({ repoRoot, symbol: 'run', file: 'src\\db' });
    expect(out).not.toContain('NO CALLEES in');
    expect(out).toContain('helper');
  });
});
