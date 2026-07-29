// THE BRIEF MUST NAME THE TEST SYSTEM THE REPO ACTUALLY USES.
//
// Sand Castle field report (2026-07-27): on a C++ repo with 129 Catch2 test
// files, brief.agent.md's TESTS block named 3 Python helper scripts and omitted
// the C++ suite entirely. An agent reading that brief looks for the wrong suite
// and concludes the real one does not exist — the single most expensive way for a
// map to be wrong, because it is confidently wrong.
//
// Two defects combined:
//   1. The anchor query had NO ORDER BY. Framework plugins (Catch2/GTest) run in
//      the ENRICH phase, so their Test nodes are INSERTED LAST — under an
//      unordered `LIMIT 3` they could never win, regardless of count.
//   2. Three anchors were rendered with no denominator, so the sample read as
//      the whole suite.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { generateBrief } from '../../../mcp/stdio/brief/generator.js';

function insert(db, row) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, structural_fp, dependency_fp, extra)
     VALUES ($id, $type, $label, $file_path, 1, 2, $language, 1.0, '', '', '{}')`,
    { language: 'cpp', ...row },
  );
}

describe('brief names the dominant test system', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-testsys-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    // Insertion order reproduces the field failure exactly: the Python helpers
    // land FIRST (core extraction), the C++ Test nodes LAST (enrich phase).
    for (let i = 0; i < 3; i += 1) {
      insert(db, {
        id: `py${i}`, type: 'File', label: `helper_${i}_test.py`,
        file_path: `tests/helper_${i}_test.py`, language: 'python',
      });
    }
    insert(db, { id: 'src1', type: 'File', label: 'engine.cpp', file_path: 'src/engine.cpp' });
    // 20 Catch2 suite files, 4 TEST_CASEs each — emitted last, as the plugin does.
    for (let i = 0; i < 20; i += 1) {
      const path = `src/detail/engine_${i}_test.cpp`;
      insert(db, { id: `cppfile${i}`, type: 'File', label: `engine_${i}_test.cpp`, file_path: path });
      for (let c = 0; c < 4; c += 1) {
        insert(db, { id: `case${i}_${c}`, type: 'Test', label: `case ${i}.${c}`, file_path: path });
      }
    }
    db.close();
  });

  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch {} });

  it('TESTS anchors come from the C++ suite, not the 3 Python helpers', () => {
    generateBrief({ repoRoot });
    const agentMd = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
    const block = agentMd.split(/^TESTS/m)[1]?.split(/\n[A-Z_]+[: (]/)[0] ?? '';

    expect(block).toMatch(/_test\.cpp/);
    // The exact field symptom: Python helpers presented as the test system.
    expect(block).not.toMatch(/helper_\d+_test\.py/);
  });

  it('TESTS header states the denominator and the language mix', () => {
    generateBrief({ repoRoot });
    const agentMd = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');

    // 23 test files total (20 cpp + 3 py); 3 shown.
    expect(agentMd).toMatch(/TESTS \(showing 3 of 23;[^)]*\.cpp 20/);
  });

  it('brief.json carries the inventory for programmatic consumers', () => {
    generateBrief({ repoRoot });
    const brief = JSON.parse(readFileSync(join(repoRoot, '.aify-graph', 'brief.json'), 'utf8'));

    expect(brief.test_inventory.total).toBe(23);
    expect(brief.test_inventory.systems[0]).toMatchObject({ ext: '.cpp', files: 20, cases: 80 });
  });
});
