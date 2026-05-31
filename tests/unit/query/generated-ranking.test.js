// P1-5 — ranking tests. When a generated stub and a hand-written symbol share
// a label, the hand-written node ranks first. The generated node stays
// reachable (down-rank, never hide) and is tagged so the agent knows.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { graphFind } from '../../../mcp/stdio/query/verbs/find.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'cpp', confidence: 1, extra: '{}', ...node }
  );
}

describe('P1-5 generated down-ranking', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-gen-rank-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('graph_search ranks the hand-written node above the generated stub of the same name', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    // Same label "Message" — one hand-written class, one protobuf-generated.
    insertNode(db, { id: 'gen', type: 'Class', label: 'Message', file_path: 'src/proto/message.pb.h' });
    insertNode(db, { id: 'hand', type: 'Class', label: 'Message', file_path: 'src/model/Message.cpp' });
    db.close();

    const out = await graphSearch({ repoRoot, query: 'Message' });
    const lines = out.split('\n').filter((l) => l.startsWith('NODE '));
    // Hand-written file must appear before the generated one.
    const handIdx = lines.findIndex((l) => l.includes('src/model/Message.cpp'));
    const genIdx = lines.findIndex((l) => l.includes('src/proto/message.pb.h'));
    expect(handIdx).toBeGreaterThanOrEqual(0);
    expect(genIdx).toBeGreaterThanOrEqual(0);
    expect(handIdx).toBeLessThan(genIdx);
    // Generated node is still reachable and tagged.
    expect(lines[genIdx]).toContain('generated:true');
    // Hand-written line is NOT tagged.
    expect(lines[handIdx]).not.toContain('generated:true');
  });

  it('graph_search still finds a generated file when nothing else matches', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'gen', type: 'Class', label: 'OnlyGenerated', file_path: 'src/proto/only.pb.h' });
    db.close();

    const out = await graphSearch({ repoRoot, query: 'OnlyGenerated' });
    expect(out).toContain('OnlyGenerated');
    expect(out).toContain('generated:true');
  });

  it('graph_find ranks the hand-written code hit above the generated stub', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'gen', type: 'Class', label: 'Widget', file_path: 'build/moc_widget.cpp' });
    insertNode(db, { id: 'hand', type: 'Class', label: 'Widget', file_path: 'src/Widget.cpp' });
    db.close();

    const raw = await graphFind({ repoRoot, query: 'Widget' });
    const result = JSON.parse(raw);
    const items = result.hits.code.items;
    const handIdx = items.findIndex((h) => h.file === 'src/Widget.cpp');
    const genIdx = items.findIndex((h) => h.file === 'build/moc_widget.cpp');
    expect(handIdx).toBeGreaterThanOrEqual(0);
    expect(genIdx).toBeGreaterThanOrEqual(0);
    expect(handIdx).toBeLessThan(genIdx);
    expect(items[genIdx].generated).toBe(true);
    expect(items[handIdx].generated).toBeUndefined();
  });
});
