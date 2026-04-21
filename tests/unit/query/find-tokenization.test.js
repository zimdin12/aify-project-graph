// Regression test for the 2026-04-22 compound-query bug: graph_find returned
// empty on multi-word queries like "pressure vacuum gas" because the whole
// string was passed as one literal substring match. Echoes bench flagged this
// twice. Fix: server-side tokenization — split on whitespace, run each term,
// union results.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphFind } from '../../../mcp/stdio/query/verbs/find.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'javascript', confidence: 1, extra: '{}', ...node }
  );
}

describe('graph_find — server-side tokenization for compound queries', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-find-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('returns hits when the query is a compound of tokens that exist separately', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'f1', type: 'Function', label: 'pressureShader', file_path: 'src/pressure.js' });
    insertNode(db, { id: 'f2', type: 'Function', label: 'vacuumSweep', file_path: 'src/vacuum.js' });
    db.close();

    // Before the fix: "pressure vacuum" matched nothing (no symbol's label
    // contained that literal substring). After the fix: each token is
    // searched, results are unioned.
    const raw = await graphFind({ repoRoot, query: 'pressure vacuum' });
    const result = JSON.parse(raw);
    const codeLabels = result.hits.code.map((h) => h.label);
    expect(codeLabels).toContain('pressureShader');
    expect(codeLabels).toContain('vacuumSweep');
  });

  it('still works on single-token queries (no regression)', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'f1', type: 'Function', label: 'authenticate', file_path: 'src/auth.js' });
    db.close();

    const raw = await graphFind({ repoRoot, query: 'authenticate' });
    const result = JSON.parse(raw);
    expect(result.hits.code).toHaveLength(1);
    expect(result.hits.code[0].label).toBe('authenticate');
  });

  it('prefers full-phrase match when it exists (does not dilute scores)', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'f1', type: 'Function', label: 'pressureVacuumHandler', file_path: 'src/x.js' });
    insertNode(db, { id: 'f2', type: 'Function', label: 'pressureMeter', file_path: 'src/y.js' });
    insertNode(db, { id: 'f3', type: 'Function', label: 'vacuumPump', file_path: 'src/z.js' });
    db.close();

    const raw = await graphFind({ repoRoot, query: 'pressure vacuum' });
    const result = JSON.parse(raw);
    // pressureVacuumHandler should score highest (matches the full phrase
    // via the first query pass). Other two match individual tokens only.
    expect(result.hits.code[0].label).toBe('pressureVacuumHandler');
  });
});
