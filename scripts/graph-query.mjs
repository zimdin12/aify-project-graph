#!/usr/bin/env node
// Minimal graph query helper — exposes a few verbs for subagent experiments.
// Usage: node scripts/graph-query.mjs <repoRoot> <verb> [args...]
// Verbs: whereis <symbol> | callers <symbol> | callees <symbol> | impact <symbol> | report

import Database from 'better-sqlite3';
import { join } from 'node:path';

const [,, repoRoot, verb, ...args] = process.argv;
if (!repoRoot || !verb) {
  console.error('usage: graph-query.mjs <repoRoot> <verb> [args...]');
  process.exit(2);
}

const db = new Database(join(repoRoot, '.aify-graph', 'graph.sqlite'), { readonly: true });

function fmtNode(n) {
  return `NODE ${n.id.slice(0, 8)} ${n.type} ${n.label} ${n.file_path}:${n.start_line}`;
}

function fmtEdge(e) {
  return `EDGE ${e.from_label}->${e.to_label} ${e.relation} ${e.source_file}:${e.source_line} conf=${(e.confidence ?? 0).toFixed(2)}`;
}

if (verb === 'whereis') {
  const symbol = args[0];
  const rows = db.prepare(
    `SELECT * FROM nodes WHERE label = ? ORDER BY type, file_path LIMIT 10`,
  ).all(symbol);
  if (rows.length === 0) {
    console.log('NO MATCH for ' + symbol);
  } else {
    for (const r of rows) console.log(fmtNode(r));
  }
} else if (verb === 'callers') {
  const symbol = args[0];
  const rows = db.prepare(`
    SELECT e.*, fn.label AS from_label, tn.label AS to_label
    FROM edges e
    JOIN nodes tn ON tn.id = e.to_id
    JOIN nodes fn ON fn.id = e.from_id
    WHERE e.relation = 'CALLS' AND tn.label = ?
    ORDER BY e.confidence DESC LIMIT 20
  `).all(symbol);
  if (rows.length === 0) console.log('NO CALLERS for ' + symbol);
  else for (const r of rows) console.log(fmtEdge(r));
} else if (verb === 'callees') {
  const symbol = args[0];
  const rows = db.prepare(`
    SELECT e.*, fn.label AS from_label, tn.label AS to_label
    FROM edges e
    JOIN nodes fn ON fn.id = e.from_id
    JOIN nodes tn ON tn.id = e.to_id
    WHERE e.relation = 'CALLS' AND fn.label = ?
    ORDER BY e.confidence DESC LIMIT 20
  `).all(symbol);
  if (rows.length === 0) console.log('NO CALLEES for ' + symbol);
  else for (const r of rows) console.log(fmtEdge(r));
} else if (verb === 'impact') {
  const symbol = args[0];
  const node = db.prepare(`SELECT * FROM nodes WHERE label = ? LIMIT 1`).get(symbol);
  if (!node) {
    console.log('NO MATCH for ' + symbol);
  } else {
    console.log(fmtNode(node));
    const callers = db.prepare(`SELECT COUNT(*) AS n FROM edges WHERE relation = 'CALLS' AND to_id = ?`).get(node.id).n;
    const extenders = db.prepare(`SELECT COUNT(*) AS n FROM edges WHERE relation = 'EXTENDS' AND to_id = ?`).get(node.id).n;
    const usesType = db.prepare(`SELECT COUNT(*) AS n FROM edges WHERE relation = 'USES_TYPE' AND to_id = ?`).get(node.id).n;
    const tests = db.prepare(`SELECT COUNT(*) AS n FROM edges WHERE relation = 'TESTS' AND to_id = ?`).get(node.id).n;
    console.log(`IMPACT ${callers} CALLS, ${extenders} EXTENDS, ${usesType} USES_TYPE, ${tests} TESTS`);
    const sample = db.prepare(`
      SELECT e.*, fn.label AS from_label, tn.label AS to_label
      FROM edges e
      JOIN nodes fn ON fn.id = e.from_id
      JOIN nodes tn ON tn.id = e.to_id
      WHERE e.relation = 'CALLS' AND tn.id = ?
      ORDER BY e.confidence DESC LIMIT 5
    `).all(node.id);
    for (const r of sample) console.log(fmtEdge(r));
  }
} else if (verb === 'report') {
  const totalNodes = db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n;
  const totalEdges = db.prepare('SELECT COUNT(*) AS n FROM edges').get().n;
  const byType = db.prepare('SELECT type, COUNT(*) AS n FROM nodes GROUP BY type ORDER BY n DESC').all();
  const byRelation = db.prepare('SELECT relation, COUNT(*) AS n FROM edges GROUP BY relation ORDER BY n DESC').all();
  const topHubs = db.prepare(`
    SELECT n.label, n.type, n.file_path, COUNT(*) AS callers
    FROM edges e JOIN nodes n ON n.id = e.to_id
    WHERE e.relation = 'CALLS'
    GROUP BY e.to_id ORDER BY callers DESC LIMIT 10
  `).all();
  console.log(`REPORT nodes=${totalNodes} edges=${totalEdges}`);
  console.log('BY_TYPE ' + byType.map(r => `${r.type}:${r.n}`).join(' '));
  console.log('BY_RELATION ' + byRelation.map(r => `${r.relation}:${r.n}`).join(' '));
  console.log('TOP_HUBS:');
  for (const h of topHubs) console.log(`  ${h.label} (${h.type}) ${h.file_path} callers=${h.callers}`);
} else {
  console.error('unknown verb: ' + verb);
  process.exit(2);
}

db.close();
