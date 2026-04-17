#!/usr/bin/env node
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const repos = [
  ['apg', 'C:/Docker/aify-project-graph'],
  ['aclaude', 'C:/Docker/aify-claude'],
  ['mem0-fork', 'C:/Docker/aify-openmemory/mem0-fork'],
  ['echoes', 'C:/Users/Administrator/echoes_of_the_fallen'],
  ['lc-api', 'C:/Users/Administrator/lc-api'],
];

for (const [name, root] of repos) {
  const dbPath = join(root, '.aify-graph', 'graph.sqlite');
  if (!existsSync(dbPath)) {
    console.log(`--- ${name}: graph missing ---`);
    continue;
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const n = db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n;
    const e = db.prepare('SELECT COUNT(*) AS n FROM edges').get().n;
    const types = db.prepare('SELECT type, COUNT(*) AS n FROM nodes GROUP BY type ORDER BY n DESC').all();
    const rels = db.prepare('SELECT relation, COUNT(*) AS n FROM edges GROUP BY relation ORDER BY n DESC').all();

    // Quality signals:
    // - how many methods have a real parent_class (out-of-class C++ fix)
    // - how many edges resolved (vs unresolved from manifest)
    const methodsWithParent = db.prepare(`
      SELECT COUNT(*) AS n FROM nodes
      WHERE type = 'Method' AND json_extract(extra, '$.parent_class') != ''
    `).get().n;
    const totalMethods = db.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE type = 'Method'`).get().n;

    console.log(`\n--- ${name} ---`);
    console.log(`  nodes=${n} edges=${e}`);
    console.log(`  types: ${types.map(r => `${r.type}:${r.n}`).join(' ')}`);
    console.log(`  rels:  ${rels.map(r => `${r.relation}:${r.n}`).join(' ')}`);
    console.log(`  methods-with-parent_class: ${methodsWithParent}/${totalMethods}`);
  } finally {
    db.close();
  }
}
