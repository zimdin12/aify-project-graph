#!/usr/bin/env node
// Sample quality probes against each graph — tests the kinds of queries an
// agent actually runs. Each probe returns counts/samples that demonstrate
// whether the extractor is doing what we claim.
import Database from 'better-sqlite3';
import { join } from 'node:path';

const probes = [
  {
    repo: 'echoes',
    root: 'C:/Users/Administrator/echoes_of_the_fallen',
    checks: [
      { label: 'AudioSystem methods', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Method' AND json_extract(extra,'$.parent_class')='AudioSystem'` },
      { label: 'Engine methods', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Method' AND json_extract(extra,'$.parent_class')='Engine'` },
      { label: 'ChunkManager methods', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Method' AND json_extract(extra,'$.parent_class')='ChunkManager'` },
      { label: 'Shader functions (GLSL)', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Function' AND language='glsl'` },
      { label: 'Unique class→method CONTAINS edges', sql: `SELECT COUNT(*) AS n FROM edges WHERE relation='CONTAINS' AND source_file LIKE '%.cpp'` },
    ],
  },
  {
    repo: 'lc-api',
    root: 'C:/Users/Administrator/lc-api',
    checks: [
      { label: 'Controllers (classes ending in Controller)', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Class' AND label LIKE '%Controller'` },
      { label: 'Eloquent Models (File under app/Models)', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Class' AND file_path LIKE 'app/Models/%'` },
      { label: 'Traits', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Class' AND file_path LIKE 'app/Traits/%'` },
      { label: 'use SomeTrait in a class → IMPLEMENTS', sql: `SELECT COUNT(*) AS n FROM edges WHERE relation='IMPLEMENTS'` },
      { label: 'Laravel routes (INVOKES)', sql: `SELECT COUNT(*) AS n FROM edges WHERE relation='INVOKES'` },
      { label: 'Resolved namespace imports (App.*)', sql: `SELECT COUNT(*) AS n FROM edges e JOIN nodes tn ON tn.id=e.to_id WHERE e.relation='IMPORTS' AND json_extract(tn.extra,'$.qname') LIKE 'App.%'` },
    ],
  },
  {
    repo: 'mem0-fork',
    root: 'C:/Docker/aify-openmemory/mem0-fork',
    checks: [
      { label: 'Memory class methods', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Method' AND json_extract(extra,'$.parent_class')='Memory'` },
      { label: 'VectorStoreBase subclasses', sql: `SELECT COUNT(*) AS n FROM edges WHERE relation='EXTENDS' AND to_id IN (SELECT id FROM nodes WHERE label='VectorStoreBase')` },
      { label: 'Tests', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Test'` },
    ],
  },
  {
    repo: 'aclaude',
    root: 'C:/Docker/aify-claude',
    checks: [
      { label: 'Python methods with parent_class', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Method' AND json_extract(extra,'$.parent_class') != ''` },
      { label: 'USES_TYPE edges', sql: `SELECT COUNT(*) AS n FROM edges WHERE relation='USES_TYPE'` },
    ],
  },
  {
    repo: 'apg',
    root: 'C:/Docker/aify-project-graph',
    checks: [
      { label: 'C++ Foo::bar fixture picked up as Method', sql: `SELECT COUNT(*) AS n FROM nodes WHERE type='Method' AND json_extract(extra,'$.parent_class')='Foo'` },
      { label: 'ensureFresh callers (graph_* verbs)', sql: `SELECT COUNT(DISTINCT from_id) AS n FROM edges WHERE relation='CALLS' AND to_id IN (SELECT id FROM nodes WHERE label='ensureFresh')` },
    ],
  },
];

for (const p of probes) {
  console.log(`\n=== ${p.repo} ===`);
  const db = new Database(join(p.root, '.aify-graph', 'graph.sqlite'), { readonly: true });
  try {
    for (const check of p.checks) {
      const row = db.prepare(check.sql).get();
      console.log(`  ${check.label}: ${row.n}`);
    }
  } finally {
    db.close();
  }
}
