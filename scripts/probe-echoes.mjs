#!/usr/bin/env node
import Database from 'better-sqlite3';

const db = new Database('C:/Users/Administrator/echoes_of_the_fallen/.aify-graph/graph.sqlite', { readonly: true });

const section = (title, rows) => {
  console.log('\n=== ' + title + ' ===');
  for (const row of rows) console.log(JSON.stringify(row));
};

section('PARTICLE CLASS + METHODS', db.prepare(`
  SELECT label, type, file_path, start_line
  FROM nodes WHERE label LIKE '%Particle%' ORDER BY type, label LIMIT 15
`).all());

section('TOP-CALLED FUNCTIONS (real hubs)', db.prepare(`
  SELECT n.label, n.type, n.file_path, COUNT(*) AS callers
  FROM edges e JOIN nodes n ON n.id = e.to_id
  WHERE e.relation = 'CALLS'
  GROUP BY e.to_id ORDER BY callers DESC LIMIT 10
`).all());

section('CLASS HIERARCHY (EXTENDS)', db.prepare(`
  SELECT fn.label AS child, tn.label AS parent, tn.file_path
  FROM edges e JOIN nodes fn ON fn.id = e.from_id JOIN nodes tn ON tn.id = e.to_id
  WHERE e.relation = 'EXTENDS' LIMIT 10
`).all());

section('ENGINE CLASS — who defines it + methods', db.prepare(`
  SELECT label, type, file_path, start_line
  FROM nodes WHERE (extra LIKE '%"qname":"%Engine%"%' OR label = 'Engine')
    AND type IN ('Class', 'Method', 'Function') LIMIT 15
`).all());

section('FILE COUNT BY TYPE', db.prepare(`
  SELECT type, COUNT(*) AS n FROM nodes GROUP BY type ORDER BY n DESC
`).all());

db.close();
